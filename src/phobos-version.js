// Inspect the version resource of a PE file without executing it. A DLL on disk
// says nothing about whether the game actually loaded it or its launch flags.
export function phobosVersion(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const within = (offset, size) => Number.isSafeInteger(offset) && offset >= 0 && offset + size <= bytes.length;
  const u16 = offset => within(offset, 2) ? view.getUint16(offset, true) : 0;
  const u32 = offset => within(offset, 4) ? view.getUint32(offset, true) : 0;
  if (u16(0) !== 0x5a4d || !within(0x3c, 4)) return null;
  const pe = u32(0x3c);
  if (!within(pe, 24) || u32(pe) !== 0x00004550) return null;
  const count = u16(pe + 6), optional = u16(pe + 20), sections = pe + 24 + optional;
  if (count > 96 || !within(sections, count * 40)) return null;
  const marker = 'VS_VERSION_INFO';
  for (let i = 0; i < count; i++) {
    const at = sections + i * 40;
    const name = String.fromCharCode(...bytes.slice(at, at + 8)).replace(/\0.*$/, '');
    if (name !== '.rsrc') continue;
    const size = u32(at + 16), start = u32(at + 20), end = start + size;
    if (!within(start, size)) return null;
    for (let key = start + 6; key + marker.length * 2 + 2 <= end; key += 2) {
      let match = true;
      for (let j = 0; j < marker.length; j++) if (u16(key + j * 2) !== marker.charCodeAt(j)) { match = false; break; }
      if (!match || u16(key + marker.length * 2) !== 0) continue;
      const block = key - 6, length = u16(block), valueLength = u16(block + 2);
      const fixed = (key + (marker.length + 1) * 2 + 3) & ~3;
      if (length < fixed - block + 52 || valueLength < 52 || block + length > end || u32(fixed) !== 0xfeef04bd) continue;
      const ms = u32(fixed + 8), ls = u32(fixed + 12);
      // Check the resource identifies Phobos, rather than trusting a renamed DLL.
      let text = '';
      for (let p = block; p + 1 < block + length; p += 2) text += String.fromCharCode(u16(p));
      if (!/Phobos/i.test(text)) return null;
      return [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff].join('.');
    }
  }
  return null;
}

export async function detectPhobos(files) {
  const file = [...files].find(item => {
    const path = (item.path || item.webkitRelativePath?.split('/').slice(1).join('/') || item.name || '').replaceAll('\\', '/');
    return /^phobos\.dll$/i.test(path);
  });
  if (!file) return { status: 'missing', version: '' };
  if (file.size > 32 * 1024 * 1024) return { status: 'unknown', version: '' };
  try {
    const version = phobosVersion(new Uint8Array(await file.arrayBuffer()));
    return version ? { status: 'detected', version } : { status: 'unknown', version: '' };
  } catch { return { status: 'unknown', version: '' }; }
}
