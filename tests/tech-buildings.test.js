import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, parseFile, serialize } from '../src/ini.js';
import { quickFeaturesFor, quickFeatureFields, prepareQuickFeature } from '../src/quick-features.js';
import { getFieldInfo } from '../src/field-metadata.js';
import { enumKindForField } from '../src/enum-options.js';

const encoder = new TextEncoder(), decoder = new TextDecoder();
const file = (name, text) => parseFile(name, encoder.encode(text));
const project = (...files) => new IniProject(files);
const feature = id => quickFeaturesFor('building').find(item => item.id === id);
const fieldsFor = (rules, section, id) => quickFeatureFields(rules, section, feature(id));
const apply = (rules, section, featureId, values = {}) => prepareQuickFeature(rules, { featureId, type: 'building', section, values });

test('tech building features use the original engine fields and preserve already configured values', () => {
  const rules = project(file('rulesmo.ini', '[General]\nSelfHealInfantryFrames=100\nSelfHealInfantryAmount=20\nSelfHealUnitFrames=100\nSelfHealUnitAmount=10\n[CAOILD]\nProduceCashAmount=20\nProduceCashDelay=100\nProduceCashStartup=500\nCapturable=yes\nNeedsEngineer=yes\n[CATHOSP]\nInfantryGainSelfHeal=1\nCapturable=yes\n[CAMACH]\nUnitsGainSelfHeal=1\nUnsellable=yes\n'));
  const hospital = fieldsFor(rules, 'CATHOSP', 'tech-hospital');
  const shop = fieldsFor(rules, 'CAMACH', 'tech-machine-shop');
  const oil = fieldsFor(rules, 'CAOILD', 'income');
  assert.equal(hospital.find(field => field.key === 'InfantryGainSelfHeal').value, '1');
  assert.equal(hospital.find(field => field.key === 'SelfHealInfantryFrames').value, '100');
  assert.equal(shop.find(field => field.key === 'UnitsGainSelfHeal').value, '1');
  assert.equal(shop.find(field => field.key === 'SelfHealUnitAmount').value, '10');
  assert.equal(oil.find(field => field.key === 'ProduceCashStartup').value, '500');
  assert.equal(oil.find(field => field.key === 'NeedsEngineer').value, 'yes');
  for (const [section, id] of [['CAOILD', 'income'], ['CATHOSP', 'tech-hospital'], ['CAMACH', 'tech-machine-shop']]) {
    assert.deepEqual(apply(rules, section, id).changes, [], `${id} must not write defaults`);
  }
  assert.ok(!quickFeaturesFor('vehicle').some(item => item.id === 'tech-hospital' || item.id === 'tech-machine-shop'));
});

test('building and global edits preview separately, preserve includes and retain pending changes', () => {
  const main = file('rulesmo.ini', '[#include]\n0=shared.ini\n[General]\nSelfHealInfantryFrames=100 ; original\n[HOSP]\nInfantryGainSelfHeal=1 ; building\nCost=100\n');
  const shared = file('shared.ini', '[General]\nSelfHealInfantryFrames=80 ; effective\nSelfHealInfantryAmount=20\n');
  const rules = project(main, shared);
  rules.set('HOSP', 'Cost', '150');
  rules.set('General', 'SelfHealInfantryAmount', '25');
  const before = rules.files.map(serialize);
  const fields = fieldsFor(rules, 'HOSP', 'tech-hospital');
  assert.equal(fields.find(field => field.key === 'SelfHealInfantryFrames').value, '80');
  assert.equal(fields.find(field => field.key === 'SelfHealInfantryAmount').value, '25');
  const result = apply(rules, 'HOSP', 'tech-hospital', { InfantryGainSelfHeal: '2', SelfHealInfantryFrames: '60' });
  assert.deepEqual(rules.files.map(serialize), before, 'preview must not mutate existing edits');
  assert.equal(result.project.get('HOSP', 'InfantryGainSelfHeal').value, '2');
  assert.equal(result.project.get('HOSP', 'Cost').value, '150');
  assert.equal(result.project.get('General', 'SelfHealInfantryFrames').value, '60');
  assert.equal(result.project.get('General', 'SelfHealInfantryAmount').value, '25');
  const globalChange = result.changes.find(change => change.key === 'SelfHealInfantryFrames');
  assert.equal(globalChange.section, 'General');
  assert.equal(globalChange.type, 'global');
  assert.equal(globalChange.file.path, 'shared.ini');
  assert.ok(result.warnings.some(warning => warning.includes('全局 [General]') && warning.includes('所有玩家')));
  assert.match(decoder.decode(serialize(result.project.files[1])), /SelfHealInfantryFrames=60 ; effective/);
  assert.match(decoder.decode(serialize(result.project.files[0])), /SelfHealInfantryFrames=100 ; original/);
  const unchangedGlobals = apply(rules, 'HOSP', 'tech-hospital', { InfantryGainSelfHeal: '3' });
  assert.ok(!unchangedGlobals.warnings.some(warning => warning.includes('将修改全局')));
});

