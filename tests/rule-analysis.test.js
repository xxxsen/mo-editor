import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, parseFile, serialize } from '../src/ini.js';
import { analyzeConstruction, analyzeWeaponEffect, armorMultiplier } from '../src/rule-analysis.js';
import { prepareIsolatedWeapon, unitWeaponSlots } from '../src/object-impact.js';

const encoder = new TextEncoder();
const fixture = () => new IniProject([parseFile('rulesmo.ini', encoder.encode(`
[InfantryTypes]
0=VIRUS
1=OTHER
[VehicleTypes]
0=TANK
[BuildingTypes]
0=BARRACKS_A
1=BARRACKS_B
2=TECHBUILDING
[WeaponTypes]
0=GUN
[Warheads]
0=HIT
1=BOMB
[Projectiles]
0=SHOT
[Countries]
0=Psi
1=Allies
[General]
PrerequisitePower=BARRACKS_A
PrerequisiteProcAlternate=TANK
[GenericPrerequisites]
GROUP=BARRACKS_A,BARRACKS_B
[ArmorTypes]
virus=plate
mobile=virus
magic=30%
cycle1=cycle2
cycle2=cycle1
forward=later
later=light
[VIRUS]
Owner=Psi
TechLevel=5
Prerequisite=GROUP,TECHBUILDING
Prerequisite.List0=
Prerequisite.Lists=1
Prerequisite.List1=BARRACKS_A
Primary=GUN
ElitePrimary=GUN
Armor=virus
[OTHER]
Primary=GUN
Armor=mobile
[TANK]
Armor=magic
[BARRACKS_A]
Factory=InfantryType
Factory.ExplicitOnly=yes
[BARRACKS_B]
Factory=UnitType
[TECHBUILDING]
Name=Tech
[GUN]
Damage=200
Projectile=SHOT
Warhead=HIT
IvanBomb.Damage=100
[SHOT]
AA=no
[HIT]
IvanBomb=yes
Verses=100%,100%,80%,50%,50%,50%,10%,10%,10%,100%,100%
Versus.virus=75%
[BOMB]
Verses=100%,100%,50%,50%,50%,50%,10%,10%,10%,100%,100%
[CombatDamage]
IvanWarhead=BOMB
IvanDamage=90
IvanTimedDelay=160
`))]);

test('build diagnosis checks country and level, resolves generic and alternate prerequisite lists', () => {
  const project = fixture();
  const result = analyzeConstruction(project, { id: 'VIRUS', type: 'infantry', country: 'Allies', techLevel: '4', inventory: ['BARRACKS_A'] });
  assert.equal(result.checks.find(item => item.label === 'Owner').status, 'warn');
  assert.equal(result.checks.find(item => item.label.includes('TechLevel')).status, 'warn');
  assert.equal(result.prerequisiteLists[0].status, 'warn');
  assert.equal(result.prerequisiteLists[1].status, 'ok');
  assert.deepEqual(result.prerequisiteLists[0].requirements[0].options, ['BARRACKS_A', 'BARRACKS_B']);
  assert.deepEqual(result.factories, [{ id: 'BARRACKS_A', explicitOnly: true }]);
  assert.equal(analyzeConstruction(project, { id: 'VIRUS', type: 'infantry' }).prerequisiteLists[0].status, 'unknown');
  project.set('VIRUS', 'Prerequisite.List0', 'POWER');
  assert.equal(analyzeConstruction(project, { id: 'VIRUS', type: 'infantry', inventory: ['BARRACKS_A'] }).prerequisiteLists[0].status, 'ok');
  project.set('VIRUS', 'Prerequisite.List0', '');
  assert.equal(analyzeConstruction(project, { id: 'VIRUS', type: 'infantry' }).prerequisiteLists[0].key, 'Prerequisite');
  project.set('VIRUS', 'Prerequisite.List0', 'PROC');
  assert.deepEqual(analyzeConstruction(project, { id: 'VIRUS', type: 'infantry' }).prerequisiteLists[0].requirements[0].options, ['TANK']);
  assert.equal(analyzeConstruction(project, { id: 'VIRUS', type: 'infantry', inventory: [] }).prerequisiteLists[0].status, 'unknown');
  project.set('General', 'PrerequisiteProc', 'TECHBUILDING');
  assert.deepEqual(analyzeConstruction(project, { id: 'VIRUS', type: 'infantry' }).prerequisiteLists[0].requirements[0].options, ['TECHBUILDING', 'TANK']);
});

test('armor resolution explains explicit values, inherited values, numeric defaults and unknown cycles', () => {
  const project = fixture();
  assert.equal(armorMultiplier(project, 'HIT', 'virus').value, 0.75);
  // Ares copies inherited defaults before applying parent-specific Versus overrides.
  assert.equal(armorMultiplier(project, 'HIT', 'mobile').value, 0.8);
  assert.equal(armorMultiplier(project, 'BOMB', 'virus').value, 0.5);
  assert.equal(armorMultiplier(project, 'HIT', 'magic').value, 0.3);
  assert.match(armorMultiplier(project, 'HIT', 'cycle1').reason, /循环/);
  assert.match(armorMultiplier(project, 'HIT', 'forward').reason, /顺序/);
  assert.match(armorMultiplier(project, 'HIT', 'unknown').reason, /未找到/);
  project.set('HIT', 'Versus.plate', '10%');
  assert.equal(armorMultiplier(project, 'HIT', 'mobile').value, 0.8);
  assert.equal(armorMultiplier(project, 'HIT', 'plate').value, 0.1);
  project.set('BOMB', 'Verses', '100%,,50%');
  assert.match(armorMultiplier(project, 'BOMB', 'plate').reason, /空项/);
});

