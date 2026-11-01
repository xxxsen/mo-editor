import test from 'node:test';
import assert from 'node:assert/strict';
import { enumKindForField, enumDefinition, enumChoices, selectEnumOption } from '../src/enum-options.js';
import { mergeSelections } from '../src/rule-schema.js';

test('options are scoped to the actual object and include the YR and Ares abilities', () => {
  assert.equal(enumKindForField('infantry', 'eliteABILITIES'), 'abilities');
  assert.equal(enumKindForField('vehicle', 'VeteranAbilities'), 'abilities');
  assert.equal(enumKindForField('weapon', 'EliteAbilities'), '');
  assert.equal(enumKindForField('global', 'SpeedType'), '');
  assert.equal(enumKindForField('building', 'BuildCat'), 'buildCat');
  assert.equal(enumKindForField('vehicle', 'BuildCat'), '');
  assert.equal(enumKindForField('superweapon', 'SW.AffectsTarget'), 'swTarget');
  assert.equal(enumKindForField('infantry', 'Trainable'), 'boolean');
  assert.equal(enumKindForField('projectile', 'Inviso'), 'boolean');
  assert.equal(enumKindForField('weapon', 'Inviso'), '');
  const options = enumChoices('abilities');
  assert.equal(options.length, 25);
  assert.ok(options.some(item => item.id === 'EMPIMMUNE' && /Ares/.test(item.group)));
  assert.ok(options.some(item => item.id === 'SIGHT' && /不是|不会/.test(item.hint)));
  assert.ok(!options.some(item => item.id === 'RANGE'), 'Phobos-only values must not be offered as Ares options');
  assert.ok(enumDefinition('abilities').multiple);
});

test('unknown existing values remain selectable and survive unrelated changes', () => {
  const raw = 'self_heal, MyModAbility,FIREPOWER,self_heal';
  const options = enumChoices('abilities', raw);
  assert.equal(options.filter(item => item.id.toLowerCase() === 'self_heal').length, 1);
  assert.equal(options.find(item => item.id === 'MyModAbility').group, '当前未识别的代码');
  assert.equal(mergeSelections(raw, ['SELF_HEAL', 'MYMODABILITY', 'FIREPOWER']), raw);
  assert.equal(mergeSelections(raw, ['self_heal', 'MyModAbility', 'EMPIMMUNE']), 'self_heal, MyModAbility,self_heal,EMPIMMUNE');
  const single = enumChoices('speedType', 'CustomMove');
  assert.ok(single.some(item => item.id === 'CustomMove' && item.group === '当前未识别的代码'));
  assert.equal(enumChoices('speedType', 'hOvEr').filter(item => item.id.toLowerCase() === 'hover').length, 1);
  assert.deepEqual(enumChoices('boolean', 'True').map(item => item.id), ['true', 'false']);
  assert.equal(enumChoices('boolean', 'custom').at(-1).id, 'custom');
});

test('exclusive choices change only after selection and preserve unknown values', () => {
  const selected = new Map([['all', 'all'], ['custom', 'Custom']]);
  selectEnumOption('swHouse', selected, 'enemies', true);
  selected.set('enemies', 'enemies');
  assert.deepEqual([...selected.values()], ['Custom', 'enemies']);
  selectEnumOption('swHouse', selected, 'none', false);
  assert.deepEqual([...selected.values()], ['Custom', 'enemies']);
  selectEnumOption('swHouse', selected, 'none', true);
  selected.set('none', 'none');
  assert.deepEqual([...selected.values()], ['Custom', 'none']);
  const constraints = new Map([['offensive_cell_set', 'Offensive_Cell_Set'], ['enemy', 'Enemy']]);
  selectEnumOption('swConstraints', constraints, 'Offensive_Cell_Clear', true);
  assert.deepEqual([...constraints.values()], ['Enemy']);
});
