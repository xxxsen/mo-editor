import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, parseFile, serialize } from '../src/ini.js';
import { countriesFor, sidesFor, armorsFor, prerequisitesFor, mergeSelections, updateVerses, globalFieldInfo, STANDARD_ARMORS } from '../src/rule-schema.js';
const enc = new TextEncoder(), dec = new TextDecoder();
const project = new IniProject([parseFile('rulesmo.ini', enc.encode(`[General]
Name=Mental Omega demo
[Sides]
GDI=USA,Europe
Nod=USSR
[Countries]
0=USA
1=Europe
2=USSR
[USA]
UIName=NAME:USA
Name=United States
ListIndex=0
[Europe]
Name=European Alliance
[USSR]
Name=Soviet Union
[ArmorTypes]
custom_tank=heavy
hero_armor=flak
[GenericPrerequisites]
ALLWEAP=FACTORY,FACTORY2
[BuildingTypes]
0=FACTORY
[FACTORY]
Name=Vehicle Factory
[UNIT]
Owner=USA, Unregistered,Europe,USA
Armor=custom_tank
Prerequisite=ALLWEAP,UNKNOWN
[WARHEAD]
Verses=25%, 50%,100%,77% ; preserve
`))]);

test('country choices use registered factions, localized names and preserve unknown codes', () => {
  const choices = countriesFor(project, new Map([['name:usa', '美国']]), 'USA,Unregistered');
  assert.equal(choices.find(item => item.id === 'USA').label, '美国');
  assert.equal(choices.find(item => item.id === 'USA').group, '盟军 · GDI');
  assert.equal(choices.find(item => item.id === 'Unregistered').group, '当前未登记的代码');
  assert.equal(sidesFor(project).find(item => item.id === 'Nod').label, '苏联');
  assert.equal(countriesFor(project, null, '', [], ['客户端译名']).find(item => item.id === 'USA').label, '客户端译名');
  const mo = new IniProject([parseFile('mo.ini', enc.encode('[General]\nName=Mental Omega\n[Countries]\n0=UnitedStates\n[UnitedStates]\nName=United States\n'))]);
  assert.equal(countriesFor(mo, null).find(item => item.id === 'UnitedStates').label, '美国');
});

test('armor and prerequisite options derive from the current rule file', () => {
  const armor = armorsFor(project, 'unregistered_armor');
  assert.equal(STANDARD_ARMORS.length, 11);
  assert.equal(armor.find(item => item.id === 'custom_tank').hint, '默认：heavy');
  assert.equal(armor.find(item => item.id === 'unregistered_armor').group, '当前未登记的代码');
  const choices = prerequisitesFor(project, null, 'ALLWEAP,UNKNOWN');
  assert.equal(choices.find(item => item.id === 'ALLWEAP').hint, 'FACTORY,FACTORY2');
  assert.equal(choices.find(item => item.id === 'FACTORY').label, 'Vehicle Factory');
  assert.equal(choices.find(item => item.id === 'UNKNOWN').group, '当前未登记的代码');
});

test('global field labels and aliases are scoped to their section and ignore casing', () => {
  const repair = globalFieldInfo('iQ', 'rePAirSell');
  assert.equal(repair.label, '维修与出售（建筑自动维修）');
  assert.ok(repair.aliases.includes('建筑自动修理'));
  assert.match(repair.description, /设为 0/);
  assert.equal(globalFieldInfo('General', 'RepairSell').label, 'RepairSell');
  assert.equal(globalFieldInfo('Unknown', 'Unlisted').known, false);
});

test('multi-selection keeps untouched tokens, whitespace, order and unknown values', () => {
  const original = 'USA, Unregistered,Europe,USA';
  assert.equal(mergeSelections(original, ['USA', 'Europe', 'Unregistered']), original);
  assert.equal(mergeSelections(original, ['USA', 'Unregistered', 'USSR']), 'USA, Unregistered,USA,USSR');
  assert.equal(mergeSelections('USA,, Europe', ['USA', 'Europe', 'USSR']), 'USA,, Europe,USSR');
});

test('warhead armor edits preserve other slots and reject invalid or skipped entries', () => {
  assert.equal(updateVerses('25%, 50%,100%,77%', 1, '75%'), '25%, 75%,100%,77%');
  assert.equal(updateVerses('25%,50%', 2, '0.8'), '25%,50%,0.8');
  assert.throws(() => updateVerses('25%', 3, '75%'), /顺序/);
  assert.throws(() => updateVerses('25%', 0, 'strong'), /数值/);
});

test('structured edits keep unrelated INI text and comments intact', () => {
  const file = parseFile('demo.ini', enc.encode('[UNIT]\r\nOwner=USA, Unregistered,Europe ; keep\r\n[WARHEAD]\r\nVerses=25%, 50%,100% ; note\r\n'));
  const rule = new IniProject([file]);
  rule.set('UNIT', 'Owner', mergeSelections(rule.get('UNIT', 'Owner').value, ['USA', 'Unregistered', 'USSR']));
  rule.set('WARHEAD', 'Verses', updateVerses(rule.get('WARHEAD', 'Verses').value, 1, '75%'));
  assert.equal(dec.decode(serialize(file)), '[UNIT]\r\nOwner=USA, Unregistered,USSR ; keep\r\n[WARHEAD]\r\nVerses=25%, 75%,100% ; note\r\n');
});
