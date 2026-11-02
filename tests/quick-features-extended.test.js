import test from 'node:test';
import assert from 'node:assert/strict';
import { IniProject, listTypes, parseFile, serialize } from '../src/ini.js';
import { quickFeaturesFor, quickFeatureFields, prepareQuickFeature, garrisonWeaponWarning, passengerWeapons, preparePassengerFire } from '../src/quick-features.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const file = (name, text) => parseFile(name, enc.encode(text));
const textOf = item => dec.decode(serialize(item));
const feature = (type, id) => quickFeaturesFor(type).find(item => item.id === id);
const valuesFor = (project, section, type, id) => Object.fromEntries(quickFeatureFields(project, section, feature(type, id)).map(field => [field.key, field.value]));
const apply = (project, section, type, featureId, values = {}) => prepareQuickFeature(project, { featureId, type, section, values: { ...valuesFor(project, section, type, featureId), ...values } });

const rules = `[InfantryTypes]\n0=VIRUS\n1=E1\n2=E2\n[VehicleTypes]\n0=YTNK\n1=OTHER\n[BuildingTypes]\n0=HOUSE\n[Countries]\n0=AAA\n1=BBB\n[WeaponTypes]\n0=Virusgun\n1=VirusgunE\n2=DeathGun\n[SuperWeaponTypes]\n0=SW1\n1=SW2\n[VIRUS]\nName=Virus\nPrimary=Virusgun\nElitePrimary=VirusgunE\nSecondary=Virusgun\nCost=1000\nSize=1\n[E1]\nName=E1\nSize=1\n[E2]\nName=E2\nSize=2\n[YTNK]\nPassengers=2\nSizeLimit=1\nOpenTopped=yes\n[OTHER]\nPrimary=Virusgun\n[HOUSE]\nCanBeOccupied=yes\nMaxNumberOccupants=2\nProduceCashAmount=10 ; income\n[SW1]\nType=IronCurtain\nRechargeTime=5\n[SW2]\nType=Custom\n[Virusgun]\nDamage=200\nProjectile=Invisible\nWarhead=VirusAttach\nFireInTransport=no ; normal\nCustom=yes\n[VirusgunE]\nDamage=220\nProjectile=Invisible\nWarhead=VirusAttach\nFireInTransport=no ; elite\n[DeathGun]\nDamage=500\nWarhead=ExplosionWH\n`;
const fixture = () => new IniProject([file('rulesmo.ini', rules)]);

test('feature availability separates buildings, units and passenger diagnostics', () => {
  const ids = type => quickFeaturesFor(type).map(item => item.id);
  for (const id of ['income', 'stealth-building', 'detection-building', 'protection', 'payload', 'availability', 'death', 'superweapon']) assert.ok(ids('building').includes(id), id);
  for (const id of ['transport', 'stealth', 'detection', 'protection', 'payload', 'availability', 'veterancy', 'death', 'passenger-fire']) assert.ok(ids('vehicle').includes(id), id);
  assert.ok(ids('infantry').includes('passenger-fire'));
  assert.ok(!ids('infantry').includes('payload'));
  assert.ok(!ids('vehicle').includes('superweapon'));
  assert.ok(ids('weapon').includes('phobos-burst'));
  assert.ok(!ids('weapon').includes('transport'));
});

test('armed buildings warn about garrison weapon conflicts without altering their weapons', () => {
  const main = file('rulesmo.ini', '[#include]\n0=extra.ini\n[HOUSE]\nPrimary=OldGun\nSecondary=<none>\n[EMPTY]\nPrimary=none\n');
  const extra = file('extra.ini', '[HOUSE]\nPrimary=CurrentGun\nElitePrimary=EliteGun\nWeapon3=Gun3\nEliteWeapon3=Elite3\n');
  const project = new IniProject([main, extra]);
  const result = apply(project, 'HOUSE', 'building', 'garrison');
  const warning = result.warnings.find(item => item.includes('建筑原有武器'));
  assert.ok(warning);
  for (const reference of ['Primary=CurrentGun', 'ElitePrimary=EliteGun', 'Weapon3=Gun3', 'EliteWeapon3=Elite3']) assert.ok(warning.includes(reference), reference);
  assert.ok(!warning.includes('OldGun') && !warning.includes('Secondary'));
  assert.equal(result.project.get('HOUSE', 'Primary').value, 'CurrentGun');
  assert.equal(result.project.get('HOUSE', 'Weapon3').value, 'Gun3');
  assert.equal(garrisonWeaponWarning(project, 'EMPTY'), '');
  assert.ok(!apply(project, 'EMPTY', 'building', 'garrison').warnings.some(item => item.includes('建筑原有武器')));
});

