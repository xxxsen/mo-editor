import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, parseFile, serialize, listTypes } from '../src/ini.js';
import { getFieldInfo } from '../src/field-metadata.js';
import { enumKindForField } from '../src/enum-options.js';
import { phobosVersion, detectPhobos } from '../src/phobos-version.js';
import { weaponWarheadReferences } from '../src/weapon-references.js';
import { extraWarheadRows, prepareExtraWarheads } from '../src/phobos-warheads.js';
import { prepareObjectCreation } from '../src/object-creation.js';
import { prepareQuickFeature } from '../src/quick-features.js';
import { analyzeWeaponEffect } from '../src/rule-analysis.js';

const encoder = new TextEncoder();
const project = text => new IniProject([parseFile('rulesmo.ini', encoder.encode(text))]);
const fixture = () => project('[Warheads]\n0=HIT\n1=FIRST\n2=SECOND\n[W]\nDamage=200\nWarhead=HIT\nExtraWarheads=FIRST,SECOND\nExtraWarheads.DamageOverrides=10,20\nExtraWarheads.DetonationChances=25%\n[HIT]\nVerses=100%\n[FIRST]\nVerses=100%\n[SECOND]\nVerses=100%\n[TARGET]\nArmor=none\n');

function versionPe(name = 'Phobos') {
  const out = new Uint8Array(1024), view = new DataView(out.buffer);
  const w16 = (p, n) => view.setUint16(p, n, true), w32 = (p, n) => view.setUint32(p, n, true);
  w16(0, 0x5a4d); w32(0x3c, 0x80); w32(0x80, 0x4550); w16(0x86, 1); w16(0x94, 0);
  out.set(encoder.encode('.rsrc'), 0x98); w32(0x98 + 16, 512); w32(0x98 + 20, 512);
  const start = 512; w16(start, 192); w16(start + 2, 52);
  const put = (offset, text) => [...text].forEach((ch, i) => w16(offset + i * 2, ch.charCodeAt(0)));
  put(start + 6, 'VS_VERSION_INFO');
  const fixed = (start + 6 + ('VS_VERSION_INFO'.length + 1) * 2 + 3) & ~3;
  w32(fixed, 0xfeef04bd); w32(fixed + 8, 0x00000004); w32(fixed + 12, 0x00000002);
  put(fixed + 54, name);
  return out;
}

test('detects a Phobos PE version resource without claiming that it was loaded', async () => {
  assert.equal(phobosVersion(versionPe()), '0.4.0.2');
  assert.equal(phobosVersion(versionPe('Other')), null);
  const broken = versionPe(); broken[0] = 0; assert.equal(phobosVersion(broken), null);
  assert.equal(phobosVersion(versionPe().slice(0, 100)), null);
  const bytes = versionPe();
  assert.deepEqual(await detectPhobos([{ name: 'Phobos.dll', path: 'Phobos.dll', size: bytes.length, arrayBuffer: async () => bytes.buffer }]), { status: 'detected', version: '0.4.0.2' });
  assert.equal((await detectPhobos([{ name: 'Phobos.dll', path: 'sub/Phobos.dll', size: bytes.length, arrayBuffer: async () => bytes.buffer }])).status, 'missing');
});

test('extra-warhead rows preserve fallback values and reorder paired settings atomically', () => {
  const rules = fixture(), initial = serialize(rules.files[0]);
  const refs = weaponWarheadReferences(rules, 'W');
  assert.deepEqual(refs.slice(1).map(({ id, index }) => [id, index]), [['FIRST', 0], ['SECOND', 1]]);
  const rows = extraWarheadRows(rules, 'W');
  assert.deepEqual(rows.map(row => row.chance), ['25%', '25%']);
  assert.equal(prepareExtraWarheads(rules, 'W', rows).changes.length, 0);
  const next = prepareExtraWarheads(rules, 'W', [rows[1], rows[0]]);
  assert.deepEqual(serialize(rules.files[0]), initial);
  assert.equal(next.project.get('W', 'ExtraWarheads').value, 'SECOND,FIRST');
  assert.equal(next.project.get('W', 'ExtraWarheads.DamageOverrides').value, '20,10');
  assert.equal(next.project.get('W', 'ExtraWarheads.DetonationChances').value, '25%');
  assert.throws(() => prepareExtraWarheads(rules, 'W', [{ id: 'UNKNOWN', damage: '', chance: '', full: '' }]), /登记/);
  assert.throws(() => prepareExtraWarheads(rules, 'W', [{ ...rows[0], chance: '' }, rows[1]]), /空项/);
});

