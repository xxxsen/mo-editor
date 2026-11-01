import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, parseFile, serialize } from '../src/ini.js';
import { quickFeaturesFor, quickFeatureFields, prepareQuickFeature } from '../src/quick-features.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const file = (name, text) => parseFile(name, enc.encode(text));
const textOf = item => dec.decode(serialize(item));
const feature = type => quickFeaturesFor(type)[0];
const valuesFor = (project, section, type) => Object.fromEntries(quickFeatureFields(project, section, feature(type)).map(field => [field.key, field.value]));

test('transport preview uses effective and pending values and atomically changes the correct files', () => {
  const main = file('rulesmo.ini', '[#include]\n0=extra.ini\n[VehicleTypes]\n0=TANK\n[TANK]\nPassengers=2 ; preserve\nOpenTopped=no\nCost=100\n');
  const extra = file('extra.ini', '[TANK]\nSizeLimit=1 ; last definition\nPassengers.Allowed=E1,E2\nNoManualEnter=yes\nCustom=yes\n');
  const project = new IniProject([main, extra]);
  project.set('TANK', 'Passengers', '3');
  project.set('TANK', 'Cost', '125');
  const before = project.files.map(serialize), fields = quickFeatureFields(project, 'TANK', feature('vehicle'));
  assert.equal(fields.find(field => field.key === 'Passengers').value, '3');
  assert.equal(fields.find(field => field.key === 'SizeLimit').value, '1');
  assert.equal(fields.find(field => field.key === 'PipScale').value, 'Passengers');
  assert.equal(fields.find(field => field.key === 'Passengers.BySize').value, '');
  const values = { ...valuesFor(project, 'TANK', 'vehicle'), Passengers: '6', SizeLimit: '2', OpenTopped: 'yes' };
  const result = prepareQuickFeature(project, { featureId: 'transport', type: 'vehicle', section: 'TANK', values });
  assert.deepEqual(project.files.map(serialize), before);
  assert.equal(project.get('TANK', 'Passengers').value, '3');
  assert.equal(result.project.get('TANK', 'Cost').value, '125');
  assert.deepEqual(result.changes.map(change => change.key), ['Passengers', 'SizeLimit', 'PipScale', 'OpenTopped']);
  assert.equal(result.changes.find(change => change.key === 'Passengers').before, '3');
  assert.equal(result.changes.find(change => change.key === 'PipScale').before, null);
  assert.equal(result.project.get('TANK', 'SizeLimit').file.path, 'extra.ini');
  assert.equal(result.project.get('TANK', 'PipScale').file.path, 'extra.ini');
  assert.match(textOf(result.project.files[0]), /Passengers=6 ; preserve/);
  assert.match(textOf(result.project.files[1]), /SizeLimit=2 ; last definition/);
  assert.match(textOf(result.project.files[1]), /Passengers.Allowed=E1,E2/);
  assert.ok(result.warnings.some(warning => warning.includes('NoManualEnter')));
  assert.ok(result.warnings.some(warning => warning.includes('Passengers.Allowed')));
  assert.equal(result.project.get('TANK', 'Passengers.BySize'), undefined);
  const reload = new IniProject(result.project.files.map(item => parseFile(item.name, serialize(item), item.path)));
  assert.equal(reload.get('TANK', 'Passengers').value, '6');
  assert.equal(reload.get('TANK', 'PipScale').value, 'Passengers');
});

test('buildings use garrison fields and preserve optional values while reporting restrictions', () => {
  const project = new IniProject([file('rulesmo.ini', '[HOUSE]\nCanBeOccupied=no\nMaxNumberOccupants=3\nCanOccupyFire=false\nSelectable=no\nSight=4\nInfantryAbsorb=yes\n')]);
  const values = { ...valuesFor(project, 'HOUSE', 'building'), CanBeOccupied: 'yes', MaxNumberOccupants: '6', CanOccupyFire: 'true' };
  const result = prepareQuickFeature(project, { featureId: 'garrison', type: 'building', section: 'HOUSE', values });
  assert.deepEqual(result.changes.map(change => change.key), ['CanBeOccupied', 'MaxNumberOccupants', 'CanOccupyFire']);
  assert.equal(result.project.get('HOUSE', 'Selectable').value, 'no');
  assert.equal(result.project.get('HOUSE', 'Sight').value, '4');
  assert.equal(result.project.get('HOUSE', 'Passengers'), undefined);
  assert.ok(result.warnings.some(warning => warning.includes('Selectable')));
  assert.ok(result.warnings.some(warning => warning.includes('吸收')));
  assert.throws(() => prepareQuickFeature(project, { featureId: 'transport', type: 'building', section: 'HOUSE', values }), /不支持/);
  assert.ok(quickFeaturesFor('infantry').some(item => item.id === 'stealth'));
  assert.ok(!quickFeaturesFor('infantry').some(item => item.id === 'garrison'));
});

test('invalid forms never mutate the project or its prior unsaved changes', () => {
  const project = new IniProject([file('rulesmo.ini', '[TANK]\nCost=100\nPassengers=2\nNoManualEnter=no\n')]);
  project.set('TANK', 'Cost', '150');
  const before = project.files.map(serialize), valid = valuesFor(project, 'TANK', 'vehicle');
  for (const invalid of [{ Passengers: '' }, { SizeLimit: '-1' }, { Passengers: '99999999999' }, { OpenTopped: 'maybe' }, { NoManualEnter: '' }, { PipScale: 'unrecognised' }]) {
    assert.throws(() => prepareQuickFeature(project, { featureId: 'transport', type: 'vehicle', section: 'TANK', values: { ...valid, ...invalid } }));
    assert.deepEqual(project.files.map(serialize), before);
    assert.equal(project.get('TANK', 'Cost').value, '150');
  }
});

test('unknown existing choices and intentionally blank optional fields remain unchanged', () => {
  const project = new IniProject([file('rulesmo.ini', '[TANK]\nPassengers=5\nSizeLimit=2\nPipScale=CustomMod\nOpenTopped=ModValue\nNoManualUnload= ; intentionally blank\n')]);
  const values = valuesFor(project, 'TANK', 'vehicle');
  const result = prepareQuickFeature(project, { featureId: 'transport', type: 'vehicle', section: 'TANK', values });
  assert.equal(result.changes.length, 0);
  assert.equal(result.project.get('TANK', 'PipScale').value, 'CustomMod');
  assert.equal(result.project.get('TANK', 'OpenTopped').value, 'ModValue');
  assert.match(textOf(result.project.files[0]), /NoManualUnload= ; intentionally blank/);
  assert.equal(result.project.get('TANK', 'Selectable'), undefined);
  assert.throws(() => prepareQuickFeature(project, { featureId: 'transport', type: 'vehicle', section: 'TANK', values: { ...values, OpenTopped: 'other' } }), /选择/);
});

test('zero values, disabled options and incomplete rules are reported in preview', () => {
  const project = new IniProject([file('rulesmo.ini', '[#include]\n0=missing.ini\n[HOUSE]\nSelectable=no\n')]);
  const values = { ...valuesFor(project, 'HOUSE', 'building'), CanBeOccupied: 'no', MaxNumberOccupants: '0', CanOccupyFire: 'no', Sight: '0' };
  const result = prepareQuickFeature(project, { featureId: 'garrison', type: 'building', section: 'HOUSE', values });
  for (const term of ['加载不完整', 'CanBeOccupied', 'MaxNumberOccupants', 'CanOccupyFire', 'Selectable', 'Sight']) assert.ok(result.warnings.some(warning => warning.includes(term)), term);
});