test('income and stealth prefill existing values and preserve unselected optional fields', () => {
  const project = fixture();
  const income = valuesFor(project, 'HOUSE', 'building', 'income');
  assert.deepEqual(income, { ProduceCashAmount: '10', ProduceCashDelay: '100', ProduceCashStartup: '', ProduceCashDisplay: '', Capturable: '', NeedsEngineer: '', Unsellable: '' });
  const candidate = apply(project, 'HOUSE', 'building', 'income', { ProduceCashAmount: '25', ProduceCashStartup: '-50', ProduceCashDisplay: 'yes' });
  assert.equal(project.get('HOUSE', 'ProduceCashAmount').value, '10');
  assert.equal(candidate.project.get('HOUSE', 'ProduceCashStartup').value, '-50');
  assert.match(textOf(candidate.project.files[0]), /ProduceCashAmount=25 ; income/);
  assert.throws(() => apply(project, 'HOUSE', 'building', 'income', { ProduceCashDelay: '-1' }), /整数/);
  const stealth = apply(candidate.project, 'YTNK', 'vehicle', 'stealth', { CloakStop: 'yes', CloakingSpeed: '1' });
  assert.equal(stealth.project.get('YTNK', 'Cloakable').value, 'yes');
  assert.equal(stealth.project.get('YTNK', 'CloakStop').value, 'yes');
  assert.equal(stealth.project.get('YTNK', 'CloakingSpeed').value, '1');
  assert.equal(stealth.project.get('YTNK', 'Cloakable.Powered'), undefined);
});

test('detection and protection use type-specific fields and preserve unspecified immunity defaults', () => {
  const project = fixture();
  let result = apply(project, 'HOUSE', 'building', 'detection-building', { SensorsSight: '9' });
  assert.equal(result.project.get('HOUSE', 'SensorArray').value, 'yes');
  assert.equal(result.project.get('HOUSE', 'SensorsSight').value, '9');
  assert.equal(result.project.get('HOUSE', 'Sensors'), undefined);
  result = apply(result.project, 'VIRUS', 'infantry', 'detection', { SensorsSight: '6', Sensors: 'no' });
  assert.equal(result.project.get('VIRUS', 'SensorArray'), undefined);
  result = apply(result.project, 'VIRUS', 'infantry', 'protection', { ImmuneToEMP: 'yes', ImmuneToPsionics: 'no' });
  assert.equal(result.project.get('VIRUS', 'ImmuneToEMP').value, 'yes');
  assert.equal(result.project.get('VIRUS', 'ImmuneToPsionics').value, 'no');
  assert.equal(result.project.get('VIRUS', 'ImmuneToRadiation'), undefined);
  assert.equal(result.project.get('VIRUS', 'ImmuneToAbduction'), undefined);
  const reset = apply(result.project, 'VIRUS', 'infantry', 'protection', { ImmuneToEMP: '' });
  assert.equal(reset.project.get('VIRUS', 'ImmuneToEMP'), undefined);
  assert.ok(reset.changes.some(change => change.kind === 'remove' && change.key === 'ImmuneToEMP'));
});

