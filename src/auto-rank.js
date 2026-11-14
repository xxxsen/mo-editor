import { IniProject, listTypes } from './ini.js';

// This is the tested Phobos 0.4.0.2 mechanism, not a native promotion flag.
// It uses two non-repeating self-owned effects and an invisible neutral victim.
const PROFILE = 'MRARankProfiles', SHARED = 'MRARankShared', GROUP = 'MRARankGroup';
const VETERAN = 'MRARankVet', ELITE = 'MRARankElite', STOP_WEAPON = 'MRARankStopW', STOP_WARHEAD = 'MRARankStopH';
const SEQUENCE = 'MRARankSeq', SPRITE = 'INVISOX';
const ZERO = '0%,0%,0%,0%,0%,0%,0%,0%,0%,0%,0%';
const TYPE_LISTS = { infantry: 'InfantryTypes', vehicle: 'VehicleTypes', aircraft: 'AircraftTypes', building: 'BuildingTypes' };
const ARRAYS = [
  ['AttachEffect.DurationOverrides', '0', '0'],
  ['AttachEffect.Delays', '0', '-1'],
  ['AttachEffect.InitialDelays', '0', '0'],
  ['AttachEffect.RecreationDelays', '-1', '-1'],
];
const norm = value => String(value ?? '').trim().toLowerCase();
const tokens = value => String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
const value = (project, section, key) => project.get(section, key)?.value.trim() || '';
const isTrue = v => /^(yes|true|1)$/i.test(v);
const isFalse = v => /^(no|false|0)$/i.test(v);
const equal = (a, b) => norm(a) === norm(b);
const has = (items, id) => items.some(item => equal(item, id));
const suffixes = ['Meta', 'First', 'Second', 'SpawnW', 'SpawnH', 'SpawnA', 'KillA', 'KillW', 'KillH', 'Helper', 'Armor'];
const namesFor = prefix => Object.fromEntries(suffixes.map(suffix => [suffix, prefix + suffix]));
const sequence = Object.fromEntries('Ready Guard Prone Walk FireUp Down Crawl Up FireProne Idle1 Idle2 Die1 Die2 Die3 Die4 Die5 Cheer Paradrop Panic'.split(' ').map(key => [key, '0,1,0']));
const animation = { Image: 'INVISO', VisibleTo: 'none', Layer: 'ground', Rate: '100', Normalized: 'no' };
const weapon = warhead => ({ Damage: '1', ROF: '1', Range: '1', Projectile: 'Invisible', Speed: '100', Warhead: warhead });
const registries = [...Object.values(TYPE_LISTS), 'WeaponTypes', 'Warheads', 'Projectiles', 'SuperWeaponTypes', 'Animations', 'AttachEffectTypes', 'ShieldTypes', 'RadiationTypes', 'LaserTrailTypes'];
const onlyFields = (project, section, allowed) => !!project.section(section) && [...project.section(section).fields.keys()].every(key => allowed.includes(key));
const STOP_FIELDS = ['cellspread', 'verses', 'effectsrequireverses', 'affectsowner', 'affectsallies', 'affectsenemies', 'attacheffect.removetypes', 'attacheffect.removegroups'];
const ANIM_FIELDS = ['image', 'visibleto', 'layer', 'rate', 'normalized', 'damage', 'usecentercoordsifattached', 'weapon', 'damage.dealtbyinvoker'];
const WEAPON_FIELDS = ['damage', 'rof', 'range', 'projectile', 'speed', 'warhead'];

// Mental Omega's lobby labels run from 0 (slowest) to 6 (fastest). The
// engine/client use different caps for skirmish and network games at speed 5.
// https://github.com/CnCNet/xna-cncnet-client/blob/develop/Docs/Migration-INI.md
export const AUTO_RANK_SPEEDS = [
  { id: '6', label: '6 最快' }, { id: '5', label: '5 很快' },
  { id: '4', label: '4 快' }, { id: '3', label: '3 中等' },
  { id: '2', label: '2 慢' }, { id: '1', label: '1 很慢' }, { id: '0', label: '0 最慢' },
];
const GAME_SPEED_CAPS = {
  skirmish: { 0: 10, 1: 12, 2: 15, 3: 20, 4: 30, 5: 60, 6: null },
  multiplayer: { 0: 10, 1: 12, 2: 15, 3: 20, 4: 30, 5: 45, 6: 60 },
};

