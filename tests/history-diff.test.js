import test from 'node:test';
import assert from 'node:assert/strict';
import { compareHistoryBytes } from '../src/history-diff.js';

const bytes = text => new TextEncoder().encode(text);

test('history diff identifies changed rule lines and their sections', () => {
  const before = bytes('[VIRUS]\r\nDamage=100 ; old\r\nRange=4\r\n');
  const after = bytes('[VIRUS]\r\nDamage=200 ; new\r\nRange=4\r\n');
  const result = compareHistoryBytes(before, after);
  assert.equal(result.coarse, false);
  assert.deepEqual(result.rows.map(row => [row.type, row.line, row.section, row.text, row.eol]), [
    ['removed', 2, 'VIRUS', 'Damage=100 ; old', 'CRLF'],
    ['added', 2, 'VIRUS', 'Damage=200 ; new', 'CRLF'],
  ]);
  assert.equal(result.beforeEncoding, 'UTF-8');
  assert.equal(result.afterEncoding, 'UTF-8');
});

test('created, deleted and empty files retain their distinct states', () => {
  const created = compareHistoryBytes(null, bytes('[NEW]\nValue=1\n'));
  assert.equal(created.beforeExists, false);
  assert.equal(created.afterExists, true);
  assert.deepEqual(created.rows.map(row => row.type), ['added', 'added']);
  const deleted = compareHistoryBytes(bytes('[OLD]\n'), null);
  assert.equal(deleted.afterExists, false);
  assert.equal(deleted.rows[0].type, 'removed');
  const empty = compareHistoryBytes(null, new Uint8Array());
  assert.equal(empty.identical, false);
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.afterExists, true);
});

test('GBK, UTF-16, BOM and line endings are represented without modifying bytes', () => {
  const gbk = new Uint8Array([0x5b, 0x41, 0x5d, 0x0a, 0x4e, 0x61, 0x6d, 0x65, 0x3d, 0xb2, 0xe2, 0xca, 0xd4, 0x0a]);
  const gbkChanged = gbk.slice(); gbkChanged[4] = 0x6e;
  const result = compareHistoryBytes(gbk, gbkChanged);
  assert.match(result.beforeEncoding, /GBK/);
  assert.ok(result.rows.some(row => row.text.includes('测试')));
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('A=1\n')]);
  assert.match(compareHistoryBytes(bytes('A=1\n'), bom).note, /字节不同/);
  const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0, 0x3d, 0, 0x32, 0, 0x0a, 0]);
  const encoded = compareHistoryBytes(bytes('A=1\n'), utf16);
  assert.match(encoded.afterEncoding, /UTF-16LE/);
  assert.ok(encoded.rows.some(row => row.text === 'A=2'));
  const endings = compareHistoryBytes(bytes('A=1\r\n'), bytes('A=1\n'));
  assert.deepEqual(endings.rows.map(row => row.eol), ['CRLF', 'LF']);
});

test('large or complex differences never silently disappear', () => {
  const oldText = Array.from({ length: 300 }, (_, i) => `old-${i}\n`).join('');
  const newText = Array.from({ length: 300 }, (_, i) => `new-${i}\n`).join('');
  const coarse = compareHistoryBytes(bytes(oldText), bytes(newText));
  assert.equal(coarse.coarse, true);
  assert.equal(coarse.rows.length, 600);
  assert.match(coarse.note, /粗略对比/);
  const oversized = compareHistoryBytes(new Uint8Array(16 * 1024 * 1024 + 1), bytes('x'));
  assert.match(oversized.note, /下载可用的文件/);
  const tooManyLines = compareHistoryBytes(bytes('a\n'.repeat(500_001)), bytes('x'));
  assert.match(tooManyLines.note, /行数过多/);
});

test('changed line positions preserve all common lines across randomized edits', () => {
  let seed = 123456789;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let sample = 0; sample < 1000; sample++) {
    const oldLines = Array.from({ length: random(18) }, () => `${random(5)}\n`);
    const newLines = Array.from({ length: random(18) }, () => `${random(5)}\n`);
    const result = compareHistoryBytes(bytes(oldLines.join('')), bytes(newLines.join('')));
    let oldIndex = 0, newIndex = 0;
    for (const row of result.rows) {
      while (oldIndex < row.oldIndex && newIndex < row.newIndex) assert.equal(oldLines[oldIndex++], newLines[newIndex++]);
      assert.equal(oldIndex, row.oldIndex); assert.equal(newIndex, row.newIndex);
      if (row.type === 'removed') oldIndex++; else newIndex++;
    }
    while (oldIndex < oldLines.length && newIndex < newLines.length) assert.equal(oldLines[oldIndex++], newLines[newIndex++]);
    assert.equal(oldIndex, oldLines.length); assert.equal(newIndex, newLines.length);
  }
});
