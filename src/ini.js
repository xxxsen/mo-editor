// Byte-preserving INI reader. Unknown lines, comments and line endings are kept verbatim.
const encoder = new TextEncoder();
const ascii = bytes => Array.from(bytes, byte => String.fromCharCode(byte)).join('');
const keyOf = value => value.trim().toLowerCase();
const isSpace = byte => byte === 32 || byte === 9;

function pathKey(path) {
  const parts = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part.toLowerCase());
  }
  return parts.join('/');
}

function detectEncoding(bytes) {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new Error('暂不支持 UTF-16 编码的文件。');
  }
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { label: 'utf-8', reliable: bom || bytes.some(byte => byte > 127) };
  } catch {
    return { label: 'gbk', reliable: false };
  }
}

function parseLine(raw, eol, decoder) {
  const text = ascii(raw);
  const prefix = text.startsWith('\xef\xbb\xbf') ? 3 : 0;
  const body = text.slice(prefix);
  const line = { raw, eol, section: null, key: null, patch: undefined, added: false };
  const header = body.match(/^\s*\[([^\]]+)\]\s*(?:;.*)?$/);
  if (header) {
    line.section = header[1].trim();
    return line;
  }
  if (/^\s*[;#]/.test(body)) return line;
  const eq = body.indexOf('=');
  if (eq < 0) return line;
  const name = body.slice(0, eq).trim();
  if (!name) return line;
  const begin = prefix + eq + 1;
  const comment = text.indexOf(';', begin);
  const limit = comment < 0 ? raw.length : comment;
  let start = begin;
  let end = limit;
  while (start < end && isSpace(raw[start])) start++;
  while (end > start && isSpace(raw[end - 1])) end--;
  line.key = name;
  line.valueStart = start;
  line.valueEnd = end;
  line.originalValue = decoder.decode(raw.slice(start, end));
  return line;
}

export function parseFile(name, data, relativePath = name) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const encoding = detectEncoding(bytes);
  const decoder = new TextDecoder(encoding.label);
  const lines = [];
  let start = 0;
  let newline = '\n';
  let foundNewline = false;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 10 && bytes[i] !== 13) continue;
    const end = i;
    let eol = bytes[i] === 13 ? '\r' : '\n';
    if (bytes[i] === 13 && bytes[i + 1] === 10) { eol = '\r\n'; i++; }
    if (!foundNewline) { newline = eol; foundNewline = true; }
    lines.push(parseLine(bytes.slice(start, end), eol, decoder));
    start = i + 1;
  }
  if (start < bytes.length) lines.push(parseLine(bytes.slice(start), '', decoder));
  return { name, path: relativePath.replaceAll('\\', '/'), encoding, decoder, lines, newline, originalBytes: bytes };
}

function readLineValue(line) {
  return line.patch === undefined ? line.originalValue : line.patch;
}

function includeNames(file) {
  let current = '';
  const includes = new Map();
  for (const line of file.lines) {
    if (line.removed) continue;
    if (line.section !== null) current = keyOf(line.section);
    else if (current === '#include' && line.key) includes.set(keyOf(line.key), readLineValue(line).trim());
  }
  return [...includes.values()].filter(Boolean);
}

function assertValue(file, value) {
  if (/[\r\n;]/.test(value)) throw new Error('属性值不能包含换行或分号。');
  if (/[^\x00-\x7f]/.test(value) && (file.encoding.label !== 'utf-8' || !file.encoding.reliable)) {
    throw new Error('此文件的编码无法安全写入非 ASCII 字符；请使用英文和数字，或在外部编辑器中修改中文。');
  }
}

function lineBytes(line) {
  return line.patch === undefined ? line.raw : concat([line.raw.slice(0, line.valueStart), encoder.encode(line.patch), line.raw.slice(line.valueEnd)]);
}

function insertLines(file, index, lines) {
  if (index > 0 && !file.lines[index - 1].eol) file.lines[index - 1].eol = file.newline;
  file.lines.splice(index, 0, ...lines);
}