export function estimateAutoRankTime({ interval, mode, speed, customFps = '' }) {
  const raw = String(interval ?? '').trim(), fpsText = String(customFps ?? '').trim();
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > 1073741823) return { status: 'invalid-interval' };
  if (!Object.hasOwn(GAME_SPEED_CAPS, mode) || !Object.hasOwn(GAME_SPEED_CAPS[mode], speed)) return { status: 'invalid-speed' };
  let fps = GAME_SPEED_CAPS[mode][speed];
  if (fpsText) {
    fps = Number(fpsText);
    if (!Number.isFinite(fps) || fps < 1 || fps > 1000) return { status: 'invalid-fps' };
  }
  if (fps === null) return { status: 'unlimited' };
  return { status: 'estimated', fps, custom: !!fpsText, firstSeconds: Number(raw) / fps, secondSeconds: Number(raw) * 2 / fps };
}

// A directory import can suggest the last saved lobby choice without claiming
// to know the speed of a running game or a map that overrides that choice.
export function savedSkirmishSpeed(project) {
  const find = path => project.files.find(file => norm(file.path.replaceAll('\\', '/')) === norm(path));
  const settings = find('Client/SkirmishSettings.ini'), options = find('Resources/GameOptions.ini');
  if (!settings || !options) return null;
  const settingsProject = new IniProject(project.files, settings.path), optionsProject = new IniProject(project.files, options.path);
  if (settingsProject.warnings.length || optionsProject.warnings.length) return null;
  if (!equal(value(optionsProject, 'cmbSkirmishGameSpeedCap', 'DataWriteMode'), 'Index')) return null;
  const raw = value(settingsProject, 'GameOptions', 'cmbSkirmishGameSpeedCap');
  if (!/^\d+$/.test(raw)) return null;
  const items = value(optionsProject, 'cmbSkirmishGameSpeedCap', 'Items').split(',').map(item => item.trim());
  if (items.some(item => !item)) return null;
  const label = items[Number(raw)] || '';
  const speed = label.match(/^([0-6])(?:\s|$)/)?.[1];
  return speed ?? null;
}

export function isTransparentRankSprite(input) {
  if (!input) return false;
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 8) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(6, true);
  if (view.getUint16(0, true) !== 0 || count < 2 || count > 1000 || bytes.length < 8 + count * 24) return false;
  for (let i = 0; i < count; i++) {
    const at = 8 + i * 24;
    if (view.getUint16(at + 4, true) !== 0 || view.getUint16(at + 6, true) !== 0) return false;
  }
  return true;
}

