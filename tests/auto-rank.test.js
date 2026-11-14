import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, parseFile, serialize } from '../src/ini.js';
import { GameResources, hashMixFilename } from '../src/resources.js';
import { autoRankStatus, autoRankDrift, autoRankArtPath, isTransparentRankSprite, prepareAutoRank } from '../src/auto-rank.js';
import { quickFeaturesFor } from '../src/quick-features.js';

const encode = new TextEncoder();
const file = (name, contents) => parseFile(name, encode.encode(contents));
const sprite = () => { const bytes = new Uint8Array(8 + 4 * 24); new DataView(bytes.buffer).setUint16(6, 4, true); return bytes; };
const options = (section = 'TANK', type = 'vehicle') => ({ section, type, interval: '300', spriteBytes: sprite() });
function fixture(extra = '') {
  return new IniProject([
    file('rulesmo.ini', `[General]\nVeteranRatio=4.5\n[AudioVisual]\n[InfantryTypes]\n0=GI\n[VehicleTypes]\n0=TANK\n1=TANK2\n[AircraftTypes]\n0=PLANE\n[BuildingTypes]\n0=HOUSE\n[Invisible]\nInviso=yes\n[GI]\nCost=200\n[TANK]\nCost=1000\n[TANK2]\nCost=1200\n[PLANE]\nCost=1800\n[HOUSE]\nCost=1500\n${extra}`),
    file('artmo.ini', '[EXISTING]\nImage=EXISTING\n'),
  ], 'rulesmo.ini');
}
const val = (project, section, key) => project.get(section, key)?.value;

test('feature is available for all four techno categories and requires a truly empty sprite', () => {
  for (const type of ['infantry', 'vehicle', 'aircraft', 'building']) assert.ok(quickFeaturesFor(type).some(feature => feature.id === 'auto-rank'));
  assert.ok(isTransparentRankSprite(sprite()));
  const nonempty = sprite(); new DataView(nonempty.buffer).setUint16(8 + 4, 1, true);
  assert.equal(isTransparentRankSprite(nonempty), false);
  assert.equal(isTransparentRankSprite(new Uint8Array(8)), false);
  assert.throws(() => prepareAutoRank(fixture(), { ...options(), spriteBytes: nonempty }), /透明/);
});

test('preview atomically creates two timers, per-type helper and art without changing existing effects', () => {
  const p = fixture('[TANK]\nTrainable=no\nAttachEffect.AttachTypes=OLD1,OLD2,OLD3\nAttachEffect.DurationOverrides=7\nAttachEffect.Delays=5,6\nAttachEffect.InitialDelays=1,2,3,88\n');
  p.set('TANK', 'Cost', '1050');
  const before = p.files.map(serialize);
  const result = prepareAutoRank(p, options());
  assert.deepEqual(p.files.map(serialize), before);
  const q = result.project, status = autoRankStatus(q, 'TANK'), n = status.names;
  assert.equal(status.enabled, true);
  assert.equal(val(q, 'TANK', 'Trainable'), 'yes');
  assert.equal(val(q, 'TANK', 'AttachEffect.AttachTypes'), `OLD1,OLD2,OLD3,${n.First},${n.Second}`);
  assert.equal(val(q, 'TANK', 'AttachEffect.DurationOverrides'), '7,7,7,0,0');
  assert.equal(val(q, 'TANK', 'AttachEffect.Delays'), '5,6,6,-1,-1');
  assert.equal(val(q, 'TANK', 'AttachEffect.InitialDelays'), '1,2,3,0,0,88');
  assert.equal(val(q, 'TANK', 'AttachEffect.RecreationDelays'), '-1,-1,-1,-1,-1');
  assert.equal(val(q, n.First, 'Duration'), '300');
  assert.equal(val(q, n.Second, 'Duration'), '600');
  assert.equal(val(q, n.First, 'ExpireWeapon.TriggerOn'), 'expire');
  assert.equal(val(q, n.Helper, 'Cost'), '4725');
  assert.equal(val(q, n.Helper, 'Armor'), n.Armor);
  assert.equal(val(q, n.Helper, 'ImmuneToPsionics'), 'yes');
  assert.equal(val(q, n.Helper, 'BalloonHover'), 'yes');
  assert.equal(val(q, n.Helper, 'NotHuman'), 'yes');
  assert.equal(val(q, n.KillH, `Versus.${n.Armor}`), '100%');
  assert.equal(val(q, 'AudioVisual', 'Promote.EliteAnimation'), 'MRARankElite');
  const art = new IniProject(q.files, 'artmo.ini');
  assert.equal(val(art, n.SpawnA, 'CreateUnit'), n.Helper);
  assert.equal(val(art, n.SpawnA, 'CreateUnit.SpawnAnim'), n.KillA);
  assert.equal(val(art, n.KillA, 'Damage.DealtByInvoker'), 'yes');
  assert.equal(val(art, 'INVISOX', 'Sequence'), 'MRARankSeq');
  assert.ok(result.changes.some(change => change.file.path === 'rulesmo.ini'));
  assert.ok(result.changes.some(change => change.file.path === 'artmo.ini'));
  assert.equal(autoRankArtPath(q), 'artmo.ini');
  assert.deepEqual(autoRankDrift(q), []);
  const reloaded = new IniProject(q.files.map(f => parseFile(f.name, serialize(f), f.path)), 'rulesmo.ini');
  assert.equal(autoRankStatus(reloaded, 'TANK').enabled, true);
  assert.deepEqual(autoRankDrift(reloaded), []);
});

