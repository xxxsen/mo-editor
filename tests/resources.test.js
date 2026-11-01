import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsf, hashMixFilename, MixArchive, decodePcx, GameResources } from '../src/resources.js';

const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
function csfRecord(label, strings) {
  const name = Buffer.from(label, 'ascii');
  const records = [Buffer.from(' LBL'), u32(strings.length), u32(name.length), name];
  for (const [value, extra] of strings) {
    const encoded = Buffer.from(value, 'utf16le').map(byte => byte ^ 0xff);
    records.push(Buffer.from(extra === undefined ? ' RTS' : 'WRTS'), u32(encoded.length / 2), encoded);
    if (extra !== undefined) { const bytes = Buffer.from(extra, 'ascii'); records.push(u32(bytes.length), bytes); }
  }
  return Buffer.concat(records);
}
function csfFixture() {
  return Buffer.concat([Buffer.from(' FSC'), u32(3), u32(2), u32(3), u32(0), u32(0),
    csfRecord('NAME:E1', [['盟军大兵'], ['other']]), csfRecord('NAME:MTNK', [['骑士中型坦克', 'sample']])]);
}

test('CSF strings decode Chinese, multiple values and extra-data records', () => {
  const data = csfFixture();
  const result = parseCsf(data);
  assert.equal(result.get('name:e1'), '盟军大兵');
  assert.equal(result.get('name:mtnk'), '骑士中型坦克');
  assert.throws(() => parseCsf(data.subarray(0, data.length - 2)), /不完整/);
  assert.throws(() => parseCsf(Buffer.from('invalid')), /有效|不完整/);
});

test('MIX lookup accepts valid entries even if sentinel entries are out of bounds', async () => {
  assert.equal(hashMixFilename('artmo.ini'), 0x062dc483);
  assert.equal(hashMixFilename('GIICON.PCX'), 0xc04a2349);
  const data = Buffer.from('art definition');
  const header = Buffer.alloc(10 + 24);
  header.writeUInt16LE(2, 4);
  header.writeUInt32LE(data.length, 6);
  header.writeUInt32LE(hashMixFilename('artmo.ini'), 10);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(hashMixFilename('bad.pcx'), 22);
  header.writeUInt32LE(0xffffffff, 26);
  header.writeUInt32LE(0xffffffff, 30);
  const archive = await MixArchive.open(new Blob([header, data]));
  assert.equal(archive.has('ARTMO.INI'), true);
  assert.equal(archive.has('bad.pcx'), false);
  assert.equal(Buffer.from(await archive.read('artmo.ini')).toString(), 'art definition');
  assert.equal(await archive.read('missing.pcx'), null);
});

test('MIX rule lookup chooses the highest numbered expansion containing the file', async () => {
  function archive(name, contents) {
    const data = Buffer.from(contents);
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 4);
    header.writeUInt32LE(data.length, 6);
    header.writeUInt32LE(hashMixFilename('rulesmo.ini'), 10);
    header.writeUInt32LE(data.length, 18);
    return Object.assign(new Blob([header, data]), { name, webkitRelativePath: '' });
  }
  const resources = await GameResources.load([
    archive('expandmo96.mix', 'older'), archive('expandmo99.mix', 'newer'), archive('expandmo98.mix', 'middle'),
  ]);
  const rule = await resources.findFile('rulesmo.ini');
  assert.equal(rule.archive, 'expandmo99.mix');
  assert.equal(Buffer.from(rule.bytes).toString(), 'newer');
  assert.equal(await resources.findFile('missing.ini'), null);
});

test('client country names load from the selected game directory', async () => {
  const file = Object.assign(new Blob(['[General]\nSides=美国,欧洲联盟\n']), { name: 'GameOptions.ini', webkitRelativePath: 'MentalOmega/Resources/GameOptions.ini' });
  const resources = await GameResources.load([file]);
  assert.deepEqual(resources.clientSides, ['美国', '欧洲联盟']);
});

test('PCX decoder respects run length encoding, row padding and palette', () => {
  const header = Buffer.alloc(128);
  header[0] = 0x0a; header[1] = 5; header[2] = 1; header[3] = 8;
  header.writeUInt16LE(2, 8); header.writeUInt16LE(1, 10);
  header[65] = 1; header.writeUInt16LE(4, 66);
  const compressed = Buffer.from([0xc3, 1, 0, 0xc2, 2, 1, 0]);
  const palette = Buffer.alloc(769); palette[0] = 12;
  palette.set([255, 0, 0], 1 + 3); palette.set([0, 255, 0], 1 + 6);
  const input = Buffer.concat([header, compressed, palette]);
  const image = decodePcx(input);
  assert.deepEqual([image.width, image.height], [3, 2]);
  assert.deepEqual([...image.pixels], [255,0,0,255, 255,0,0,255, 255,0,0,255, 0,255,0,255, 0,255,0,255, 255,0,0,255]);
  assert.throws(() => decodePcx(input.subarray(0, 130)), /格式/);
});
