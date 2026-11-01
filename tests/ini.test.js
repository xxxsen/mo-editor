import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, listTypes, parseFile, serialize } from '../src/ini.js';
const e = new TextEncoder();
const d = new TextDecoder();
const file = (name, text) => parseFile(name, e.encode(text));

test('an untouched file round-trips byte-for-byte including BOM, comments and mixed line endings', () => {
  const input = e.encode('\ufeff; 标注\r\n[Unit]\n Cost = 700  ; preserve\rother without equals\n[Unit]\r\nStrength=300');
  const parsed = parseFile('rulesmo.ini', input);
  assert.deepEqual(serialize(parsed), input);
  const project = new IniProject([parsed], parsed.path);
  assert.equal(project.get('unit', 'COST').value, '700');
});

test('changing a duplicate key updates its effective line and preserves surrounding bytes', () => {
  const source = file('rulesmo.ini', '[U]\r\nCost=500\r\n[U]\r\n  Cost = 700  ; comment\r\nUnknown=yes\r\n');
  const project = new IniProject([source]);
  project.set('u', 'cost', '850');
  assert.equal(d.decode(serialize(source)), '[U]\r\nCost=500\r\n[U]\r\n  Cost = 850  ; comment\r\nUnknown=yes\r\n');
  assert.equal(project.changes().length, 1);
  project.set('U', 'Cost', '700');
  assert.equal(project.changes().length, 0);
});

test('Ares includes load depth-first and changes affect the last loaded definition', () => {
  const main = file('rulesmo.ini', '[#include]\n0=a.ini\n1=b.ini\n[Unit]\nCost=100\n[VehicleTypes]\n0=Unit\n');
  const a = file('a.ini', '[#include]\n0=c.ini\n[Unit]\nCost=200\n');
  const b = file('b.ini', '[Unit]\nCost=400\n');
  const c = file('c.ini', '[Unit]\nCost=300\n');
  const project = new IniProject([main, a, b, c]);
  assert.deepEqual(project.loadOrder.map(item => item.name), ['rulesmo.ini', 'a.ini', 'c.ini', 'b.ini']);
  assert.equal(project.get('Unit','Cost').value, '400');
  assert.equal(project.get('Unit','Cost').file, b);
  assert.deepEqual(listTypes(project, 'VehicleTypes'), ['Unit']);
  project.set('Unit','Cost','425');
  assert.equal(d.decode(serialize(b)), '[Unit]\nCost=425\n');
  assert.equal(d.decode(serialize(main)).includes('Cost=100'), true);
});

test('unresolved and cyclic includes are reported without silently guessing paths', () => {
  const main = file('rulesmo.ini', '[#include]\n0=folder/missing.ini\n1=a.ini\n');
  const a = file('a.ini', '[#include]\n0=rulesmo.ini\n');
  const unrelated = file('missing.ini', '[U]\nCost=1\n');
  const project = new IniProject([main, a, unrelated]);
  assert.equal(project.warnings.length, 2);
  assert.match(project.warnings[0], /folder\/missing.ini/);
  assert.match(project.warnings[1], /循环引用/);
});

test('unsupported Phobos include and section inheritance are reported', () => {
  const source = file('rulesmo.ini', '[$Include]\n0=extra.ini\n[U]\n$Inherits=BASE\n');
  const project = new IniProject([source]);
  assert.equal(project.warnings.length, 2);
  assert.match(project.warnings[0], /\[\$Include\]/);
  assert.match(project.warnings[1], /\$Inherits/);
});

test('GBK files preserve original non-ASCII bytes and reject unsafe non-ASCII writes', () => {
  const input = Uint8Array.from([...e.encode('[U]\r\nName='), 0xd6,0xd0,0xce,0xc4, ...e.encode('\r\nCost=700 ; test\r\n')]);
  const source = parseFile('rulesmo.ini', input);
  const project = new IniProject([source]);
  assert.equal(project.get('U', 'Name').value, '中文');
  project.set('U', 'Cost', '850');
  const expected = Uint8Array.from([...e.encode('[U]\r\nName='), 0xd6,0xd0,0xce,0xc4, ...e.encode('\r\nCost=850 ; test\r\n')]);
  assert.deepEqual(serialize(source), expected);
  assert.throws(() => project.set('U', 'Name', '新名字'), /编码/);
});

