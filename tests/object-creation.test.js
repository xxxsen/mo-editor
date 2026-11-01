import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, listTypes, parseFile, serialize } from '../src/ini.js';
import { prepareObjectCreation } from '../src/object-creation.js';

const e = new TextEncoder();
const d = new TextDecoder();
const file = (name, text) => parseFile(name, e.encode(text));
const textOf = file => d.decode(serialize(file));

test('clones effective fields and appends registration after all existing types', () => {
  const main = file('rulesmo.ini', '[InfantryTypes]\r\n0=VIRUS\r\n5=OTHER\r\n[VIRUS]\r\nName=Virus\r\nUIName=NAME:Virus\r\nPrimary=Virusgun\r\nCustom.Hidden=yes ; preserve\r\n[#include]\r\n0=extra.ini\r\n');
  const extra = file('extra.ini', '[InfantryTypes]\n2=EXTRA\n; end of list\n[VIRUS]\nCost=1000 ; cost');
  const project = new IniProject([main, extra]);
  project.set('VIRUS', 'Cost', '1250');
  const original = textOf(extra);
  const result = prepareObjectCreation(project, { type: 'infantry', id: 'VIRUS_NEW', template: 'VIRUS' });
  const copy = result.project;
  assert.equal(textOf(extra), original, 'preparing the candidate must not mutate the current project');
  assert.equal(result.registryIndex, 6);
  assert.equal(result.registryFile.path, 'extra.ini');
  assert.deepEqual(listTypes(copy, 'InfantryTypes'), ['VIRUS', 'OTHER', 'EXTRA', 'VIRUS_NEW']);
  assert.equal(copy.get('VIRUS_NEW', 'Name').value, 'Virus');
  assert.equal(copy.get('VIRUS_NEW', 'Cost').value, '1250');
  assert.equal(copy.get('VIRUS_NEW', 'Image').value, 'VIRUS');
  assert.equal(copy.get('VIRUS_NEW', 'Primary').value, 'Virusgun');
  assert.match(textOf(result.definitionFile), /Custom\.Hidden=yes ; preserve/);
  assert.match(textOf(result.registryFile), /2=EXTRA\n; end of list\n6=VIRUS_NEW\n\[VIRUS\]/);
  assert.ok(copy.changes().some(change => change.kind === 'section' && change.section === 'VIRUS_NEW'));
  assert.ok(copy.changes().some(change => change.section === 'InfantryTypes' && change.key === '6'));
  const reloaded = new IniProject(copy.files.map(item => parseFile(item.name, serialize(item), item.path)), 'rulesmo.ini');
  assert.deepEqual(listTypes(reloaded, 'InfantryTypes'), ['VIRUS', 'OTHER', 'EXTRA', 'VIRUS_NEW']);
  assert.equal(reloaded.get('VIRUS_NEW', 'Cost').value, '1250');
});

test('clone preserves non-ASCII GBK bytes and inline comments in the source encoding', () => {
  const bytes = Uint8Array.from([...e.encode('[InfantryTypes]\r\n0=BASE\r\n[BASE]\r\nName='), 0xd6, 0xd0, 0xce, 0xc4, ...e.encode(' ; old\r\nPrimary=Gun\r\n')]);
  const main = parseFile('rulesmo.ini', bytes);
  const project = new IniProject([main]);
  const result = prepareObjectCreation(project, { type: 'infantry', id: 'NEW', template: 'BASE' });
  const output = serialize(result.definitionFile);
  assert.equal(result.project.get('NEW', 'Name').value, '中文');
  const oldLine = Uint8Array.from([...e.encode('Name='), 0xd6, 0xd0, 0xce, 0xc4, ...e.encode(' ; old')]);
  assert.ok(Buffer.from(output).includes(Buffer.from(oldLine)));
  assert.ok(Buffer.from(output).indexOf(Buffer.from(oldLine)) !== Buffer.from(output).lastIndexOf(Buffer.from(oldLine)));
  assert.deepEqual(serialize(main), bytes);
});

test('unit clones preserve an explicit image and fill an empty image with the template ID', () => {
  const project = new IniProject([file('rulesmo.ini', '[InfantryTypes]\n0=A\n1=B\n[A]\nImage=SharedArt\n[B]\nImage= ; blank image\n')]);
  const a = prepareObjectCreation(project, { type: 'infantry', id: 'A_NEW', template: 'A' });
  assert.equal(a.project.get('A_NEW', 'Image').value, 'SharedArt');
  const b = prepareObjectCreation(a.project, { type: 'infantry', id: 'B_NEW', template: 'B' });
  assert.equal(b.project.get('B_NEW', 'Image').value, 'B');
  assert.equal(b.project.get('B', 'Image').value, '');
  assert.match(textOf(b.definitionFile), /\[B_NEW\]\nImage= B; blank image/);
});

test('unsafe mixed encodings reject the entire candidate without mutating pending changes', () => {
  const main = parseFile('rulesmo.ini', Uint8Array.from([...e.encode('[InfantryTypes]\n0=U\n[U]\nName='), 0xd6, 0xd0, ...e.encode('\n[#include]\n0=extra.ini\n')]));
  const extra = file('extra.ini', '[U]\nCost=10\n');
  const project = new IniProject([main, extra]);
  project.set('U', 'Cost', '20');
  const before = project.files.map(serialize);
  assert.throws(() => prepareObjectCreation(project, { type: 'infantry', id: 'NEW', template: 'U' }), /编码/);
  assert.deepEqual(project.files.map(serialize), before);
  assert.equal(project.get('U', 'Cost').value, '20');
});

