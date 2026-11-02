import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, parseFile, serialize } from '../src/ini.js';
import { getFieldInfo } from '../src/field-metadata.js';
import { availableFields } from '../src/field-catalog.js';
import { enumDefinition, enumKindForField } from '../src/enum-options.js';
import { warheadSuperweaponReferences } from '../src/warhead-superweapons.js';

const text = `[Warheads]\n0=TowerPsiBreakWH\n1=EMPTY\n[SuperWeaponTypes]\n0=TowerPsiBreakSW\n[TowerPsiBreakWH]\nVerses=100%,100%\nVersus.animal=100%\nVersus.s_spin_levi=100%\nAffectsAllies=no\nLaunchSW=TowerPsiBreakSW, MissingSW, TowerPsiBreakSW\nLaunchSW.RealLaunch=no\n[EMPTY]\nVerses=100%\n[TowerPsiBreakSW]\nType=PsychicDominator\n`;
const makeProject = () => new IniProject([parseFile('rulesmo.ini', new TextEncoder().encode(text))]);

test('TowerPsiBreakWH fields are translated and superweapon references retain their order and duplicates', () => {
  const project = makeProject();
  const original = serialize(project.files[0]);
  for (const field of project.section('TowerPsiBreakWH').fields.values()) {
    const info = getFieldInfo(field.name, { type: 'warhead' });
    assert.ok(info.known, `${field.name} should have a Chinese description`);
    assert.ok(info.label && info.description, `${field.name} needs a label and tooltip`);
  }
  assert.match(getFieldInfo('LaunchSW.RealLaunch', { type: 'warhead' }).description, /资金/);
  assert.deepEqual(warheadSuperweaponReferences(project, 'TowerPsiBreakWH').map(({ id, index }) => [id, index]), [
    ['TowerPsiBreakSW', 0], ['MissingSW', 1], ['TowerPsiBreakSW', 2],
  ]);
  assert.deepEqual(serialize(project.files[0]), original, 'reading references must not modify the INI');
  project.set('EMPTY', 'LaunchSW', 'none,,TowerPsiBreakSW,<none>, MissingSW');
  assert.deepEqual(warheadSuperweaponReferences(project, 'EMPTY').map(({ id, index }) => [id, index]), [['TowerPsiBreakSW', 2], ['MissingSW', 4]]);
});

test('missing documented warhead fields can be added without borrowing unrelated object fields', () => {
  const project = makeProject();
  const entities = [{ id: 'EMPTY', type: 'warhead' }, { id: 'TowerPsiBreakWH', type: 'warhead' }];
  const fields = availableFields(project, entities[0], entities);
  const names = ['LaunchSW', 'LaunchSW.RealLaunch', 'LaunchSW.IgnoreInhibitors', 'LaunchSW.DisplayMoney.Houses', 'Shield.RemoveTypes', 'DetonateOnAllMapObjects.AffectTargets', 'Convert0.From', 'Convert1.To', 'SpawnsCrate0.Type', 'CellInset'];
  for (const name of names) assert.ok(fields.some(field => field.name === name && field.known), `${name} missing from catalog`);
  assert.ok(!fields.some(field => field.name === 'AttachEffect.Delay'), 'self-applied Techno effect must not be suggested to warheads');
  assert.ok(!availableFields(project, entities[1], entities).some(field => field.name === 'LaunchSW'));
  assert.ok(getFieldInfo('Convert25.From', { type: 'warhead' }).known);
  assert.ok(getFieldInfo('SpawnsCrate10.Weight', { type: 'warhead' }).known);
  assert.ok(!getFieldInfo('Convert25.From', { type: 'infantry' }).known);
  assert.ok(!getFieldInfo('SpawnsCrate10.Weight', { type: 'weapon' }).known);
  assert.equal(project.get('EMPTY', 'LaunchSW'), undefined, 'catalog lookup must not create fields');
});

test('documented values use the right single or multiple selection semantics', () => {
  for (const field of ['LaunchSW.RealLaunch', 'LaunchSW.IgnoreInhibitors', 'Shield.ReplaceOnly']) {
    assert.equal(enumKindForField('warhead', field), 'boolean');
  }
  assert.equal(enumKindForField('warhead', 'LaunchSW.DisplayMoney.Houses'), 'phobosHouse');
  assert.equal(enumDefinition('phobosHouse').multiple, undefined);
  assert.equal(enumKindForField('warhead', 'DetonateOnAllMapObjects.AffectTargets'), 'phobosTechnoTargets');
  assert.equal(enumDefinition('phobosTechnoTargets').multiple, true);
  assert.equal(enumKindForField('warhead', 'Convert9.AffectedHouses'), 'phobosHouses');
  assert.equal(enumKindForField('warhead', 'SpawnsCrate1.Type'), 'phobosCrateType');
  assert.equal(enumKindForField('weapon', 'LaunchSW.RealLaunch'), '');
});