test('new properties go into the last loaded section and can be removed', () => {
  const main = file('rulesmo.ini','[#include]\n0=extra.ini\n[U]\nCost=500\n');
  const extra = file('extra.ini','[U]');
  const project = new IniProject([main, extra]);
  project.set('U','Speed','7');
  project.set('U','Sight','8');
  assert.equal(project.get('U','Speed').file, extra);
  project.set('U','Speed','');
  assert.equal(d.decode(serialize(extra)), '[U]\nSight=8\n');
  project.set('U','Sight','');
  assert.equal(d.decode(serialize(extra)), '[U]');
  assert.equal(project.changes().length, 0);
});

test('removing a field clears all loaded definitions, keeps other bytes, and tracks each changed file', () => {
  const main = file('rulesmo.ini', '[#include]\r\n0=extra.ini\r\n[U]\r\nImmuneToEMP=no ; original\r\nName=Test\r\n');
  const extra = file('extra.ini', '[U]\nImmuneToEMP=yes ; later\n[U]\nImmuneToEMP=no ; effective\nOther=keep\n');
  const unused = file('unused.ini', '[U]\nImmuneToEMP=yes\n');
  const project = new IniProject([main, extra, unused]);
  project.set('U', 'ImmuneToEMP', 'yes');
  const originals = project.files.map(serialize);
  const candidate = project.fork();
  const removed = candidate.remove('u', 'immunetoemp');
  assert.equal(removed.length, 3);
  assert.deepEqual(project.files.map(serialize), originals);
  assert.equal(project.get('U', 'ImmuneToEMP').value, 'yes');
  assert.equal(candidate.get('U', 'ImmuneToEMP'), undefined);
  assert.equal(candidate.changes().filter(change => change.kind === 'remove').length, 3);
  assert.equal(d.decode(serialize(candidate.files[0])), '[#include]\r\n0=extra.ini\r\n[U]\r\nName=Test\r\n');
  assert.equal(d.decode(serialize(candidate.files[1])), '[U]\n[U]\nOther=keep\n');
  assert.deepEqual(serialize(candidate.files[2]), serialize(unused));
  const reloaded = new IniProject(candidate.files.map(item => parseFile(item.name, serialize(item), item.path)));
  assert.equal(reloaded.get('U', 'ImmuneToEMP'), undefined);
  candidate.set('U', 'ImmuneToEMP', 'no');
  assert.equal(candidate.get('U', 'ImmuneToEMP').value, 'no');
  assert.match(d.decode(serialize(candidate.files[1])), /ImmuneToEMP=no/);
});

test('removing a new property restores a header without a newline and rejects incomplete loads', () => {
  const project = new IniProject([file('rulesmo.ini', '[U]')]);
  project.set('U', 'ImmuneToEMP', 'yes');
  project.remove('U', 'ImmuneToEMP');
  assert.equal(d.decode(serialize(project.files[0])), '[U]');
  assert.equal(project.changes().length, 0);
  const incomplete = new IniProject([file('rulesmo.ini', '[#include]\n0=missing.ini\n[U]\nImmuneToEMP=yes\n')]);
  const before = serialize(incomplete.files[0]);
  assert.throws(() => incomplete.remove('U', 'ImmuneToEMP'), /加载不完整/);
  assert.deepEqual(serialize(incomplete.files[0]), before);
});

test('unsafe multiline and UTF-16 data are rejected', () => {
  const project = new IniProject([file('x.ini','[U]\nName=Test\n')]);
  assert.throws(() => project.set('U','Name','a;b'), /分号/);
  assert.throws(() => project.set('U','Name','a\nb'), /换行/);
  assert.throws(() => parseFile('u.ini',Uint8Array.from([0xff,0xfe,0,0])), /UTF-16/);
});