test('missing global rules do not block building edits or permit writes to an absent section', () => {
  const rules = project(file('rulesmo.ini', '[HOSP]\nName=Hospital\n'));
  const fields = fieldsFor(rules, 'HOSP', 'tech-hospital');
  assert.equal(fields.find(field => field.key === 'SelfHealInfantryFrames').unavailable, true);
  assert.equal(fields.find(field => field.key === 'SelfHealInfantryAmount').unavailable, true);
  const result = apply(rules, 'HOSP', 'tech-hospital', { InfantryGainSelfHeal: '1' });
  assert.equal(result.project.get('HOSP', 'InfantryGainSelfHeal').value, '1');
  assert.equal(result.project.section('General'), undefined);
  assert.ok(result.warnings.some(warning => warning.includes('未加载 [General]')));
  assert.throws(() => apply(rules, 'HOSP', 'tech-hospital', { InfantryGainSelfHeal: '1', SelfHealInfantryFrames: '40' }), /未加载 \[General\]/);
  assert.equal(rules.get('HOSP', 'InfantryGainSelfHeal'), undefined);
});

test('zero intervals and malformed numbers are rejected without modifying either section', () => {
  const rules = project(file('rulesmo.ini', '[General]\nSelfHealUnitFrames=100\nSelfHealUnitAmount=10\n[SHOP]\nUnitsGainSelfHeal=1\n'));
  const before = rules.files.map(serialize);
  for (const values of [{ UnitsGainSelfHeal: '-1' }, { SelfHealUnitFrames: '0' }, { SelfHealUnitFrames: '1.5' }, { SelfHealUnitAmount: '-2' }, { SelfHealUnitAmount: '2147483648' }]) {
    assert.throws(() => apply(rules, 'SHOP', 'tech-machine-shop', values));
    assert.deepEqual(rules.files.map(serialize), before);
  }
  const disabled = apply(rules, 'SHOP', 'tech-machine-shop', { UnitsGainSelfHeal: '0' });
  assert.ok(disabled.warnings.some(warning => warning.includes('UnitsGainSelfHeal=0')));
  const existingZero = project(file('rulesmo.ini', '[General]\nSelfHealUnitFrames=0\n[SHOP]\nUnitsGainSelfHeal=1\n'));
  const preserved = apply(existingZero, 'SHOP', 'tech-machine-shop');
  assert.deepEqual(preserved.changes, []);
  assert.ok(preserved.warnings.some(warning => warning.includes('SelfHealUnitFrames=0')));
});

test('capture controls are optional, prefilled, and warn about contradictory settings', () => {
  const rules = project(file('rulesmo.ini', '[HOSP]\nInfantryGainSelfHeal=1\nCapturable=no\nNeedsEngineer=yes\nUnsellable=yes\n'));
  const fields = fieldsFor(rules, 'HOSP', 'tech-hospital');
  assert.equal(fields.find(field => field.key === 'Capturable').value, 'no');
  assert.equal(fields.find(field => field.key === 'NeedsEngineer').value, 'yes');
  const result = apply(rules, 'HOSP', 'tech-hospital');
  assert.ok(result.warnings.some(warning => warning.includes('NeedsEngineer') && warning.includes('Capturable')));
  assert.deepEqual(result.changes, []);
  assert.equal(enumKindForField('building', 'NeedsEngineer'), 'boolean');
  assert.equal(enumKindForField('building', 'Unsellable'), 'boolean');
  assert.equal(enumKindForField('infantry', 'NeedsEngineer'), '');
});

test('tech healing labels distinguish building bonuses from shared global settings', () => {
  assert.match(getFieldInfo('InfantryGainSelfHeal', { type: 'building' }).description, /多个提供者可叠加/);
  assert.match(getFieldInfo('UnitsGainSelfHeal', { type: 'building' }).description, /SelfHealUnitFrames/);
  assert.match(getFieldInfo('SelfHealUnitFrames', { type: 'global', section: 'General' }).description, /全局生效.*大于 0/);
});
