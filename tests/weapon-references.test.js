import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, parseFile } from '../src/ini.js';
import { usesIvanBomb, weaponWarheadReferences } from '../src/weapon-references.js';

const project = source => new IniProject([parseFile('rulesmo.ini', new TextEncoder().encode(source))]);

test('a weapon can refer to distinct hit and attached-bomb warheads', () => {
  const rules = project(`[VIRUSGUN]\nWarhead=VirusAttach\nIvanBomb.Warhead=VirusWH\n[VirusAttach]\nIvanBomb=yes\n[VirusWH]\nVerses=100%\n`);
  assert.equal(usesIvanBomb(rules, 'virusgun'), true);
  assert.deepEqual(weaponWarheadReferences(rules, 'VIRUSGUN'), [
    { key: 'Warhead', id: 'VirusAttach', source: 'weapon' },
    { key: 'IvanBomb.Warhead', id: 'VirusWH', source: 'weapon' },
  ]);
  rules.set('VIRUSGUN', 'IvanBomb.Warhead', 'VirusWHE');
  assert.equal(weaponWarheadReferences(rules, 'VIRUSGUN')[1].id, 'VirusWHE');
});

test('only an enabled bomb with no per-weapon setting resolves the loaded global default', () => {
  const rules = project(`[CombatDamage]\nIvanWarhead=GlobalBomb\n[ATTACH]\nIvanBomb=true\n[NORMAL]\nIvanBomb=no\n[FALLBACK]\nWarhead=ATTACH\n[BLANK]\nWarhead=ATTACH\nIvanBomb.Warhead= ; empty\n[ORDINARY]\nWarhead=NORMAL\n[EXPLICIT]\nWarhead=ATTACH\nIvanBomb.Warhead=ExplicitBomb\n[EMPTY]\nWarhead=ATTACH\nIvanBomb.Warhead=<none>\n[UNLOADED]\nWarhead=MISSING\n`);
  assert.deepEqual(weaponWarheadReferences(rules, 'FALLBACK'), [
    { key: 'Warhead', id: 'ATTACH', source: 'weapon' },
    { key: 'IvanBomb.Warhead', id: 'GlobalBomb', source: 'global' },
  ]);
  assert.deepEqual(weaponWarheadReferences(rules, 'ORDINARY').map(ref => ref.id), ['NORMAL']);
  assert.deepEqual(weaponWarheadReferences(rules, 'BLANK').map(ref => ref.id), ['ATTACH', 'GlobalBomb']);
  assert.deepEqual(weaponWarheadReferences(rules, 'EXPLICIT').map(ref => ref.id), ['ATTACH', 'ExplicitBomb']);
  assert.deepEqual(weaponWarheadReferences(rules, 'EMPTY').map(ref => ref.id), ['ATTACH']);
  assert.deepEqual(weaponWarheadReferences(rules, 'UNLOADED').map(ref => ref.id), ['MISSING']);
  rules.set('CombatDamage', 'IvanWarhead', 'NewGlobalBomb');
  assert.equal(weaponWarheadReferences(rules, 'FALLBACK')[1].id, 'NewGlobalBomb');
  rules.set('EXPLICIT', 'IvanBomb.Warhead', '');
  assert.equal(weaponWarheadReferences(rules, 'EXPLICIT')[1].id, 'NewGlobalBomb');
});

test('explicit references remain discoverable even without the activation flag or a definition', () => {
  const rules = project(`[UNUSUAL]\nWarhead=None\nIvanBomb.Warhead=UnknownWH\n`);
  assert.equal(usesIvanBomb(rules, 'UNUSUAL'), false);
  assert.deepEqual(weaponWarheadReferences(rules, 'UNUSUAL'), [
    { key: 'IvanBomb.Warhead', id: 'UnknownWH', source: 'weapon' },
  ]);
  rules.set('UNUSUAL', 'IvanBomb.Warhead', '<none>');
  assert.deepEqual(weaponWarheadReferences(rules, 'UNUSUAL'), []);
});