function discardAddedLine(file, line) {
  const index = file.lines.indexOf(line);
  if (index < 0) return;
  file.lines.splice(index, 1);
  if (line.fixedHeader) {
    const header = line.fixedHeader;
    const headerIndex = file.lines.indexOf(header);
    const following = file.lines.slice(headerIndex + 1).find(item => !item.removed && (item.section !== null || item.added));
    if (following?.added && following.section === null) following.fixedHeader = header;
    else if (!following) header.eol = '';
  }
}

export class IniProject {
  constructor(files, mainPath) {
    this.files = files;
    this.mainPath = mainPath || files[0]?.path;
    this.rebuild();
  }

  resolve(path) {
    const wanted = pathKey(path);
    const exact = this.files.filter(file => pathKey(file.path) === wanted);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
    if (!wanted.includes('/')) {
      const matches = this.files.filter(file => pathKey(file.path).split('/').pop() === wanted);
      if (matches.length === 1) return matches[0];
    }
    return null;
  }

  rebuild() {
    this.sections = new Map();
    this.warnings = [];
    this.missingIncludes = [];
    this.loadOrder = [];
    const main = this.resolve(this.mainPath);
    if (!main) { this.warnings.push(`找不到主文件：${this.mainPath || '未选择'}`); return; }
    const visit = (file, stack) => {
      if (stack.includes(file)) { this.warnings.push(`检测到循环引用：${[...stack, file].map(item => item.path).join(' → ')}`); return; }
      if (this.loadOrder.length >= 1024) { this.warnings.push('引用文件数量过多，已停止继续加载。'); return; }
      this.loadOrder.push(file);
      let current = null;
      for (const line of file.lines) {
        if (line.removed) continue;
        if (line.section !== null) {
          const id = keyOf(line.section);
          current = this.sections.get(id);
          if (!current) { current = { name: line.section, fields: new Map(), occurrences: [] }; this.sections.set(id, current); }
          current.occurrences.push({ file, line });
        } else if (current && line.key) {
          current.fields.set(keyOf(line.key), { name: line.key, value: readLineValue(line), file, line });
        }
      }
      for (const name of includeNames(file)) {
        const child = this.resolve(name);
        if (child) visit(child, [...stack, file]);
        else {
          this.missingIncludes.push({ file, name });
          this.warnings.push(`${file.path} 引用的 ${name} 未导入或路径不明确。`);
        }
      }
    };
    visit(main, []);
    if (this.sections.has('$include')) {
      this.warnings.push('检测到 [$Include]；此版本不解析 Phobos 的 include 机制。');
    }
    if ([...this.sections.values()].some(section => section.fields.has('$inherits'))) {
      this.warnings.push('检测到 $Inherits；此版本不计算继承，显示值可能不完整。');
    }
  }

  section(name) { return this.sections.get(keyOf(name)); }
  get(section, key) { return this.section(section)?.fields.get(keyOf(key)); }

  // A candidate project can be prepared without modifying the current unsaved edits.
  fork() {
    const copied = new Map();
    const files = this.files.map(file => {
      const lines = file.lines.map(line => {
        const result = { ...line };
        copied.set(line, result);
        return result;
      });
      return { ...file, lines };
    });
    for (const file of files) for (const line of file.lines) {
      if (line.fixedHeader) line.fixedHeader = copied.get(line.fixedHeader);
    }
    return new IniProject(files, this.mainPath);
  }