test('duplicate extra warheads are preserved and malformed unused list values cannot be silently lost', () => {
  const rules = fixture(); rules.set('W', 'ExtraWarheads', 'FIRST,FIRST');
  assert.deepEqual(weaponWarheadReferences(rules, 'W').filter(ref => ref.key === 'ExtraWarheads').map(ref => ref.id), ['FIRST', 'FIRST']);
  rules.set('W', 'ExtraWarheads.DamageOverrides', '10,20,30');
  const rows = extraWarheadRows(rules, 'W');
  assert.throws(() => prepareExtraWarheads(rules, 'W', [rows[0]]), /多余或空项/);
  assert.throws(() => prepareExtraWarheads(rules, 'W', [{ ...rows[0], damage: '11' }, rows[1]]), /未使用项/);
});

test('Phobos types are registered and Ares inline effect fields remain intact', () => {
  let rules = project('[U]\nAttachEffect.Duration=90\n');
  for (const [type, id, registry] of [['shield', 'Shield1', 'ShieldTypes'], ['attachtype', 'Slow', 'AttachEffectTypes'], ['radiation', 'Rad1', 'RadiationTypes']]) {
    rules = prepareObjectCreation(rules, { type, id }).project;
    assert.ok(listTypes(rules, registry).includes(id));
  }
  rules = prepareQuickFeature(rules, { featureId: 'phobos-attach', type: 'vehicle', section: 'U', values: { 'AttachEffect.AttachTypes': 'Slow' } }).project;
  assert.equal(rules.get('U', 'AttachEffect.Duration').value, '90');
  assert.equal(rules.get('U', 'AttachEffect.AttachTypes').value, 'Slow');
  assert.match(getFieldInfo('SelfHealing.Rate', { type: 'shield' }).description, /分钟/);
  assert.equal(enumKindForField('vehicle', 'Interceptor.Weapon'), 'phobosInterceptorSlot');
  assert.equal(enumKindForField('projectile', 'Trajectory'), 'phobosTrajectory');
});

test('quick previews validate probabilities and show conflicts without changing shared objects', () => {
  const rules = fixture(); rules.set('HIT', 'Crit.Chance', '10%');
  assert.throws(() => prepareQuickFeature(rules, { featureId: 'phobos-crit', type: 'warhead', section: 'HIT', values: { 'Crit.Chance': '110%' } }), /0% 到 100%/);
  const result = prepareQuickFeature(rules, { featureId: 'phobos-crit', type: 'warhead', section: 'HIT', values: { 'Crit.Chance': '25%', 'Crit.ExtraDamage': '50', 'Crit.Warhead': 'SECOND' } });
  assert.equal(rules.get('HIT', 'Crit.Chance').value, '10%');
  assert.equal(result.project.get('HIT', 'Crit.Chance').value, '25%');
  assert.ok(result.warnings.some(item => item.includes('共用')));
  const p = project('[P]\nArcing=yes\nROT=5\n');
  const trajectory = prepareQuickFeature(p, { featureId: 'phobos-trajectory', type: 'projectile', section: 'P', values: { Trajectory: 'Straight', 'Trajectory.Speed': '100' } });
  assert.ok(trajectory.warnings.some(item => item.includes('Arcing') && item.includes('ROT')));
  assert.equal(trajectory.project.get('P', 'Arcing').value, 'yes');
  assert.throws(() => prepareQuickFeature(p, { featureId: 'phobos-trajectory', type: 'projectile', section: 'P', values: { Trajectory: 'Straight', 'Trajectory.Speed': '50%' } }), /非负数字/);
});