test('blank objects, missing lists and generic sections remain visible as unsaved changes', () => {
  const main = file('rulesmo.ini', '[General]\nValue=1');
  const project = new IniProject([main]);
  const created = prepareObjectCreation(project, { type: 'projectile', id: 'NewProj' });
  assert.equal(created.registryCreated, true);
  assert.equal(created.registryIndex, 0);
  assert.deepEqual(listTypes(created.project, 'Projectiles'), ['NewProj']);
  assert.ok(created.project.section('NewProj'));
  assert.ok(created.project.changes().some(change => change.kind === 'section' && change.section === 'NewProj'));
  assert.match(textOf(created.definitionFile), /Value=1\n\[NewProj\]\n\[Projectiles\]\n0=NewProj\n/);
  const generic = prepareObjectCreation(created.project, { type: 'sections', id: 'CustomRules' });
  assert.ok(generic.project.section('CustomRules'));
  assert.equal(generic.registry, '');
  assert.ok(generic.project.changes().some(change => change.kind === 'section' && change.section === 'CustomRules'));
});

test('every supported object type can be created and rediscovered after saving', () => {
  let project = new IniProject([file('rulesmo.ini', '[General]\nValue=1\n')]);
  const types = [
    ['infantry', 'InfantryTypes'], ['vehicle', 'VehicleTypes'], ['aircraft', 'AircraftTypes'],
    ['building', 'BuildingTypes'], ['weapon', 'WeaponTypes'], ['projectile', 'Projectiles'],
    ['warhead', 'Warheads'], ['superweapon', 'SuperWeaponTypes'],
  ];
  for (const [type, registry] of types) {
    const id = `NEW_${type}`;
    const result = prepareObjectCreation(project, { type, id });
    project = result.project;
    assert.deepEqual(listTypes(project, registry), [id]);
    assert.ok(project.section(id));
  }
  const reloaded = new IniProject(project.files.map(item => parseFile(item.name, serialize(item), item.path)), 'rulesmo.ini');
  for (const [type, registry] of types) {
    assert.deepEqual(listTypes(reloaded, registry), [`NEW_${type}`]);
    assert.ok(reloaded.section(`NEW_${type}`));
  }
});

test('creation rejects invalid IDs, case-insensitive collisions, missing references and incomplete rules', () => {
  const project = new IniProject([file('rulesmo.ini', '[InfantryTypes]\n0=Existing\n1=Missing\n[Existing]\nName=Unit\n')]);
  assert.throws(() => prepareObjectCreation(project, { type: 'infantry', id: 'bad id' }), /规则 ID/);
  assert.throws(() => prepareObjectCreation(project, { type: 'weapon', id: 'eXisTing' }), /已存在/);
  assert.throws(() => prepareObjectCreation(project, { type: 'weapon', id: 'missing' }), /已存在/);
  assert.throws(() => prepareObjectCreation(project, { type: 'weapon', id: 'Unresolved', reservedIds: ['UNRESOLVED'] }), /已存在/);
  assert.throws(() => prepareObjectCreation(project, { type: 'weapon', id: 'WeaponTypes' }), /已存在/);
  assert.throws(() => prepareObjectCreation(project, { type: 'weapon', id: 'new', template: 'not-there' }), /找不到模板/);
  const incomplete = new IniProject([file('rulesmo.ini', '[#include]\n0=missing.ini\n')]);
  assert.throws(() => prepareObjectCreation(incomplete, { type: 'weapon', id: 'new' }), /加载不完整/);
  assert.equal(project.changes().length, 0);
});

test('game object IDs fit the engine storage while generic sections remain unrestricted', () => {
  const project = new IniProject([file('rulesmo.ini', '[General]\nValue=1\n')]);
  const longest = 'ABCDEFGHIJKLMNOPQRSTUVWX';
  assert.equal(prepareObjectCreation(project, { type: 'weapon', id: longest }).id, longest);
  assert.throws(() => prepareObjectCreation(project, { type: 'weapon', id: `${longest}Y` }), /最多 24 个字符/);
  assert.equal(prepareObjectCreation(project, { type: 'sections', id: `${longest}Y` }).id, `${longest}Y`);
  assert.equal(project.changes().length, 0);
});

test('fork retains pending new-field bookkeeping without changing the original file', () => {
  const main = file('rulesmo.ini', '[VehicleTypes]\n0=U\n[U]');
  const project = new IniProject([main]);
  project.set('U', 'Speed', '5');
  const result = prepareObjectCreation(project, { type: 'vehicle', id: 'NEW', template: 'U' });
  result.project.set('U', 'Speed', '');
  assert.equal(project.get('U', 'Speed').value, '5');
  assert.equal(result.project.get('U', 'Speed'), undefined);
  assert.equal(result.project.get('NEW', 'Speed').value, '5');
  assert.match(textOf(result.definitionFile), /\[U\]\n\[NEW\]/);
});