test('construction, veterancy, death and superweapon features keep references and other fields unchanged', () => {
  let project = fixture();
  let result = apply(project, 'VIRUS', 'infantry', 'availability', { Owner: 'AAA,BBB', Prerequisite: 'BARRACKS', TechLevel: '-1', BuildLimit: '-1' });
  assert.ok(result.warnings.some(warning => warning.includes('TechLevel')));
  project = result.project;
  result = apply(project, 'VIRUS', 'infantry', 'veterancy', { Trainable: 'yes', EliteAbilities: 'SELF_HEAL,EMPIMMUNE', ElitePrimary: 'VirusgunE' });
  assert.equal(result.project.get('VirusgunE', 'FireInTransport').value, 'no');
  assert.equal(result.project.get('VIRUS', 'EliteAbilities').value, 'SELF_HEAL,EMPIMMUNE');
  project = result.project;
  result = apply(project, 'YTNK', 'vehicle', 'death', { DeathWeapon: 'DeathGun' });
  assert.equal(result.project.get('YTNK', 'Explodes').value, 'yes');
  assert.equal(result.project.get('DeathGun', 'Damage').value, '500');
  assert.throws(() => apply(project, 'YTNK', 'vehicle', 'death', { DeathWeapon: 'MISSING' }), /找不到/);
  result = apply(result.project, 'HOUSE', 'building', 'superweapon', { SuperWeapon: 'SW1', SuperWeapons: 'SW2' });
  assert.equal(result.project.get('HOUSE', 'SuperWeapon').value, 'SW1');
  assert.equal(result.project.get('HOUSE', 'SuperWeapons').value, 'SW2');
  assert.equal(result.project.get('SW2', 'Type').value, 'Custom');
  assert.equal(result.project.get('VIRUS', 'Owner').value, 'AAA,BBB');
  const partial = prepareQuickFeature(result.project, { featureId: 'superweapon', type: 'building', section: 'HOUSE', values: { SuperWeapon2: 'SW2' } });
  assert.equal(partial.project.get('HOUSE', 'SuperWeapon').value, 'SW1', 'omitted fields must retain existing values');
  const cleared = apply(result.project, 'HOUSE', 'building', 'superweapon', { SuperWeapon: '' });
  assert.equal(cleared.project.get('HOUSE', 'SuperWeapon'), undefined, 'clearing an unsaved newly-added field should remove it');
});

test('initial payload validates new passengers and reports capacity and size without changing transport settings', () => {
  const project = fixture(), before = project.files.map(serialize);
  const payload = { 'InitialPayload.Types': 'E1,E2', 'InitialPayload.Nums': '2,1' };
  const result = apply(project, 'YTNK', 'vehicle', 'payload', payload);
  assert.deepEqual(project.files.map(serialize), before);
  assert.equal(result.project.get('YTNK', 'InitialPayload.Types').value, 'E1,E2');
  assert.equal(result.project.get('YTNK', 'InitialPayload.Nums').value, '2,1');
  assert.equal(result.project.get('YTNK', 'Passengers').value, '2');
  assert.ok(result.warnings.some(warning => warning.includes('Passengers=2')));
  assert.ok(result.warnings.some(warning => warning.includes('E2') && warning.includes('SizeLimit')));
  assert.throws(() => apply(project, 'YTNK', 'vehicle', 'payload', { 'InitialPayload.Types': 'E1,UNKNOWN', 'InitialPayload.Nums': '1,1' }), /未找到/);
  assert.throws(() => apply(project, 'YTNK', 'vehicle', 'payload', { 'InitialPayload.Types': 'YTNK', 'InitialPayload.Nums': '1' }), /自身/);
  assert.throws(() => apply(project, 'HOUSE', 'building', 'payload', { 'InitialPayload.Types': 'OTHER', 'InitialPayload.Nums': '1' }), /未找到/);
  assert.throws(() => apply(project, 'YTNK', 'vehicle', 'payload', { 'InitialPayload.Types': 'E1', 'InitialPayload.Nums': '0' }), /正整数/);
  assert.throws(() => apply(project, 'YTNK', 'vehicle', 'payload', { 'InitialPayload.Types': 'E1', 'InitialPayload.Nums': '1,,2' }), /空项/);
  assert.deepEqual(project.files.map(serialize), before);
  project.set('YTNK', 'Passengers', '3'); project.set('YTNK', 'SizeLimit', '2');
  const sized = apply(project, 'YTNK', 'vehicle', 'payload', { 'InitialPayload.Types': 'E2', 'InitialPayload.Nums': '2' });
  assert.ok(sized.warnings.some(warning => warning.includes('占用 4') && warning.includes('Passengers=3')));
  project.set('YTNK', 'Passengers.BySize', 'no');
  const perSeat = apply(project, 'YTNK', 'vehicle', 'payload', { 'InitialPayload.Types': 'E2', 'InitialPayload.Nums': '2' });
  assert.ok(!perSeat.warnings.some(warning => warning.includes('占用 4')));
});