test('updating an older auto-rank profile previews protections for its neutral helper', () => {
  const original = prepareAutoRank(fixture(), options()).project;
  const helper = autoRankStatus(original, 'TANK').names.Helper;
  for (const key of ['ImmuneToPsionics', 'BalloonHover', 'NotHuman']) original.remove(helper, key);
  const result = prepareAutoRank(original, options());
  for (const key of ['ImmuneToPsionics', 'BalloonHover', 'NotHuman']) {
    assert.equal(val(original, helper, key), undefined);
    assert.equal(val(result.project, helper, key), 'yes');
    assert.ok(result.changes.some(change => change.section === helper && change.key === key && change.after === 'yes'));
  }
});

test('two types get separate armor, and edits to cost and ratio must be recalculated', () => {
  let p = prepareAutoRank(fixture(), options()).project;
  const first = autoRankStatus(p, 'TANK');
  p = prepareAutoRank(p, options('TANK2')).project;
  const second = autoRankStatus(p, 'TANK2');
  assert.notEqual(first.names.Armor, second.names.Armor);
  assert.notEqual(first.names.Helper, second.names.Helper);
  assert.equal(val(p, second.names.Helper, 'Cost'), '5400');
  p.set('TANK', 'Cost', '1100');
  assert.match(autoRankDrift(p)[0], /TANK/);
  p = prepareAutoRank(p, { ...options(), interval: '400' }).project;
  assert.equal(val(p, first.names.Helper, 'Cost'), '4950');
  assert.equal(val(p, first.names.Second, 'Duration'), '800');
  assert.deepEqual(autoRankDrift(p), []);
  p.set('General', 'VeteranRatio', '5');
  assert.equal(autoRankDrift(p).length, 2);
  p = prepareAutoRank(p, { ...options(), interval: '400' }).project;
  p = prepareAutoRank(p, options('TANK2')).project;
  assert.deepEqual(autoRankDrift(p), []);
  assert.equal(val(p, first.names.Helper, 'Cost'), '5500');
  assert.equal(val(p, second.names.Helper, 'Cost'), '6000');
});

test('disable removes only its timers while retaining other effects and their fallback semantics', () => {
  let p = fixture('[TANK]\nAttachEffect.AttachTypes=OLD1,OLD2\nAttachEffect.Delays=5\n');
  p = prepareAutoRank(p, options()).project;
  const status = autoRankStatus(p, 'TANK');
  const result = prepareAutoRank(p, { ...options(), action: 'disable' });
  p = result.project;
  assert.equal(autoRankStatus(p, 'TANK').enabled, false);
  assert.equal(val(p, 'TANK', 'AttachEffect.AttachTypes'), 'OLD1,OLD2');
  assert.equal(val(p, 'TANK', 'AttachEffect.Delays'), '5,5');
  assert.ok(p.section(status.names.Helper));
  assert.ok(result.changes.length);
  p = prepareAutoRank(p, options()).project;
  assert.equal(autoRankStatus(p, 'TANK').enabled, true);
  assert.equal(val(p, 'TANK', 'AttachEffect.Delays'), '5,5,-1,-1');
  assert.equal(autoRankStatus(p, 'TANK').prefix, status.prefix);
});

