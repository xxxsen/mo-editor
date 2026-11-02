import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, parseFile, serialize } from '../src/ini.js';
import { warheadReferences } from '../src/warhead-references.js';

test('warhead references retain field roles, ordered duplicates and unresolved object IDs', () => {
  const data = `[WH]\nCrit.Warhead=CRIT\nLaunchSW=SW,,none, SW\nShield.BreakWeapon=GUN\nSuppressRevengeWeapons.Types=GUN,OTHER\nShield.AttachTypes=SHIELD, Missing, SHIELD\nAttachEffect.RemoveTypes=SLOW\nSuppressReflectDamage.Types=SLOW\nConvert2.From=OLD,NEW\nConvert2.To=RESULT\nConvert2.AffectedHouses=all\nDetonateOnAllMapObjects.AffectTypes=OLD\nAttachEffect.RemoveGroups=GROUP\nAnimList=BOOM,BOOM\n`;
  const project = new IniProject([parseFile('rulesmo.ini', new TextEncoder().encode(data))]);
  const before = serialize(project.files[0]);
  const refs = warheadReferences(project, 'WH');
  assert.deepEqual(refs.filter(ref => ref.key === 'LaunchSW').map(({ id, index }) => [id, index]), [['SW', 0], ['SW', 3]]);
  assert.deepEqual(refs.filter(ref => ref.key === 'Shield.AttachTypes').map(({ id, type, index }) => [id, type, index]), [['SHIELD', 'shield', 0], ['Missing', 'shield', 1], ['SHIELD', 'shield', 2]]);
  assert.deepEqual(refs.filter(ref => ref.key.startsWith('Convert')).map(({ id, type, key }) => [id, type, key]), [['OLD', 'techno', 'Convert2.From'], ['NEW', 'techno', 'Convert2.From'], ['RESULT', 'techno', 'Convert2.To']]);
  assert.ok(refs.some(ref => ref.type === 'weapon' && ref.id === 'GUN' && ref.key === 'Shield.BreakWeapon'));
  assert.ok(refs.some(ref => ref.type === 'attachtype' && ref.key === 'SuppressReflectDamage.Types'));
  assert.equal(refs.filter(ref => ref.type === 'animation').length, 2);
  assert.ok(!refs.some(ref => ref.id === 'all' || ref.id === 'GROUP'));
  assert.deepEqual(serialize(project.files[0]), before);
  project.set('WH', 'Shield.BreakWeapon', 'NEWGUN');
  assert.ok(warheadReferences(project, 'WH').some(ref => ref.key === 'Shield.BreakWeapon' && ref.id === 'NEWGUN'));
  assert.deepEqual(warheadReferences(project, 'MISSING'), []);
});
