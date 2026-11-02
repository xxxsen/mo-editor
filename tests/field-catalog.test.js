import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, parseFile } from '../src/ini.js';
import { availableFields } from '../src/field-catalog.js';

const data = `[InfantryTypes]\n0=A\n1=B\n[VehicleTypes]\n0=TANK\n[Projectiles]\n0=PROJ\n[Warheads]\n0=WH\n[ArmorTypes]\ncustom=heavy\n[A]\nName=Example\nStrength=100\n[B]\nName=Other\nImmuneToEMP=no\nCustom.UnitFlag=yes\n[TANK]\nName=Vehicle\nVehicleOnly=3\n[PROJ]\nInviso=yes\n[WH]\nVerses=100%\n[General]\nName=Rules\n[IQ]\nRepairSell=0\n`;
const project = new IniProject([parseFile('rulesmo.ini', new TextEncoder().encode(data))]);
const entities = ['A', 'B'].map(id => ({ id, type: 'infantry', exists: true })).concat([
  { id: 'TANK', type: 'vehicle', exists: true }, { id: 'PROJ', type: 'projectile', exists: true },
  { id: 'WH', type: 'warhead', exists: true }, { id: 'General', type: 'global', exists: true },
  { id: 'IQ', type: 'global', exists: true },
]);

test('suggestions combine documented and same-type fields without including existing or pending keys', () => {
  const options = availableFields(project, entities[0], entities, ['SELFHEALING']);
  assert.equal(options.find(item => item.name === 'ImmuneToEMP').group, '同类对象已使用 · 已收录');
  assert.equal(options.find(item => item.name === 'Custom.UnitFlag').group, '同类对象已使用 · 含义未收录');
  assert.ok(!options.some(item => /^(Name|Strength|SelfHealing|VehicleOnly)$/i.test(item.name)));
  assert.equal(options.find(item => item.name === 'Power').group, '其他已收录单位字段 · 适用类型待确认');
  assert.equal(options.find(item => item.name === 'Armor').group, '当前类型已收录');
  assert.ok(options.some(item => item.name === 'Weapon1' && item.known));
});

test('field dictionaries and dynamic armor suggestions respect object context', () => {
  const projectile = availableFields(project, entities[3], entities);
  assert.ok(projectile.some(item => item.name === 'Arcing' && item.known));
  assert.ok(projectile.some(item => item.name === 'Strength' && item.known), 'Phobos projectiles may have interception strength');
  assert.ok(!projectile.some(item => item.name === 'Weapon1'));
  const warhead = availableFields(project, entities[4], entities);
  assert.ok(warhead.some(item => item.name === 'Versus.custom' && item.known));
  assert.ok(warhead.some(item => item.name === 'Versus.custom.ForceFire' && item.known));
  assert.ok(!warhead.some(item => item.name === 'AttachEffect.Delay'));
  const global = availableFields(project, entities[5], entities);
  assert.ok(global.some(item => item.name === 'BuildSpeed' && item.known));
  assert.ok(global.some(item => item.name === 'UIName' && item.known));
  assert.ok(!global.some(item => item.name === 'Strength'));
  assert.ok(!global.some(item => item.name === 'RepairSell'), 'unrelated global sections must not be treated as the same type');
  assert.deepEqual(availableFields(project, { id: 'missing', type: 'weapon' }, entities), []);
});