test('existing unusual and missing payload counts are not normalized by a no-op preview', () => {
  const project = fixture();
  project.set('YTNK', 'InitialPayload.Types', 'E1, E2');
  project.set('YTNK', 'InitialPayload.Nums', '2');
  const noChange = apply(project, 'YTNK', 'vehicle', 'payload');
  assert.equal(noChange.changes.length, 0);
  assert.equal(noChange.project.get('YTNK', 'InitialPayload.Types').value, 'E1, E2');
  assert.equal(noChange.project.get('YTNK', 'InitialPayload.Nums').value, '2');
  const removal = apply(project, 'YTNK', 'vehicle', 'payload', { 'InitialPayload.Types': '', 'InitialPayload.Nums': '' });
  assert.equal(removal.project.get('YTNK', 'InitialPayload.Types'), undefined);
  assert.equal(removal.project.get('YTNK', 'InitialPayload.Nums'), undefined);
});

test('clearing a selected list removes earlier definitions as well as the effective include', () => {
  const main = file('rulesmo.ini', '[#include]\n0=extra.ini\n[HOUSE]\nSuperWeapons=SW1\nName=Keep\n');
  const extra = file('extra.ini', '[HOUSE]\nSuperWeapons=SW2\nCost=100\n');
  const project = new IniProject([main, extra]);
  const result = apply(project, 'HOUSE', 'building', 'superweapon', { SuperWeapons: '' });
  assert.equal(result.project.get('HOUSE', 'SuperWeapons'), undefined);
  assert.deepEqual(result.changes.map(change => change.kind), ['remove', 'remove']);
  assert.match(textOf(result.project.files[0]), /Name=Keep/);
  assert.match(textOf(result.project.files[1]), /Cost=100/);
  assert.ok(!result.project.files.some(item => textOf(item).includes('SuperWeapons=')));
  assert.equal(project.get('HOUSE', 'SuperWeapons').value, 'SW2');
});

test('passenger diagnostics identify shared weapon slots and preview direct changes without modifying the source', () => {
  const project = fixture(); project.set('VIRUS', 'Cost', '1200');
  const source = project.files.map(serialize);
  const weapons = passengerWeapons(project, 'VIRUS');
  assert.deepEqual(weapons.find(item => item.id === 'Virusgun').slots, ['Primary', 'Secondary']);
  assert.ok(weapons.find(item => item.id === 'Virusgun').references.some(ref => ref.section === 'OTHER'));
  const result = preparePassengerFire(project, { type: 'vehicle', section: 'YTNK', passenger: 'VIRUS', mode: 'direct', selections: { Virusgun: 'yes', VirusgunE: 'yes' } });
  assert.deepEqual(project.files.map(serialize), source);
  assert.equal(project.get('Virusgun', 'FireInTransport').value, 'no');
  assert.equal(result.project.get('Virusgun', 'FireInTransport').value, 'yes');
  assert.equal(result.project.get('VirusgunE', 'FireInTransport').value, 'yes');
  assert.equal(result.project.get('VIRUS', 'Cost').value, '1200');
  assert.ok(result.warnings.some(warning => warning.includes('[OTHER]')));
  assert.match(textOf(result.project.files[0]), /FireInTransport=yes ; normal/);
});

