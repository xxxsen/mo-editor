import { IniProject, parseFile } from './ini.js';

const ascii = bytes => Array.from(bytes, byte => String.fromCharCode(byte)).join('');
const utf16 = new TextDecoder('utf-16le');
const lower = value => String(value || '').toLowerCase();

// A CSF contains little-endian records with inverted UTF-16 string bytes.
export function parseCsf(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const take = length => {
    if (!Number.isSafeInteger(length) || length < 0 || length > bytes.length - offset) throw new Error('CSF 文件不完整或格式无效。');
    const result = bytes.subarray(offset, offset + length);
    offset += length;
    return result;
  };
  const readInt = () => {
    if (offset + 4 > bytes.length) throw new Error('CSF 文件不完整或格式无效。');
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };
  if (ascii(take(4)) !== ' FSC') throw new Error('不是有效的 CSF 文件。');
  readInt(); // version
  const labelCount = readInt();
  readInt(); // string count
  readInt(); // reserved
  readInt(); // language id
  if (labelCount > 1_000_000) throw new Error('CSF 标签数量异常。');
  const labels = new Map();
  for (let i = 0; i < labelCount; i++) {
    if (ascii(take(4)) !== ' LBL') throw new Error('CSF 标签格式无效。');
    const values = readInt();
    const label = ascii(take(readInt()));
    if (values > 1000) throw new Error('CSF 字符串数量异常。');
    for (let n = 0; n < values; n++) {
      const type = ascii(take(4));
      if (type !== ' RTS' && type !== 'WRTS') throw new Error('CSF 字符串格式无效。');
      const length = readInt();
      const encoded = take(length * 2);
      const decoded = new Uint8Array(encoded.length);
      for (let j = 0; j < encoded.length; j++) decoded[j] = encoded[j] ^ 0xff;
      const value = utf16.decode(decoded);
      if (n === 0) labels.set(lower(label), value);
      if (type === 'WRTS') take(readInt());
    }
  }
  return labels;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

// Westwood's CRC32 filename hash pads the final partial group of four bytes.
export function hashMixFilename(name) {
  const upper = name.toUpperCase();
  if (/[^\x20-\x7e]/.test(upper)) throw new Error('资源文件名必须为 ASCII 字符。');
  const bytes = Array.from(upper, character => character.charCodeAt(0));
  const remainder = bytes.length % 4;
  if (remainder) {
    const fill = bytes[bytes.length - remainder];
    bytes.push(remainder);
    while (bytes.length % 4) bytes.push(fill);
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export class MixArchive {
  constructor(file, entries, dataStart) {
    this.file = file;
    this.entries = entries;
    this.dataStart = dataStart;
  }
  static async open(file) {
    const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (header.length < 6) throw new Error('MIX 文件头不完整。');
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const legacy = view.getUint16(0, true) !== 0;
    if (!legacy && header.length < 10) throw new Error('MIX 文件头不完整。');
    if (!legacy && (view.getUint16(2, true) & 2)) throw new Error('暂不支持加密的 MIX 索引。');
    const start = legacy ? 0 : 4;
    const count = view.getUint16(start, true);
    const dataStart = start + 6 + count * 12;
    if (dataStart > file.size) throw new Error('MIX 索引超出文件范围。');
    const table = new DataView(await file.slice(start + 6, dataStart).arrayBuffer());
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      const at = i * 12;
      const hash = table.getUint32(at, true);
      const offset = table.getUint32(at + 4, true);
      const length = table.getUint32(at + 8, true);
      // Some archives contain sentinel entries. Only expose entries within the file.
      if (offset <= file.size - dataStart && length <= file.size - dataStart - offset) entries.set(hash, { offset, length });
    }
    return new MixArchive(file, entries, dataStart);
  }
  has(name) { return this.entries.has(hashMixFilename(name)); }
  async read(name) {
    const entry = this.entries.get(hashMixFilename(name));
    if (!entry) return null;
    return new Uint8Array(await this.file.slice(this.dataStart + entry.offset, this.dataStart + entry.offset + entry.length).arrayBuffer());
  }
}

export function decodePcx(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 128 + 769 || bytes[0] !== 0x0a || bytes[2] !== 1 || bytes[3] !== 8 || bytes[65] !== 1 || bytes[bytes.length - 769] !== 12) {
    throw new Error('暂不支持该 PCX 图片格式。');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(8, true) - view.getUint16(4, true) + 1;
  const height = view.getUint16(10, true) - view.getUint16(6, true) + 1;
  const bytesPerLine = view.getUint16(66, true);
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || bytesPerLine < width || bytesPerLine * height > 16_777_216) {
    throw new Error('PCX 图片尺寸无效。');
  }
  const paletteStart = bytes.length - 768;
  const pixelEnd = paletteStart - 1;
  const indices = new Uint8Array(bytesPerLine * height);
  let source = 128, dest = 0;
  while (dest < indices.length) {
    if (source >= pixelEnd) throw new Error('PCX 像素数据不完整。');
    let value = bytes[source++], run = 1;
    if ((value & 0xc0) === 0xc0) {
      run = value & 0x3f;
      if (!run || source >= pixelEnd) throw new Error('PCX 压缩数据无效。');
      value = bytes[source++];
    }
    if (run > indices.length - dest) throw new Error('PCX 像素数据超出图片范围。');
    indices.fill(value, dest, dest + run);
    dest += run;
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const palette = paletteStart + indices[y * bytesPerLine + x] * 3;
    const target = (y * width + x) * 4;
    pixels[target] = bytes[palette]; pixels[target + 1] = bytes[palette + 1]; pixels[target + 2] = bytes[palette + 2]; pixels[target + 3] = 255;
  }
  return { width, height, pixels };
}

function relativePath(file) {
  return file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;
}
function pathDepth(file) { return relativePath(file).split('/').length; }
function byNearestPath(files) { return [...files].sort((a, b) => pathDepth(a) - pathDepth(b)); }
function archivePriority(file) {
  const match = file.name.match(/^expand(?:mo|md)(\d+)\.mix$/i);
  return match ? 1000 + Number(match[1]) : 0;
}

export class GameResources {
  constructor(strings, art, archives, pcxFiles, notes, clientSides = []) {
    this.strings = strings;
    this.art = art;
    this.archives = archives;
    this.pcxFiles = pcxFiles;
    this.notes = notes;
    this.clientSides = clientSides;
    this.icons = new Map();
  }
  static async load(files) {
    const ordered = byNearestPath(files);
    const notes = [];
    let strings = new Map();
    const csf = ordered.find(file => pathDepth(file) === 1 && lower(file.name) === 'ra2md.csf') || ordered.find(file => pathDepth(file) === 1 && /\.csf$/i.test(file.name));
    if (csf) {
      try { strings = parseCsf(new Uint8Array(await csf.arrayBuffer())); }
      catch (error) { notes.push(`无法读取 ${csf.name}：${error.message}`); }
    }
    let clientSides = [];
    const clientOptions = ordered.find(file => lower(relativePath(file)) === 'resources/gameoptions.ini');
    if (clientOptions) {
      try {
        const file = parseFile(clientOptions.name, new Uint8Array(await clientOptions.arrayBuffer()));
        const options = new IniProject([file]);
        clientSides = (options.get('General', 'Sides')?.value || '').split(',').map(value => value.trim());
      } catch (error) { notes.push(`无法读取客户端阵营名称：${error.message}`); }
    }
    const mixFiles = ordered.filter(file => /\.mix$/i.test(file.name) && pathDepth(file) === 1)
      .sort((a, b) => archivePriority(b) - archivePriority(a));
    const archives = (await Promise.all(mixFiles.map(file => MixArchive.open(file).catch(() => null)))).filter(Boolean);
    let artBytes = null;
    const artFile = ordered.find(file => pathDepth(file) === 1 && lower(file.name) === 'artmo.ini') || ordered.find(file => pathDepth(file) === 1 && lower(file.name) === 'artmd.ini');
    if (artFile) artBytes = new Uint8Array(await artFile.arrayBuffer());
    else {
      for (const name of ['artmo.ini', 'artmd.ini']) {
        const archive = archives.find(item => item.has(name));
        if (archive) { artBytes = await archive.read(name); break; }
      }
    }
    let art = null;
    if (artBytes) {
      try { const file = parseFile('artmo.ini', artBytes); art = new IniProject([file]); }
      catch (error) { notes.push(`无法解析美术规则：${error.message}`); }
    }
    const pcxFiles = new Map();
    for (const file of ordered.filter(item => /\.pcx$/i.test(item.name))) {
      if (!pcxFiles.has(lower(file.name))) pcxFiles.set(lower(file.name), file);
    }
    return new GameResources(strings, art, archives, pcxFiles, notes, clientSides);
  }
  async findFile(name) {
    for (const archive of this.archives) {
      if (!archive.has(name)) continue;
      const bytes = await archive.read(name);
      if (bytes) return { bytes, archive: archive.file.name };
    }
    return null;
  }
  async icon(project, id) {
    const image = project.get(id, 'Image')?.value || id;
    const name = project.get(id, 'SidebarPCX')?.value || this.art?.get(image, 'CameoPCX')?.value;
    if (!name) return null;
    const key = lower(name.trim());
    if (!this.icons.has(key)) this.icons.set(key, this.readIcon(key).catch(() => null));
    return this.icons.get(key);
  }
  async readIcon(name) {
    let bytes;
    const loose = this.pcxFiles.get(name);
    if (loose) bytes = new Uint8Array(await loose.arrayBuffer());
    else {
      const archive = this.archives.find(item => item.has(name));
      if (!archive) return null;
      bytes = await archive.read(name);
    }
    return decodePcx(bytes);
  }
}
