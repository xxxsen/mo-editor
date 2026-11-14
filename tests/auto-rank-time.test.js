import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, parseFile } from '../src/ini.js';
import { AUTO_RANK_SPEEDS, estimateAutoRankTime, savedSkirmishSpeed } from '../src/auto-rank.js';

const encode = new TextEncoder();
const file = (path, contents) => parseFile(path.split('/').at(-1), encode.encode(contents), path);
const estimate = (mode, speed, interval = '300', customFps = '') => estimateAutoRankTime({ mode, speed, interval, customFps });

test('real-time estimates follow the actual speed and skirmish or multiplayer caps', () => {
  assert.deepEqual(AUTO_RANK_SPEEDS.map(speed => speed.id), ['6', '5', '4', '3', '2', '1', '0']);
  for (const [speed, fps] of [['0', 10], ['1', 12], ['2', 15], ['3', 20], ['4', 30]]) {
    for (const mode of ['skirmish', 'multiplayer']) {
      const result = estimate(mode, speed);
      assert.equal(result.status, 'estimated'); assert.equal(result.fps, fps);
      assert.equal(result.firstSeconds, 300 / fps); assert.equal(result.secondSeconds, 600 / fps);
    }
  }
  assert.equal(estimate('skirmish', '5').firstSeconds, 5);
  assert.equal(estimate('multiplayer', '5').firstSeconds, 300 / 45);
  assert.equal(estimate('multiplayer', '6').firstSeconds, 5);
  assert.equal(estimate('skirmish', '6').status, 'unlimited');
});

test('custom logic rate overrides any nominal cap and invalid inputs never produce misleading times', () => {
  const result = estimate('skirmish', '6', '300', '24');
  assert.equal(result.custom, true); assert.equal(result.firstSeconds, 12.5); assert.equal(result.secondSeconds, 25);
  assert.equal(estimate('multiplayer', '5', '600', '12.5').firstSeconds, 48);
  for (const raw of ['', '0', '-1', '1.5', '1073741824', 'NaN']) assert.equal(estimate('skirmish', '5', raw).status, 'invalid-interval');
  for (const raw of ['0', '-1', '1001', 'Infinity', 'abc']) assert.equal(estimate('skirmish', '5', '300', raw).status, 'invalid-fps');
  assert.equal(estimate('other', '5').status, 'invalid-speed');
  assert.equal(estimate('skirmish', '7').status, 'invalid-speed');
});

test('last saved skirmish speed is derived from the imported option list, not a hard-coded index', () => {
  const rules = file('rulesmo.ini', '[General]\nVeteranRatio=4.5\n');
  const settings = file('Client/SkirmishSettings.ini', '[GameOptions]\ncmbSkirmishGameSpeedCap=1\n');
  const options = file('Resources/GameOptions.ini', '[cmbSkirmishGameSpeedCap]\nItems=6 最快,5 很快,4 快,3 中等,2 慢,1 很慢,0 最慢\nDataWriteMode=Index\n');
  const project = new IniProject([rules, settings, options]);
  assert.equal(savedSkirmishSpeed(project), '5');
  const reordered = file('Resources/GameOptions.ini', '[cmbSkirmishGameSpeedCap]\nItems=4 快,2 慢,5 很快\nDataWriteMode=Index\n');
  assert.equal(savedSkirmishSpeed(new IniProject([rules, settings, reordered])), '2');
  const malformed = file('Resources/GameOptions.ini', '[cmbSkirmishGameSpeedCap]\nItems=6 最快,,4 快\nDataWriteMode=Index\n');
  assert.equal(savedSkirmishSpeed(new IniProject([rules, settings, malformed])), null);
  assert.equal(savedSkirmishSpeed(new IniProject([rules, settings])), null);
});