test('passenger diagnosis reports disabled weapons and carrier constraints without changing them', () => {
  const project = fixture();
  project.set('VIRUS', 'OpenTransportWeapon', '1');
  project.set('VIRUS', 'Size', '2');
  project.set('YTNK', 'Passengers.Allowed', 'E1');
  project.set('YTNK', 'NoManualEnter', 'yes');
  const result = preparePassengerFire(project, { type: 'vehicle', section: 'YTNK', passenger: 'VIRUS', mode: 'direct', selections: {} });
  assert.equal(result.changes.length, 0);
  for (const term of ['Virusgun', 'FireInTransport', 'SizeLimit', 'Passengers.Allowed', 'NoManualEnter', 'OpenTransportWeapon']) {
    assert.ok(result.warnings.some(warning => warning.includes(term)), term);
  }
  assert.throws(() => preparePassengerFire(project, { type: 'vehicle', section: 'YTNK', passenger: 'YTNK', mode: 'direct', selections: {} }), /自身/);
});

test('passenger diagnostics can clone shared weapons, register them and atomically remap only the selected passenger', () => {
  const project = fixture(), before = project.files.map(serialize);
  const result = preparePassengerFire(project, { type: 'vehicle', section: 'YTNK', passenger: 'VIRUS', mode: 'copy', selections: { Virusgun: 'yes', VirusgunE: 'yes' }, reservedIds: ['Virusgun_OT'] });
  assert.deepEqual(project.files.map(serialize), before);
  const normal = result.project.get('VIRUS', 'Primary').value, elite = result.project.get('VIRUS', 'ElitePrimary').value;
  assert.equal(normal, 'Virusgun_OT2');
  assert.equal(result.project.get('VIRUS', 'Secondary').value, normal);
  assert.equal(result.project.get('OTHER', 'Primary').value, 'Virusgun');
  assert.equal(result.project.get('Virusgun', 'FireInTransport').value, 'no');
  assert.equal(result.project.get(normal, 'FireInTransport').value, 'yes');
  assert.equal(result.project.get(normal, 'Warhead').value, 'VirusAttach');
  assert.equal(result.project.get(normal, 'Custom').value, 'yes');
  assert.equal(result.project.get(elite, 'FireInTransport').value, 'yes');
  assert.ok(listTypes(result.project, 'WeaponTypes').includes(normal));
  assert.ok(result.changes.some(change => change.kind === 'copy' && change.after === normal));
  assert.ok(result.warnings.some(warning => warning.includes('共享原来的弹头')));
  const reloaded = new IniProject(result.project.files.map(item => parseFile(item.name, serialize(item), item.path)));
  assert.equal(reloaded.get('VIRUS', 'Primary').value, normal);
  assert.equal(reloaded.get(normal, 'FireInTransport').value, 'yes');
});

test('weapon copy IDs avoid unresolved weapon references outside the unit registry', () => {
  const project = fixture();
  project.set('SW1', 'WeaponType', 'Virusgun_OT');
  const result = preparePassengerFire(project, { type: 'infantry', section: 'VIRUS', passenger: 'VIRUS', mode: 'copy', selections: { Virusgun: 'yes' } });
  assert.equal(result.project.get('VIRUS', 'Primary').value, 'Virusgun_OT2');
  assert.equal(result.project.get('SW1', 'WeaponType').value, 'Virusgun_OT');
  assert.equal(result.project.section('Virusgun_OT'), undefined);
});

test('passenger diagnostics reject invalid targets and cannot partially modify an incomplete project', () => {
  const project = new IniProject([file('rulesmo.ini', '[#include]\n0=missing.ini\n[InfantryTypes]\n0=VIRUS\n[VIRUS]\nPrimary=Gun\n[Gun]\nDamage=1\nFireInTransport=no\n')]);
  const before = project.files.map(serialize);
  assert.throws(() => preparePassengerFire(project, { type: 'infantry', section: 'VIRUS', passenger: 'VIRUS', mode: 'copy', selections: { Gun: 'yes' } }), /加载不完整/);
  assert.throws(() => preparePassengerFire(project, { type: 'infantry', section: 'VIRUS', passenger: 'OTHER', mode: 'direct', selections: { Gun: 'yes' } }), /请选择/);
  assert.throws(() => preparePassengerFire(project, { type: 'infantry', section: 'VIRUS', passenger: 'VIRUS', mode: 'direct', selections: { MISSING: 'yes' } }), /无法修改/);
  assert.deepEqual(project.files.map(serialize), before);
});
