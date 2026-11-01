// Compare original bytes as text without changing them. A bounded Myers diff is
// used for ordinary edits; very large edit sets fall back to a complete coarse
// replacement so the preview never silently omits changed lines.
const MAX_PREVIEW_BYTES = 16 * 1024 * 1024;
const MAX_LINES = 500_000;
const MAX_EDIT_DISTANCE = 256;
const MAX_WORK = 4_000_000;

const asBytes = value => value == null ? null : value instanceof Uint8Array ? value : new Uint8Array(value);

function sameBytes(a, b) {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function decode(bytes) {
  if (bytes === null) return { text: '', encoding: '文件不存在', lossy: false };
  let label = 'utf-8', bom = '';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { label = 'utf-16le'; bom = '（带 BOM）'; }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { label = 'utf-16be'; bom = '（带 BOM）'; }
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bom = '（带 BOM）';
  try {
    return { text: new TextDecoder(label, { fatal: true }).decode(bytes), encoding: label.toUpperCase() + bom, lossy: false };
  } catch {
    if (label !== 'utf-8') throw new Error('历史文件的 UTF-16 内容不完整，无法按文本比较。');
    try { return { text: new TextDecoder('gbk', { fatal: true }).decode(bytes), encoding: 'GBK（自动识别）', lossy: false }; }
    catch { return { text: new TextDecoder('gbk').decode(bytes), encoding: 'GBK（含无法识别的字节）', lossy: true }; }
  }
}

function splitLines(text) {
  const result = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\n' && text[i] !== '\r') continue;
    if (text[i] === '\r' && text[i + 1] === '\n') i++;
    result.push(text.slice(start, i + 1));
    start = i + 1;
    if (result.length > MAX_LINES) throw new Error('文件行数过多，无法在内置差异中完整显示。');
  }
  if (start < text.length) result.push(text.slice(start));
  if (result.length > MAX_LINES) throw new Error('文件行数过多，无法在内置差异中完整显示。');
  return result;
}

function sections(lines) {
  let current = '';
  return lines.map(line => {
    const match = line.replace(/[\r\n]+$/, '').match(/^\s*\[([^\]]+)\]\s*(?:;.*)?$/);
    if (match) current = match[1].trim();
    return current;
  });
}

function coarse(oldLength, newLength, prefix) {
  const edits = [];
  for (let x = 0; x < oldLength; x++) edits.push({ type: 'removed', oldIndex: prefix + x, newIndex: prefix });
  for (let y = 0; y < newLength; y++) edits.push({ type: 'added', oldIndex: prefix + oldLength, newIndex: prefix + y });
  return edits;
}

function middleEdits(oldLines, newLines, prefix, oldEnd, newEnd) {
  const n = oldEnd - prefix, m = newEnd - prefix;
  if (!n || !m) return { edits: coarse(n, m, prefix), coarse: false };
  const trace = [], vector = new Map([[1, 0]]);
  const value = (map, key) => map.has(key) ? map.get(key) : -Infinity;
  let work = 0;
  for (let distance = 0; distance <= Math.min(n + m, MAX_EDIT_DISTANCE); distance++) {
    trace.push(new Map(vector));
    for (let k = -distance; k <= distance; k += 2) {
      if (++work > MAX_WORK) return { edits: coarse(n, m, prefix), coarse: true };
      let x = k === -distance || (k !== distance && value(vector, k - 1) < value(vector, k + 1))
        ? value(vector, k + 1) : value(vector, k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && oldLines[prefix + x] === newLines[prefix + y]) {
        x++; y++;
        if (++work > MAX_WORK) return { edits: coarse(n, m, prefix), coarse: true };
      }
      vector.set(k, x);
      if (x < n || y < m) continue;
      const edits = [];
      let bx = n, by = m;
      for (let d = trace.length - 1; d >= 0; d--) {
        const previous = trace[d], diagonal = bx - by;
        const previousDiagonal = diagonal === -d || (diagonal !== d && value(previous, diagonal - 1) < value(previous, diagonal + 1))
          ? diagonal + 1 : diagonal - 1;
        const previousX = previous.get(previousDiagonal) ?? 0, previousY = previousX - previousDiagonal;
        while (bx > previousX && by > previousY) { bx--; by--; }
        if (!d) break;
        if (bx === previousX) { by--; edits.push({ type: 'added', oldIndex: prefix + bx, newIndex: prefix + by }); }
        else { bx--; edits.push({ type: 'removed', oldIndex: prefix + bx, newIndex: prefix + by }); }
      }
      edits.reverse();
      return { edits, coarse: false };
    }
  }
  return { edits: coarse(n, m, prefix), coarse: true };
}

function displayLine(line) {
  const match = line.match(/(\r\n|\r|\n)$/);
  const end = match?.[1] || '';
  return { text: end ? line.slice(0, -end.length) : line, eol: end === '\r\n' ? 'CRLF' : end === '\n' ? 'LF' : end === '\r' ? 'CR' : '无换行' };
}

export function compareHistoryBytes(before, after) {
  const a = asBytes(before), b = asBytes(after), identical = sameBytes(a, b);
  const result = { beforeExists: a !== null, afterExists: b !== null, identical, rows: [], coarse: false, note: '', beforeEncoding: '', afterEncoding: '' };
  if (identical) return result;
  if ((a?.length || 0) > MAX_PREVIEW_BYTES || (b?.length || 0) > MAX_PREVIEW_BYTES) {
    result.note = '文件超过 16 MB，无法在内置差异中完整显示；可下载可用的文件进行比较。';
    return result;
  }
  try {
    const oldText = decode(a), newText = decode(b);
    result.beforeEncoding = oldText.encoding; result.afterEncoding = newText.encoding;
    if (oldText.lossy || newText.lossy) result.note = '部分字节无法按 UTF-8 或 GBK 解码，文本显示可能不完整；可下载文件进一步比较。';
    if (oldText.text.includes('\0') || newText.text.includes('\0')) {
      result.note = '文件包含无法按普通规则文本展示的字节；可下载可用的文件进行比较。';
      return result;
    }
    const oldLines = splitLines(oldText.text), newLines = splitLines(newText.text);
    let prefix = 0, oldEnd = oldLines.length, newEnd = newLines.length;
    while (prefix < oldEnd && prefix < newEnd && oldLines[prefix] === newLines[prefix]) prefix++;
    while (oldEnd > prefix && newEnd > prefix && oldLines[oldEnd - 1] === newLines[newEnd - 1]) { oldEnd--; newEnd--; }
    const diff = middleEdits(oldLines, newLines, prefix, oldEnd, newEnd);
    result.coarse = diff.coarse;
    const oldSections = sections(oldLines), newSections = sections(newLines);
    result.rows = diff.edits.map(edit => {
      const removed = edit.type === 'removed', index = removed ? edit.oldIndex : edit.newIndex;
      return { ...edit, line: index + 1, section: (removed ? oldSections : newSections)[index] || '', ...displayLine((removed ? oldLines : newLines)[index]) };
    });
    if (diff.coarse) result.note = [result.note, '改动较多，使用完整的粗略对比；其中部分未变行可能同时显示为删除和新增。'].filter(Boolean).join(' ');
    if (!result.rows.length && a !== null && b !== null) result.note = [result.note, '文本内容相同，但文件字节不同（例如编码或 BOM）。'].filter(Boolean).join(' ');
  } catch (error) {
    result.note = `${error.message || error} 可下载可用的文件进行比较。`;
  }
  return result;
}