test('existing promotions, malformed attach lists and incomplete data are never silently overwritten', () => {
  const global = fixture('[AudioVisual]\nPromote.EliteAnimation=EXISTING\n');
  const before = global.files.map(serialize);
  assert.throws(() => prepareAutoRank(global, options()), /其他晋升动画/);
  assert.deepEqual(global.files.map(serialize), before);
  assert.throws(() => prepareAutoRank(fixture('[TANK]\nAttachEffect.AttachTypes=A,,B\n'), options()), /空项/);
  assert.throws(() => prepareAutoRank(fixture('[TANK]\nAttachEffect.AttachTypes=AutoRankSpawnFirst,AutoRankSpawnSecond\n'), options()), /测试效果/);
  assert.throws(() => prepareAutoRank(fixture('[TANK]\nCost=0\n'), options()), /Cost/);
  assert.throws(() => prepareAutoRank(fixture(), { ...options(), interval: '1073741824' }), /等待帧数/);
  assert.throws(() => prepareAutoRank(fixture('[#include]\n0=missing.ini\n'), options()), /加载不完整/);
  assert.throws(() => prepareAutoRank(fixture('[WeaponTypes]\n0=MRARankStopW\n'), options()), /已登记/);
});

test('tampered generated effects and shared animation are detected before another change', () => {
  let p = prepareAutoRank(fixture(), options()).project;
  const status = autoRankStatus(p, 'TANK');
  p.set('TANK', 'Trainable', 'no');
  assert.match(autoRankDrift(p)[0], /Trainable/);
  p = prepareAutoRank(p, options()).project;
  assert.deepEqual(autoRankDrift(p), []);
  p.set(status.names.First, 'Groups', 'Other');
  assert.throws(() => prepareAutoRank(p, options()), /规则已被修改/);
  const fresh = prepareAutoRank(fixture(), options()).project;
  const art = new IniProject(fresh.files, 'artmo.ini');
  art.set('MRARankElite', 'Weapon', 'Other');
  assert.throws(() => prepareAutoRank(fresh, options('TANK2')), /共享配置不完整/);
});

test('existing tested global cleanup is extended without changing its old effect list', () => {
  const p = fixture(`[AudioVisual]\nPromote.VeteranAnimation=ARVETNOP\nPromote.EliteAnimation=ARELITESTOP\n[AutoRankStopWeapon]\nWarhead=AutoRankStopWH\n[AutoRankStopWH]\nCellSpread=0\nVerses=0%,0%,0%,0%,0%,0%,0%,0%,0%,0%,0%\nEffectsRequireVerses=no\nAffectsOwner=yes\nAffectsAllies=no\nAffectsEnemies=no\nAttachEffect.RemoveTypes=AutoRankSpawnFirst,AutoRankSpawnSecond\n[AutoRankSpawnFirst]\nDuration=300\nExpireWeapon=AutoRankSpawnWeapon\nExpireWeapon.TriggerOn=expire\n[AutoRankSpawnSecond]\nDuration=600\nExpireWeapon=AutoRankSpawnWeapon\nExpireWeapon.TriggerOn=expire\n[TANK]\nAttachEffect.AttachTypes=AutoRankSpawnFirst,AutoRankSpawnSecond\nAttachEffect.Delays=-1,-1\nAttachEffect.RecreationDelays=-1,-1\n`);
  const art = new IniProject(p.files, 'artmo.ini');
  art.appendGeneratedSections([['ARVETNOP', { Damage: '0' }], ['ARELITESTOP', { Weapon: 'AutoRankStopWeapon', 'Damage.DealtByInvoker': 'yes', UseCenterCoordsIfAttached: 'yes', Damage: '1' }]], art.resolve('artmo.ini'));
  const result = prepareAutoRank(p, options()), q = result.project;
  assert.equal(val(q, 'AudioVisual', 'Promote.EliteAnimation'), 'ARELITESTOP');
  assert.equal(val(q, 'AutoRankStopWH', 'AttachEffect.RemoveTypes'), 'AutoRankSpawnFirst,AutoRankSpawnSecond');
  assert.equal(val(q, 'AutoRankStopWH', 'AttachEffect.RemoveGroups'), 'MRARankGroup');
  assert.equal(val(q, 'TANK', 'AttachEffect.AttachTypes'), 'MRA1First,MRA1Second');
  assert.ok(result.warnings.some(warning => warning.includes('测试计时器')));
});

test('loose transparent sprite takes precedence over archive data', async () => {
  const header = new Uint8Array(22), view = new DataView(header.buffer), archived = sprite();
  view.setUint16(4, 1, true); view.setUint32(6, archived.length, true); view.setUint32(10, hashMixFilename('INVISOX.SHP'), true); view.setUint32(18, archived.length, true);
  const mix = Object.assign(new Blob([header, archived]), { name: 'expandmo99.mix', webkitRelativePath: '' });
  const loose = Object.assign(new Blob([new Uint8Array([1, 2, 3])]), { name: 'INVISOX.SHP', webkitRelativePath: '' });
  const resource = await GameResources.load([mix, loose]);
  assert.deepEqual([...(await resource.findFile('invisox.shp')).bytes], [1, 2, 3]);
});