test('damage comparison identifies extra stages and explicitly excludes shield and critical effects', () => {
  const rules = fixture(); rules.set('TARGET', 'ShieldType', 'SHIELD'); rules.set('HIT', 'Crit.Chance', '50%');
  const report = analyzeWeaponEffect(rules, 'W', 'TARGET');
  assert.equal(report.stages.length, 3);
  assert.deepEqual(report.stages.slice(1).map(item => [item.warhead, item.damage, item.chance]), [['FIRST', '10', '25%'], ['SECOND', '20', '25%']]);
  assert.ok(report.limitations.some(item => item.includes('护盾')));
  assert.ok(report.limitations.some(item => item.includes('暴击')));
});

test('laser trails are registered and edited only in an explicitly selected art project', () => {
  const rules = project('[TANK]\nImage=TANKART\n');
  assert.throws(() => prepareObjectCreation(rules, { type: 'lasertrail', id: 'TRAIL' }), /美术规则/);
  assert.throws(() => prepareQuickFeature(rules, { featureId: 'phobos-art-trail', type: 'sections', section: 'TANK', values: { 'LaserTrail0.Type': 'TRAIL' } }), /美术主文件/);
  let art = new IniProject([parseFile('artmo.ini', encoder.encode('[TANKART]\nCameoPCX=ICON\n'))]);
  assert.throws(() => prepareObjectCreation(art, { type: 'shield', id: 'WRONG' }), /规则主文件/);
  art = prepareObjectCreation(art, { type: 'lasertrail', id: 'TRAIL' }).project;
  art.set('TRAIL', 'Color', '255,0,0');
  assert.deepEqual(listTypes(art, 'LaserTrailTypes'), ['TRAIL']);
  assert.throws(() => prepareQuickFeature(art, { featureId: 'phobos-art-trail', type: 'sections', section: 'TANKART', values: { 'LaserTrail0.Type': 'TRAIL', 'LaserTrail0.FLH': '1,2' } }), /三个整数/);
  const result = prepareQuickFeature(art, { featureId: 'phobos-art-trail', type: 'sections', section: 'TANKART', values: { 'LaserTrail0.Type': 'TRAIL', 'LaserTrail0.FLH': '1,2,3' } });
  assert.equal(result.project.get('TANKART', 'LaserTrail0.Type').value, 'TRAIL');
  assert.equal(result.project.get('TANKART', 'LaserTrail0.FLH').value, '1,2,3');
  assert.equal(art.get('TANKART', 'LaserTrail0.Type'), undefined);
  assert.ok(result.warnings.some(item => item.includes('图像')));
});

test('saving a second main file cannot bypass warnings from an edited rule graph', async () => {
  const { dirtyProjectWarnings } = await import('../src/ini.js');
  const rules = parseFile('rulesmo.ini', encoder.encode('[#include]\n0=missing.ini\n[U]\nCost=100\n'));
  const art = parseFile('artmo.ini', encoder.encode('[TANKART]\nCameoPCX=ICON\n'));
  const project = new IniProject([rules, art], 'rulesmo.ini');
  project.set('U', 'Cost', '200');
  project.mainPath = 'artmo.ini'; project.rebuild();
  assert.equal(project.warnings.length, 0);
  const changed = project.changes().map(change => change.file);
  const problems = dirtyProjectWarnings(project, ['rulesmo.ini', 'artmo.ini'], changed);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].path, 'rulesmo.ini');
  assert.match(problems[0].warnings[0], /missing.ini/);
  assert.deepEqual(dirtyProjectWarnings(project, ['artmo.ini'], changed), []);
});