function positiveInteger(raw, what, max = 2147483647) {
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0 || Number(raw) > max) throw new Error(`${what}必须是 1 至 ${max} 的整数。`);
  return Number(raw);
}
function rankCost(project, section) {
  const cost = positiveInteger(value(project, section, 'Cost'), `[${section}] Cost`);
  const ratio = value(project, 'General', 'VeteranRatio');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(ratio) || !Number.isFinite(Number(ratio)) || Number(ratio) <= 0) throw new Error('请先在 [General] 中设置大于 0 的 VeteranRatio。');
  const helperCost = Math.ceil(cost * Number(ratio));
  if (!Number.isSafeInteger(helperCost) || helperCost < 1 || helperCost > 2147483647) throw new Error('根据 Cost 和 VeteranRatio 计算出的辅助对象造价超出游戏支持范围。');
  return { cost, ratio, helperCost };
}
function artProject(project) {
  const art = project.files.find(file => /^artmo\.ini$/i.test(file.path)) || project.files.find(file => /^artmd\.ini$/i.test(file.path));
  if (!art) throw new Error('未找到游戏根目录的 artmo.ini 或 artmd.ini，请导入完整游戏目录。');
  const result = new IniProject(project.files, art.path);
  if (result.warnings.length) throw new Error(`美术规则加载不完整：${result.warnings[0]}`);
  return result;
}
function ensureRegistry(project, registry, id) {
  const entries = listTypes(project, registry);
  if (has(entries, id)) return;
  const numbers = [...(project.section(registry)?.fields.keys() || [])].filter(key => /^\d+$/.test(key)).map(Number);
  if (numbers.some(n => !Number.isSafeInteger(n) || n >= 2147483647)) throw new Error(`类型列表 [${registry}] 编号无效，无法追加。`);
  const index = numbers.length ? Math.max(...numbers) + 1 : 0;
  project.appendEntry(registry, String(index), id, project.resolve(project.mainPath));
  const next = listTypes(project, registry);
  if (next.length !== entries.length + 1 || entries.some((entry, i) => entry !== next[i]) || next.at(-1) !== id) throw new Error(`无法安全追加 [${registry}]。`);
}
function assertLegacyStop(project, art) {
  if (!equal(value(project, 'AudioVisual', 'Promote.VeteranAnimation'), 'ARVETNOP') || !equal(value(project, 'AudioVisual', 'Promote.EliteAnimation'), 'ARELITESTOP')) return false;
  const stop = 'AutoRankStopWH';
  const verses = tokens(value(project, stop, 'Verses'));
  const checks = [
    onlyFields(art, 'ARVETNOP', ANIM_FIELDS) && onlyFields(art, 'ARELITESTOP', ANIM_FIELDS),
    onlyFields(project, 'AutoRankStopWeapon', WEAPON_FIELDS) && onlyFields(project, stop, STOP_FIELDS),
    !value(art, 'ARVETNOP', 'Weapon'), Number(value(art, 'ARVETNOP', 'Damage') || '0') === 0,
    equal(value(art, 'ARELITESTOP', 'Weapon'), 'AutoRankStopWeapon'),
    isTrue(value(art, 'ARELITESTOP', 'Damage.DealtByInvoker')),
    isTrue(value(art, 'ARELITESTOP', 'UseCenterCoordsIfAttached')),
    Number(value(art, 'ARELITESTOP', 'Damage')) > 0,
    equal(value(project, 'AutoRankStopWeapon', 'Warhead'), stop),
    value(project, stop, 'CellSpread') === '0', isFalse(value(project, stop, 'EffectsRequireVerses')),
    isTrue(value(project, stop, 'AffectsOwner')), isFalse(value(project, stop, 'AffectsAllies')),
    isFalse(value(project, stop, 'AffectsEnemies')), verses.length >= 11 && verses.every(item => /^0(?:\.0+)?%?$/.test(item)),
    has(tokens(value(project, stop, 'AttachEffect.RemoveTypes')), 'AutoRankSpawnFirst'),
    has(tokens(value(project, stop, 'AttachEffect.RemoveTypes')), 'AutoRankSpawnSecond'),
  ];
  if (checks.some(item => !item)) throw new Error('检测到此前的自动升星测试配置，但晋升动画或停止弹头已被修改；请先检查，避免覆盖现有功能。');
  return true;
}
function checkGroupUnused(project) {
  for (const entry of project.sections.values()) {
    if (has(tokens(entry.fields.get('groups')?.value), GROUP)) throw new Error(`附加效果组 ${GROUP} 已被 [${entry.name}] 使用，无法安全复用。`);
    if (has(tokens(entry.fields.get('attacheffect.removegroups')?.value), GROUP)) throw new Error(`附加效果组 ${GROUP} 已被 [${entry.name}] 引用，无法安全复用。`);
  }
}
function checkOwnedGroup(project, stop) {
  const owned = new Set();
  for (const field of project.section(PROFILE)?.fields.values() || []) {
    if (!/^MRA\d+$/.test(field.value)) throw new Error('自动升星记录格式无效。');
    const n = namesFor(field.value);
    owned.add(norm(n.First)); owned.add(norm(n.Second));
  }
  for (const entry of project.sections.values()) {
    if (has(tokens(entry.fields.get('groups')?.value), GROUP) && !owned.has(norm(entry.name))) throw new Error(`附加效果组 ${GROUP} 已被 [${entry.name}] 复用，请先检查冲突。`);
    if (has(tokens(entry.fields.get('attacheffect.removegroups')?.value), GROUP) && !equal(entry.name, stop)) throw new Error(`附加效果组 ${GROUP} 已被 [${entry.name}] 移除，请先检查冲突。`);
  }
}
function makeShared(project, art) {
  const existing = project.section(SHARED);
  if (existing) {
    if (value(project, SHARED, 'Format') !== '1') throw new Error(`现有 [${SHARED}] 不是兼容的自动升星配置。`);
    const veteran = value(project, SHARED, 'Veteran'), elite = value(project, SHARED, 'Elite'), stop = value(project, SHARED, 'StopWarhead');
    const stopWeapon = value(art, elite, 'Weapon'), verses = tokens(value(project, stop, 'Verses'));
    const valid = equal(value(project, 'AudioVisual', 'Promote.VeteranAnimation'), veteran)
      && equal(value(project, 'AudioVisual', 'Promote.EliteAnimation'), elite)
      && onlyFields(art, veteran, ANIM_FIELDS) && onlyFields(art, elite, ANIM_FIELDS)
      && onlyFields(project, stopWeapon, WEAPON_FIELDS) && onlyFields(project, stop, STOP_FIELDS)
      && !value(art, veteran, 'Weapon') && Number(value(art, veteran, 'Damage') || '0') === 0
      && isTrue(value(art, elite, 'Damage.DealtByInvoker')) && isTrue(value(art, elite, 'UseCenterCoordsIfAttached'))
      && Number(value(art, elite, 'Damage')) > 0 && equal(value(project, stopWeapon, 'Warhead'), stop)
      && value(project, stop, 'CellSpread') === '0' && isFalse(value(project, stop, 'EffectsRequireVerses'))
      && isTrue(value(project, stop, 'AffectsOwner')) && isFalse(value(project, stop, 'AffectsAllies')) && isFalse(value(project, stop, 'AffectsEnemies'))
      && verses.length >= 11 && verses.every(item => /^0(?:\.0+)?%?$/.test(item))
      && has(tokens(value(project, stop, 'AttachEffect.RemoveGroups')), GROUP)
      && equal(value(art, SPRITE, 'Sequence'), SEQUENCE)
      && Object.entries(sequence).every(([key, val]) => value(art, SEQUENCE, key) === val);
    if (!valid) throw new Error('自动升星共享配置不完整或晋升动画已被修改，请先恢复相关配置。');
    checkOwnedGroup(project, stop);
    return;
  }
  if (project.section(PROFILE)) throw new Error(`现有 [${PROFILE}] 与自动升星配置冲突。`);
  checkGroupUnused(project);
  const veteran = value(project, 'AudioVisual', 'Promote.VeteranAnimation'), elite = value(project, 'AudioVisual', 'Promote.EliteAnimation');
  const legacy = assertLegacyStop(project, art);
  if (!legacy && (veteran || elite)) throw new Error('游戏已设置其他晋升动画；自动升星需要精英晋升动画来停止计时，当前无法安全合并，请先处理现有动画。');
  for (const id of [SHARED, PROFILE, ...(legacy ? [] : [STOP_WEAPON, STOP_WARHEAD])]) if (project.section(id)) throw new Error(`自动升星规则段 [${id}] 已存在。`);
  for (const id of [SEQUENCE, SPRITE, ...(legacy ? [] : [VETERAN, ELITE])]) if (art.section(id)) throw new Error(`自动升星美术规则段 [${id}] 已存在，无法确认是否可以安全复用。`);
  // A registered ID may be in use even if its section is missing.
  const newIds = [SPRITE, SEQUENCE, ...(legacy ? [] : [STOP_WEAPON, STOP_WARHEAD, VETERAN, ELITE])];
  for (const registry of registries) for (const id of newIds) if (has(listTypes(project, registry), id)) throw new Error(`游戏类型列表 [${registry}] 已登记 ${id}，无法安全复用此 ID。`);
  const ruleDefs = [[SHARED, { Format: '1', Veteran: legacy ? 'ARVETNOP' : VETERAN, Elite: legacy ? 'ARELITESTOP' : ELITE, StopWarhead: legacy ? 'AutoRankStopWH' : STOP_WARHEAD }], [PROFILE, {}]];
  if (!legacy) ruleDefs.push([STOP_WEAPON, weapon(STOP_WARHEAD)], [STOP_WARHEAD, { CellSpread: '0', Verses: ZERO, EffectsRequireVerses: 'no', AffectsOwner: 'yes', AffectsAllies: 'no', AffectsEnemies: 'no', 'AttachEffect.RemoveGroups': GROUP }]);
  project.appendGeneratedSections(ruleDefs, project.resolve(project.mainPath));
  const artDefs = [[SEQUENCE, sequence], [SPRITE, { Sequence: SEQUENCE, Crawls: 'no', Remapable: 'no' }]];
  if (!legacy) artDefs.push([VETERAN, { ...animation, Damage: '0' }], [ELITE, { ...animation, UseCenterCoordsIfAttached: 'yes', Damage: '1', Weapon: STOP_WEAPON, 'Damage.DealtByInvoker': 'yes' }]);
  art.appendGeneratedSections(artDefs, art.resolve(art.mainPath));
  if (legacy) {
    const old = tokens(value(project, 'AutoRankStopWH', 'AttachEffect.RemoveGroups'));
    project.set('AutoRankStopWH', 'AttachEffect.RemoveGroups', [...old, GROUP].join(','));
  } else {
    if (!project.section('AudioVisual')) project.createSection('AudioVisual', project.resolve(project.mainPath));
    project.set('AudioVisual', 'Promote.VeteranAnimation', VETERAN);
    project.set('AudioVisual', 'Promote.EliteAnimation', ELITE);
    ensureRegistry(project, 'WeaponTypes', STOP_WEAPON);
    ensureRegistry(project, 'Warheads', STOP_WARHEAD);
    ensureRegistry(project, 'Animations', VETERAN);
    ensureRegistry(project, 'Animations', ELITE);
  }
}
function nextPrefix(project, art) {
  const reserved = new Set();
  for (const registry of [...registries, 'ArmorTypes']) {
    for (const id of listTypes(project, registry)) reserved.add(norm(id));
  }
  for (let n = 1; n <= 999999; n++) {
    const prefix = `MRA${n}`, names = Object.values(namesFor(prefix));
    if (names.every(id => !project.section(id) && !art.section(id) && !reserved.has(norm(id)) && !project.get('ArmorTypes', id))) return prefix;
  }
  throw new Error('无法分配自动升星规则 ID。');
}
function lists(project, section) {
  const rawTypes = value(project, section, 'AttachEffect.AttachTypes');
  if (rawTypes && rawTypes.split(',').some(part => !part.trim())) throw new Error('现有 AttachEffect.AttachTypes 包含空项，请先修正。');
  const types = tokens(rawTypes), arrays = [];
  for (const [key, fallback, own] of ARRAYS) {
    const raw = value(project, section, key), items = raw ? raw.split(',').map(item => item.trim()) : [];
    if (items.some(item => !/^[+-]?\d+$/.test(item) || !Number.isSafeInteger(Number(item)) || Number(item) < -2147483648 || Number(item) > 2147483647)) throw new Error(`现有 ${key} 包含无效值，请先修正。`);
    arrays.push({ key, fallback, own, items });
  }
  return { types, arrays };
}
function writeList(project, section, key, items) {
  if (items.length) project.set(section, key, items.join(','));
  else if (project.get(section, key)) project.remove(section, key);
}
function addTimers(project, section, names) {
  const { types, arrays } = lists(project, section);
  if (has(types, names.First) || has(types, names.Second)) throw new Error('单位已有自动升星计时器，请先检查相关附加效果。');
  if (has(types, 'AutoRankSpawnFirst') || has(types, 'AutoRankSpawnSecond')) throw new Error('此单位仍使用此前的自动升星测试效果，请先移除旧的 AutoRankSpawnFirst/Second 再添加通用功能。');
  const index = types.length;
  for (const entry of arrays) {
    const items = [...entry.items];
    while (items.length < index) items.push(items.at(-1) ?? entry.fallback);
    items.splice(index, 0, entry.own, entry.own);
    writeList(project, section, entry.key, items);
  }
  writeList(project, section, 'AttachEffect.AttachTypes', [...types, names.First, names.Second]);
}
function removeTimers(project, section, names) {
  const { types, arrays } = lists(project, section);
  const indexes = types.map((id, i) => equal(id, names.First) || equal(id, names.Second) ? i : -1).filter(i => i >= 0);
  if (indexes.length !== 2 || !has(types, names.First) || !has(types, names.Second)) throw new Error('单位的自动升星计时器已被修改，无法安全移除。');
  for (const entry of arrays) {
    const items = [...entry.items];
    while (items.length < types.length) items.push(items.at(-1) ?? entry.fallback);
    if (indexes.some(i => items[i] !== entry.own)) throw new Error(`单位的 ${entry.key} 已被修改，无法安全移除自动升星计时器。`);
    for (const i of [...indexes].reverse()) items.splice(i, 1);
    writeList(project, section, entry.key, items);
  }
  for (const i of [...indexes].reverse()) types.splice(i, 1);
  writeList(project, section, 'AttachEffect.AttachTypes', types);
}
function migrateLegacyTimers(project, section) {
  const types = lists(project, section).types;
  if (has(types, 'AutoRankKillFirst') || has(types, 'AutoRankKillSecond')) throw new Error('此单位包含旧版测试的击杀计时器，请先检查并移除旧测试效果。');
  if (!has(types, 'AutoRankSpawnFirst') && !has(types, 'AutoRankSpawnSecond')) return false;
  if (!equal(value(project, SHARED, 'StopWarhead'), 'AutoRankStopWH') || !['AutoRankSpawnFirst', 'AutoRankSpawnSecond'].every(id => equal(value(project, id, 'ExpireWeapon'), 'AutoRankSpawnWeapon') && equal(value(project, id, 'ExpireWeapon.TriggerOn'), 'expire'))) throw new Error('此单位包含无法识别的旧自动升星测试效果，请先检查。');
  removeTimers(project, section, { First: 'AutoRankSpawnFirst', Second: 'AutoRankSpawnSecond' });
  return true;
}
export function autoRankStatus(project, section) {
  const prefix = value(project, PROFILE, section);
  if (!prefix) return null;
  if (!/^MRA\d+$/.test(prefix)) throw new Error('自动升星记录格式无效。');
  const names = namesFor(prefix);
  if (!equal(value(project, names.Meta, 'Target'), section)) throw new Error('自动升星记录与目标对象不匹配。');
  const enabled = value(project, names.Meta, 'Enabled');
  if (!isTrue(enabled) && !isFalse(enabled)) throw new Error('自动升星启用状态无效。');
  return { prefix, names, enabled: isTrue(enabled), interval: value(project, names.Meta, 'Interval') };
}
function addProfile(project, art, section, prefix, interval, costs) {
  const n = namesFor(prefix);
  const helper = { UIName: `NOSTR:Auto Rank Helper for ${section}`, Name: `Auto Rank Helper for ${section}`, Image: SPRITE, Category: 'Soldier', Strength: '1', Armor: n.Armor, TechLevel: '-1', Sight: '0', Speed: '0', Owner: 'Neutral', Cost: costs.helperCost, Soylent: '0', Points: '0', ThreatPosed: '0', Locomotor: '{4A582744-9839-11d1-B709-00A024DDAFD1}', MovementZone: 'Infantry', PhysicalSize: '1', Size: '1', Fearless: 'yes', Crushable: 'no', Selectable: 'no', LegalTarget: 'no', Trainable: 'no', Insignificant: 'no', DontScore: 'no', Bounty: 'no', 'AutoDeath.Behavior': 'vanish', 'AutoDeath.AfterDelay': '90', AllowedToStartInMultiplayer: 'no' };
  const defs = [
    [n.Meta, { Target: section, Enabled: 'yes', Interval: interval, Cost: costs.cost, VeteranRatio: costs.ratio }],
    [n.First, { Duration: interval, ExpireWeapon: n.SpawnW, 'ExpireWeapon.TriggerOn': 'expire', Groups: GROUP }],
    [n.Second, { Duration: interval * 2, ExpireWeapon: n.SpawnW, 'ExpireWeapon.TriggerOn': 'expire', Groups: GROUP }],
    [n.SpawnW, weapon(n.SpawnH)],
    [n.SpawnH, { Verses: ZERO, AnimList: n.SpawnA, CreateAnimsOnZeroDamage: 'yes' }],
    [n.KillW, { ...weapon(n.KillH), Damage: '100' }],
    [n.KillH, { CellSpread: '1', PercentAtMax: '1', Verses: ZERO, [`Versus.${n.Armor}`]: '100%', AffectsOwner: 'no', AffectsAllies: 'no', PreventScatter: 'yes', InfDeath: '0' }],
    [n.Helper, helper],
  ];
  project.appendGeneratedSections(defs, project.resolve(project.mainPath));
  art.appendGeneratedSections([
    [n.SpawnA, { ...animation, CreateUnit: n.Helper, 'CreateUnit.Owner': 'Neutral', 'CreateUnit.AlwaysSpawnOnGround': 'yes', 'CreateUnit.ConsiderPathfinding': 'yes', 'CreateUnit.SpawnAnim': n.KillA }],
    [n.KillA, { ...animation, Damage: '100', Weapon: n.KillW, 'Damage.DealtByInvoker': 'yes' }],
  ], art.resolve(art.mainPath));
  for (const [registry, id] of [['InfantryTypes', n.Helper], ['AttachEffectTypes', n.First], ['AttachEffectTypes', n.Second], ['WeaponTypes', n.SpawnW], ['WeaponTypes', n.KillW], ['Warheads', n.SpawnH], ['Warheads', n.KillH], ['Animations', n.SpawnA], ['Animations', n.KillA]]) ensureRegistry(project, registry, id);
  if (!project.section('ArmorTypes')) project.createSection('ArmorTypes', project.resolve(project.mainPath));
  project.set('ArmorTypes', n.Armor, '0%');
  project.set(PROFILE, section, prefix);
  return n;
}
function assertProfile(project, art, n) {
  const zeros = section => {
    const verses = tokens(value(project, section, 'Verses'));
    return verses.length >= 11 && verses.every(item => /^0(?:\.0+)?%?$/.test(item));
  };
  const timers = [n.First, n.Second].every(id => has(tokens(value(project, id, 'Groups')), GROUP)
    && equal(value(project, id, 'ExpireWeapon'), n.SpawnW) && equal(value(project, id, 'ExpireWeapon.TriggerOn'), 'expire'));
  const valid = timers && equal(value(project, n.Helper, 'Image'), SPRITE) && equal(value(project, n.Helper, 'Armor'), n.Armor)
    && value(project, 'ArmorTypes', n.Armor) === '0%'
    && equal(value(project, n.SpawnW, 'Warhead'), n.SpawnH) && equal(value(project, n.SpawnH, 'AnimList'), n.SpawnA)
    && zeros(n.SpawnH) && isTrue(value(project, n.SpawnH, 'CreateAnimsOnZeroDamage'))
    && equal(value(art, n.SpawnA, 'CreateUnit'), n.Helper) && equal(value(art, n.SpawnA, 'CreateUnit.SpawnAnim'), n.KillA)
    && equal(value(art, n.KillA, 'Weapon'), n.KillW) && isTrue(value(art, n.KillA, 'Damage.DealtByInvoker'))
    && equal(value(project, n.KillW, 'Warhead'), n.KillH) && zeros(n.KillH)
    && value(project, n.KillH, `Versus.${n.Armor}`) === '100%'
    && isFalse(value(project, n.KillH, 'AffectsOwner')) && isFalse(value(project, n.KillH, 'AffectsAllies'));
  if (!valid) throw new Error('该对象生成的自动升星规则已被修改或缺失，请先检查相关规则。');
}
function changedSince(before, candidate) {
  const identity = change => `${norm(change.file.path)}\0${norm(change.section)}\0${norm(change.key || '')}\0${change.kind === 'section' ? 'section' : 'field'}`;
  const previous = new Map(before.changes().map(change => [identity(change), change]));
  const current = new Map(candidate.changes().map(change => [identity(change), change]));
  const result = [];
  for (const [id, change] of current) {
    const old = previous.get(id);
    if (old && old.after === change.after && old.kind === change.kind) continue;
    result.push({ ...change, before: old ? old.after : change.before });
  }
  // A preview can also undo an unsaved edit, making it disappear from changes().
  for (const [id, old] of previous) if (!current.has(id) && old.kind !== 'section') {
    const file = candidate.files.find(item => norm(item.path) === norm(old.file.path));
    result.push({ ...old, file, before: old.after, after: old.before, kind: old.before === null ? 'remove' : undefined });
  }
  return result;
}
export function prepareAutoRank(project, { type, section, action = 'enable', interval = '300', spriteBytes }) {
  if (!TYPE_LISTS[type] || !project.section(section) || !has(listTypes(project, TYPE_LISTS[type]), section)) throw new Error('请在规则主文件中选择已注册的步兵、载具、飞机或建筑。');
  if (project.warnings.length) throw new Error(`规则加载不完整：${project.warnings[0]}`);
  if (!['enable', 'disable'].includes(action)) throw new Error('请选择启用或停用自动升星。');
  const old = autoRankStatus(project, section);
  if (action === 'disable' && !old?.enabled) throw new Error('此对象没有启用由编辑器管理的自动升星。');
  const frames = action === 'enable' ? positiveInteger(String(interval).trim(), '等待帧数', 1073741823) : 0;
  const costs = action === 'enable' ? rankCost(project, section) : null;
  if (action === 'enable' && !project.section('Invisible')) throw new Error('缺少生成效果所需的 [Invisible] 投射物，请检查规则是否完整。');
  if (action === 'enable' && !isTransparentRankSprite(spriteBytes)) throw new Error('未找到完整透明的 INVISOX.SHP；请导入心灵终结完整游戏目录，或检查同名松散文件。');
  const candidate = project.fork(), art = artProject(candidate);
  if (action === 'enable') makeShared(candidate, art);
  const migrated = action === 'enable' && migrateLegacyTimers(candidate, section);
  let status = autoRankStatus(candidate, section), names;
  if (action === 'disable') {
    removeTimers(candidate, section, status.names);
    candidate.set(status.names.Meta, 'Enabled', 'no');
  } else if (status) {
    names = status.names;
    assertProfile(candidate, art, names);
    if (!status.enabled) addTimers(candidate, section, names);
    else {
      const existing = lists(candidate, section);
      const indexes = [names.First, names.Second].map(id => existing.types.findIndex(item => equal(item, id)));
      if (indexes.some(index => index < 0) || existing.types.filter(id => equal(id, names.First) || equal(id, names.Second)).length !== 2 || existing.arrays.some(entry => indexes.some(i => (entry.items[i] ?? entry.items.at(-1) ?? entry.fallback) !== entry.own))) throw new Error('此对象的自动升星附加效果已被修改，请先检查。');
    }
    for (const [id, key, next] of [[names.First, 'Duration', frames], [names.Second, 'Duration', frames * 2], [names.Helper, 'Cost', costs.helperCost], [names.Meta, 'Interval', frames], [names.Meta, 'Cost', costs.cost], [names.Meta, 'VeteranRatio', costs.ratio], [names.Meta, 'Enabled', 'yes']]) candidate.set(id, key, String(next));
  } else {
    const prefix = nextPrefix(candidate, art);
    names = addProfile(candidate, art, section, prefix, frames, costs);
    addTimers(candidate, section, names);
  }
  if (action === 'enable') candidate.set(section, 'Trainable', 'yes');
  candidate.rebuild();
  const warnings = action === 'disable' ? ['停用仅移除该单位的计时效果；为避免影响其他单位，共享规则和辅助对象保留在文件中，Trainable 也保持当前值。'] : [
    '需要 Ares 与 Phobos 0.4.0.2；首次启用会设置全局晋升动画。已有其他晋升动画时无法安全自动合并。',
    `每隔 ${frames} 游戏帧尝试一次，共两次；进入载具或驻军时暂停，出来后继续。满级时会移除剩余计时器。`,
    `辅助对象的名义造价为 ${costs.helperCost}（单位 Cost × VeteranRatio 向上取整）；玩家造价修正、已有经验或特殊经验归属可能改变实际晋升结果。`,
    '不同单位类型使用独立护甲以减少抢经验；同类型单位在极近距离同时触发仍可能抢到经验。中立方或与中立方结盟时可能无法获得经验。',
    '初始即为精英、晋升瞬间已有生成动画、空间不足、单位类型转换或其他规则干预时，停止或晋升效果可能与常规情况不同。',
  ];
  if (migrated) warnings.unshift('已将此对象此前的自动升星测试计时器替换为通用配置；其他对象的测试配置保持原样。');
  return { project: candidate, changes: changedSince(project, candidate), warnings, feature: { label: action === 'disable' ? '停用自动升星' : '自动升星' }, artPath: art.mainPath };
}

