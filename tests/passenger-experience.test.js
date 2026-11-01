import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, parseFile, serialize } from '../src/ini.js';
import { quickFeaturesFor, quickFeatureFields, prepareQuickFeature } from '../src/quick-features.js';
import { enumKindForField } from '../src/enum-options.js';
import { getFieldInfo } from '../src/field-metadata.js';

const bytes = text => new TextEncoder().encode(text);
const file = (name, text) => parseFile(name, bytes(text));
const projectFor = text => new IniProject([file('rulesmo.ini', text)]);
const feature = id => quickFeaturesFor('vehicle').find(item => item.id === id);
const fieldsFor = (project, id) => quickFeatureFields(project, 'TANK', feature(id));
const apply = (project, id, values = {}) => prepareQuickFeature(project, { featureId: id, type: 'vehicle', section: 'TANK', values });

test('experience options are available in transport and separately, without writing Ares defaults', () => {
  const project = projectFor('[TANK]\nPassengers=2\nSizeLimit=1\nPipScale=Passengers\nOpenTopped=yes\n');
  const expected = ['Trainable', 'Experience.FromPassengers', 'Experience.PromotePassengers', 'Experience.PassengerModifier', 'Promote.IncludePassengers'];
  for (const id of ['transport', 'passenger-experience']) {
    const fields = fieldsFor(project, id);
    for (const key of expected) assert.equal(fields.find(field => field.key === key)?.value, '', `${id}: ${key}`);
    assert.match(fields.find(field => field.key === 'Experience.FromPassengers').defaultHint, /是/);
    assert.match(fields.find(field => field.key === 'Experience.PromotePassengers').defaultHint, /否/);
    assert.match(fields.find(field => field.key === 'Experience.PassengerModifier').defaultHint, /100%/);
    const result = apply(project, id);
    assert.deepEqual(result.changes, []);
    for (const key of expected) assert.equal(result.project.get('TANK', key), undefined);
  }
  assert.ok(!quickFeaturesFor('infantry').some(item => item.id === 'passenger-experience'));
  assert.ok(!quickFeaturesFor('building').some(item => item.id === 'passenger-experience'));
  assert.throws(() => prepareQuickFeature(project, { featureId: 'passenger-experience', type: 'infantry', section: 'TANK', values: {} }), /不支持/);
});

test('experience changes preserve unrelated fields and identify rank synchronization risks', () => {
  const project = projectFor('[TANK]\nPassengers=2\nOpenTopped=yes\nTrainable=no\nExperience.FromPassengers=no ; keep comment\nCost=100\n');
  project.set('TANK', 'Cost', '125');
  const before = project.files.map(serialize);
  const result = apply(project, 'passenger-experience', {
    'Experience.FromPassengers': 'yes',
    'Experience.PromotePassengers': 'yes',
    'Experience.PassengerModifier': '50%',
    'Promote.IncludePassengers': 'yes',
  });
  assert.deepEqual(project.files.map(serialize), before, 'preview cannot mutate the project');
  assert.deepEqual(result.changes.map(change => change.key), ['Experience.FromPassengers', 'Experience.PromotePassengers', 'Experience.PassengerModifier', 'Promote.IncludePassengers']);
  assert.equal(result.project.get('TANK', 'Cost').value, '125');
  assert.equal(result.project.get('TANK', 'Trainable').value, 'no');
  assert.equal(result.project.get('TANK', 'Experience.PassengerModifier').value, '50%');
  assert.match(new TextDecoder().decode(serialize(result.project.files[0])), /Experience.FromPassengers=yes ; keep comment/);
  assert.ok(result.warnings.some(warning => warning.includes('Trainable')));
  assert.ok(result.warnings.some(warning => warning.includes('Promote.IncludePassengers') && warning.includes('降级')));
  const noCarrierExperience = apply(project, 'passenger-experience', { 'Experience.FromPassengers': 'no' });
  assert.ok(noCarrierExperience.warnings.some(warning => warning.includes('不会因乘员击杀获得经验')));
});

test('multipliers accept numbers and percentages, reject invalid new values atomically, and preserve unknown existing values', () => {
  const project = projectFor('[TANK]\nOpenTopped=yes\nExperience.PassengerModifier=custom\n');
  assert.deepEqual(apply(project, 'passenger-experience').changes, []);
  const before = project.files.map(serialize);
  for (const value of ['0', '1', '1.5', '.5', '50%', '125%', '1e-2']) {
    assert.equal(apply(project, 'passenger-experience', { 'Experience.PassengerModifier': value }).project.get('TANK', 'Experience.PassengerModifier').value, value);
  }
  for (const value of ['-1', '1..5', '50%%', 'NaN', '1e999']) {
    assert.throws(() => apply(project, 'passenger-experience', { 'Experience.PassengerModifier': value }), /倍率或百分比/);
    assert.deepEqual(project.files.map(serialize), before);
  }
});

test('resetting experience fields removes all loaded definitions and preserves other changes', () => {
  const main = file('rulesmo.ini', '[#include]\n0=extra.ini\n[TANK]\nOpenTopped=yes\nExperience.PromotePassengers=no\nCost=100\n');
  const extra = file('extra.ini', '[TANK]\nExperience.PromotePassengers=yes ; effective\n');
  const project = new IniProject([main, extra]);
  project.set('TANK', 'Cost', '150');
  assert.equal(fieldsFor(project, 'passenger-experience').find(field => field.key === 'Experience.PromotePassengers').value, 'yes');
  const result = apply(project, 'passenger-experience', { 'Experience.PromotePassengers': '' });
  assert.equal(result.changes.filter(change => change.key === 'Experience.PromotePassengers' && change.kind === 'remove').length, 2);
  assert.equal(result.project.get('TANK', 'Experience.PromotePassengers'), undefined);
  assert.equal(result.project.get('TANK', 'Cost').value, '150');
  assert.equal(project.get('TANK', 'Experience.PromotePassengers').value, 'yes');
});

test('experience fields have localized descriptions and boolean selectors', () => {
  for (const key of ['Experience.FromPassengers', 'Experience.PromotePassengers', 'Promote.IncludePassengers']) {
    assert.equal(enumKindForField('vehicle', key), 'boolean');
    assert.equal(getFieldInfo(key, { type: 'vehicle' }).known, true);
  }
  assert.match(getFieldInfo('Experience.PassengerModifier', { type: 'vehicle' }).description, /不是.*分配比例/);
  assert.match(getFieldInfo('Promote.IncludePassengers', { type: 'vehicle' }).description, /覆盖.*降级/);
});
