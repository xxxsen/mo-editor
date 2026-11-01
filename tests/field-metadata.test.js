import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_METADATA, getFieldInfo } from '../src/field-metadata.js';

test('every curated field has a Chinese name and a substantive description', () => {
  const groups = Object.entries(FIELD_METADATA).flatMap(([scope, values]) => scope === 'sections'
    ? Object.entries(values).map(([section, entries]) => [`sections.${section}`, entries])
    : [[scope, values]]);
  for (const [scope, entries] of groups) {
    const names = new Set();
    for (const [key, [label, description, aliases, inlineHint]] of Object.entries(entries)) {
      assert.ok(!names.has(key.toLowerCase()), `${scope} contains a duplicate ${key}`);
      names.add(key.toLowerCase());
      assert.match(label, /[\u3400-\u9fff]/, `${scope}.${key} needs a Chinese name`);
      assert.ok(description?.length >= 10, `${scope}.${key} needs a useful description`);
      assert.ok(aliases === undefined || Array.isArray(aliases), `${scope}.${key} aliases must be an array`);
      assert.ok(inlineHint === undefined || typeof inlineHint === 'boolean', `${scope}.${key} inline hint must be boolean`);
    }
  }
});

test('context resolves ambiguous and case-insensitive field names without guessing unknown sections', () => {
  assert.equal(getFieldInfo('sPeEd', { type: 'vehicle' }).label, '移动速度');
  assert.equal(getFieldInfo('Speed', { type: 'weapon' }).label, '弹体速度');
  assert.equal(getFieldInfo('Range', { type: 'weapon' }).label, '射程');
  assert.equal(getFieldInfo('Range', { type: 'superweapon' }).label, '瞄准指示范围');
  assert.equal(getFieldInfo('Armor', { type: 'vehicle' }).label, '装甲类型');
  assert.equal(getFieldInfo('Armor', { type: 'global', section: 'Normal' }).label, '装甲倍率');
  assert.equal(getFieldInfo('SuperWeapons', { type: 'global', section: 'IQ' }).label, '使用超级武器');
  assert.equal(getFieldInfo('SuperWeapons', { type: 'building' }).label, '其他超级武器');
  assert.equal(getFieldInfo('Strength', { type: 'global', section: 'ArmorTypes' }).known, false);
  assert.equal(getFieldInfo('Speed', { type: 'sections', section: 'unknown' }).known, false);
  assert.equal(getFieldInfo('UnknownField', { type: 'vehicle' }).label, 'UnknownField');
  assert.equal(getFieldInfo('UnknownField', { type: 'vehicle' }).description, '');
});

test('indexed weapon and armor definitions retain their specific meanings', () => {
  assert.equal(getFieldInfo('Weapon3', { type: 'vehicle' }).label, '第 3 武器');
  assert.equal(getFieldInfo('EliteWeapon12', { type: 'infantry' }).label, '精英第 12 武器');
  assert.equal(getFieldInfo('Versus.riot', { type: 'warhead' }).label, '装甲 riot 伤害倍率');
  assert.equal(getFieldInfo('Versus.riot.PassiveAcquire', { type: 'warhead' }).label, '装甲 riot 自动索敌');
  assert.equal(getFieldInfo('Versus.riot.UnknownFlag', { type: 'warhead' }).known, false);
  assert.equal(getFieldInfo('ParaDrop.GDI.Plane2.Types', { type: 'superweapon' }).label, '空投单位类型');
  assert.equal(getFieldInfo('AttachEffect.Cumulative', { type: 'vehicle' }).known, false);
  assert.equal(getFieldInfo('AttachEffect.Cumulative', { type: 'warhead' }).known, true);
  assert.equal(getFieldInfo('AttachEffect.Delay', { type: 'warhead' }).known, false);
});

test('garrison weapons and related transport fields use the correct meaning', () => {
  const normal = getFieldInfo('occupyweapon', { type: 'infantry' });
  const elite = getFieldInfo('EliteOccupyWeapon', { type: 'infantry' });
  const transport = getFieldInfo('OpenTransportWeapon', { type: 'infantry' });
  assert.equal(normal.label, '驻军武器');
  assert.match(normal.description, /驻守.*武器规则段 ID/);
  assert.equal(elite.label, '精英驻军武器');
  assert.match(elite.description, /精英步兵.*驻守/);
  assert.match(transport.description, /武器槽索引.*-1/);
  assert.equal(getFieldInfo('OccupyWeapon', { type: 'global', section: 'General' }).known, false);
});

test('numbered vehicle and gattling fields keep their indices and engine limitations', () => {
  assert.equal(getFieldInfo('WeaponTurretIndex56', { type: 'vehicle' }).label, '第 56 武器炮塔索引');
  assert.equal(getFieldInfo('EliteStage3', { type: 'vehicle' }).label, '精英加特林第 3 阶段阈值');
  assert.equal(getFieldInfo('Stage1', { type: 'building' }).label, '加特林第 1 阶段阈值');
  assert.match(getFieldInfo('BurstDelay4', { type: 'vehicle' }).description, /原版支持载具的 0 至 3/);
  assert.equal(getFieldInfo('Survivor.Side0', { type: 'vehicle' }).label, '阵营 0 逃生驾驶员');
  assert.match(getFieldInfo('Survivor.ElitePassengerChance', { type: 'vehicle' }).description, /精英等级载具/);
  assert.equal(getFieldInfo('Stage0', { type: 'vehicle' }).known, false);
  assert.equal(getFieldInfo('WeaponTurretIndex56', { type: 'weapon' }).known, false);
  assert.equal(getFieldInfo('Lightning.Seperation', { type: 'superweapon' }).known, false);
});