test('weapon comparison keeps direct and default bomb damage separate and reflects draft edits', () => {
  const project = fixture();
  let result = analyzeWeaponEffect(project, 'GUN', 'VIRUS');
  assert.equal(result.stages.length, 2);
  assert.equal(result.stages[0].product, 150);
  assert.equal(result.stages[1].product, 50);
  assert.equal(result.stages[1].warhead, 'BOMB');
  assert.equal(result.stages[1].warheadSource, '[CombatDamage]IvanWarhead');
  assert.equal(result.stages[1].delay, '160');
  project.set('GUN', 'IvanBomb.Damage', '');
  result = analyzeWeaponEffect(project, 'GUN', 'VIRUS');
  assert.equal(result.stages[1].product, 45);
  project.set('HIT', 'IvanBomb', 'no');
  assert.equal(analyzeWeaponEffect(project, 'GUN', 'VIRUS').stages.length, 1);
});

test('isolated weapon copy changes only selected slot and preserves default bomb and unsaved edits', () => {
  const project = fixture();
  project.set('GUN', 'Damage', '234');
  const original = new TextDecoder().decode(serialize(project.files[0]));
  assert.deepEqual(unitWeaponSlots(project, 'VIRUS').map(item => item.key), ['Primary', 'ElitePrimary']);
  const result = prepareIsolatedWeapon(project, { unit: 'VIRUS', slot: 'Primary', copyProjectile: true, copyWarhead: true, copyBombWarhead: true });
  assert.equal(new TextDecoder().decode(serialize(project.files[0])), original);
  assert.equal(result.copies.length, 4);
  assert.equal(result.project.get('VIRUS', 'Primary').value, result.weaponCopy);
  assert.equal(result.project.get('VIRUS', 'ElitePrimary').value, 'GUN');
  assert.equal(result.project.get('OTHER', 'Primary').value, 'GUN');
  assert.equal(result.project.get(result.weaponCopy, 'Damage').value, '234');
  assert.notEqual(result.project.get(result.weaponCopy, 'Warhead').value, 'HIT');
  assert.notEqual(result.project.get(result.weaponCopy, 'IvanBomb.Warhead').value, 'BOMB');
  assert.equal(result.project.get('CombatDamage', 'IvanWarhead').value, 'BOMB');
  assert.match(result.rewires.find(item => item.key === 'IvanBomb.Warhead').before, /全局默认/);
});

test('isolation reuses a copied warhead when both roles share it, rejects missing data and preserves project', () => {
  const project = fixture();
  project.set('GUN', 'IvanBomb.Warhead', 'HIT');
  const result = prepareIsolatedWeapon(project, { unit: 'VIRUS', slot: 'Primary', copyWarhead: true, copyBombWarhead: true });
  assert.equal(result.copies.filter(item => item.type === 'warhead').length, 1);
  assert.equal(result.project.get(result.weaponCopy, 'Warhead').value, result.project.get(result.weaponCopy, 'IvanBomb.Warhead').value);
  assert.throws(() => prepareIsolatedWeapon(project, { unit: 'VIRUS', slot: 'Secondary' }), /武器槽/);
  project.set('GUN', 'Projectile', 'MISSING');
  assert.throws(() => prepareIsolatedWeapon(project, { unit: 'VIRUS', slot: 'Primary', copyProjectile: true }), /投射物/);
  assert.equal(project.get('VIRUS', 'Primary').value, 'GUN');
});

test('isolation avoids unresolved identifiers and blocks incomplete projects without touching originals', () => {
  const project = fixture();
  project.set('OTHER', 'CustomReference', 'GUN_COPY');
  const result = prepareIsolatedWeapon(project, { unit: 'VIRUS', slot: 'Primary' });
  assert.equal(result.weaponCopy, 'GUN_COPY2');
  const broken = new IniProject([parseFile('rulesmo.ini', encoder.encode('[#include]\n0=missing.ini\n[InfantryTypes]\n0=VIRUS\n[VIRUS]\nPrimary=GUN\n[GUN]\nDamage=1\n'))]);
  assert.throws(() => prepareIsolatedWeapon(broken, { unit: 'VIRUS', slot: 'Primary' }), /加载不完整/);
  assert.equal(broken.changes().length, 0);
});

test('a registered building takes priority over a same-named generic group and unresolved groups stay uncertain', () => {
  const project = fixture();
  project.appendEntry('BuildingTypes', '3', 'POWER', project.files[0]);
  project.createSection('POWER', project.files[0]);
  project.set('VIRUS', 'Prerequisite', 'POWER');
  const direct = analyzeConstruction(project, { id: 'VIRUS', type: 'infantry', inventory: ['POWER'] });
  assert.equal(direct.prerequisiteLists[0].requirements[0].kind, 'object');
  assert.equal(direct.prerequisiteLists[0].status, 'ok');
  project.set('VIRUS', 'Prerequisite', 'UNKNOWN_BUILDING');
  assert.equal(analyzeConstruction(project, { id: 'VIRUS', type: 'infantry', inventory: [] }).prerequisiteLists[0].status, 'unknown');
});