  createSection(name, file, sourceName = '') {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name)) throw new Error('规则 ID 只能使用英文字母、数字、下划线、点和连字符，且必须以字母、数字或下划线开头。');
    if (this.section(name)) throw new Error(`规则段 [${name}] 已存在。`);
    if (!this.files.includes(file) || !this.loadOrder.includes(file)) throw new Error('目标文件不在当前加载的规则中。');
    const source = sourceName ? this.section(sourceName) : null;
    if (sourceName && !source) throw new Error(`找不到模板规则段 [${sourceName}]。`);
    const lines = [];
    const header = parseLine(encoder.encode(`[${name}]`), file.newline, file.decoder);
    header.addedSection = true;
    lines.push(header);
    for (const field of source?.fields.values() || []) {
      let raw = lineBytes(field.line);
      if (field.file.encoding.label !== file.encoding.label && raw.some(byte => byte > 127)) {
        if (file.encoding.label !== 'utf-8' || !file.encoding.reliable) throw new Error('模板字段来自不同编码的文件，无法安全复制非 ASCII 内容。');
        raw = encoder.encode(field.file.decoder.decode(raw));
      }
      const copy = parseLine(raw, file.newline, file.decoder);
      copy.added = true;
      copy.cloned = true;
      lines.push(copy);
    }
    insertLines(file, file.lines.length, lines);
    this.rebuild();
  }

  // Type registries must be appended, not inserted at the start of the section.
  appendEntry(sectionName, key, value, fallbackFile) {
    if (!this.section(sectionName)) this.createSection(sectionName, fallbackFile);
    const section = this.section(sectionName);
    if (section.fields.has(keyOf(key))) throw new Error(`类型列表 [${sectionName}] 中的编号 ${key} 已存在。`);
    const { file, line: header } = section.occurrences.at(-1);
    assertValue(file, value);
    const added = parseLine(encoder.encode(`${key}=`), file.newline, file.decoder);
    added.added = true;
    added.patch = value;
    let index = file.lines.indexOf(header) + 1;
    while (index < file.lines.length && file.lines[index].section === null) index++;
    insertLines(file, index, [added]);
    this.rebuild();
  }

  set(sectionName, key, rawValue) {
    const value = String(rawValue).trim();
    const section = this.section(sectionName);
    if (!section) throw new Error(`没有找到 [${sectionName}]。`);
    const existing = section.fields.get(keyOf(key));
    if (existing) {
      assertValue(existing.file, value);
      if (existing.line.added && value === '') {
        discardAddedLine(existing.file, existing.line);
      } else existing.line.patch = value === existing.line.originalValue && (!existing.line.added || existing.line.cloned) ? undefined : value;
    } else if (value !== '') {
      const { file, line: header } = section.occurrences.at(-1);
      assertValue(file, value);
      if (!/^[A-Za-z0-9_.$-]+$/.test(key)) throw new Error('属性名包含不支持的字符。');
      const added = parseLine(encoder.encode(`${key}=`), file.newline, file.decoder);
      added.added = true;
      added.patch = value;
      if (!header.eol) { header.eol = file.newline; added.fixedHeader = header; }
      file.lines.splice(file.lines.indexOf(header) + 1, 0, added);
    }
    this.rebuild();
  }

  // Remove all loaded occurrences so an earlier duplicate cannot silently become effective.
  // Incomplete includes or inheritance make that guarantee impossible.
  remove(sectionName, key) {
    const section = this.section(sectionName);
    if (!section) throw new Error(`没有找到 [${sectionName}]。`);
    if (this.warnings.length) throw new Error(`规则加载不完整，无法安全移除字段：${this.warnings[0]}`);
    const targets = [];
    for (const file of new Set(this.loadOrder)) {
      let current = '';
      for (const line of file.lines) {
        if (line.removed) continue;
        if (line.section !== null) current = keyOf(line.section);
        else if (current === keyOf(sectionName) && line.key && keyOf(line.key) === keyOf(key)) {
          targets.push({ file, line, section: sectionName, key: line.key, before: readLineValue(line) });
        }
      }
    }
    for (const target of targets) {
      if (target.line.added) discardAddedLine(target.file, target.line);
      else target.line.removed = true;
    }
    this.rebuild();
    return targets;
  }

  changes() {
    const changes = [];
    for (const file of this.files) {
      let section = '';
      for (const line of file.lines) {
        if (line.section !== null) {
          section = line.section;
          if (line.addedSection) changes.push({ file, section, kind: 'section', before: null, after: section });
        }
        else if (line.key && line.removed) changes.push({ file, section, key: line.key, kind: 'remove', before: line.originalValue, after: null });
        else if (line.key && line.patch !== undefined) changes.push({ file, section, key: line.key, before: line.added ? null : line.originalValue, after: line.patch });
      }
    }
    return changes;
  }
}

export function serialize(file) {
  const chunks = [];
  let size = 0;
  for (const line of file.lines) {
    if (line.removed) continue;
    const raw = lineBytes(line);
    const eol = encoder.encode(line.eol);
    chunks.push(raw, eol);
    size += raw.length + eol.length;
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

export function listTypes(project, sectionName) {
  const fields = project.section(sectionName)?.fields;
  if (!fields) return [];
  return [...fields.values()].map(entry => entry.value.trim()).filter(Boolean);
}