// Do not silently save stale helper costs after a user edits cost or the global ratio.
export function autoRankDrift(project) {
  const problems = [];
  for (const field of project.section(PROFILE)?.fields.values() || []) {
    try {
      const status = autoRankStatus(project, field.name);
      if (!status?.enabled) continue;
      const current = lists(project, field.name), ids = [status.names.First, status.names.Second];
      const indexes = ids.map(id => current.types.findIndex(item => equal(item, id)));
      if (!isTrue(value(project, field.name, 'Trainable')) || indexes.some(i => i < 0)
          || current.types.filter(id => has(ids, id)).length !== 2
          || current.arrays.some(entry => indexes.some(i => (entry.items[i] ?? entry.items.at(-1) ?? entry.fallback) !== entry.own))) {
        problems.push(`[${field.name}] 的自动升星附加效果或 Trainable 已被修改，请检查或重新配置。`);
        continue;
      }
      const costs = rankCost(project, field.name);
      if (value(project, status.names.Meta, 'Cost') !== String(costs.cost) || Number(value(project, status.names.Meta, 'VeteranRatio')) !== Number(costs.ratio) || value(project, status.names.Helper, 'Cost') !== String(costs.helperCost)) problems.push(`[${field.name}] 的造价或 VeteranRatio 已变化，请重新打开自动升星并确认。`);
    } catch (error) { problems.push(`[${field.name}]：${error.message}`); }
  }
  return problems;
}

export function autoRankArtPath(project) {
  return project.section(SHARED) ? artProject(project).mainPath : '';
}
