import { listTypes } from './ini.js';
import { STANDARD_ARMORS } from './rule-schema.js';
import { usesIvanBomb, weaponWarheadReferences } from './weapon-references.js';
import { extraWarheadRows } from './phobos-warheads.js';

const norm = value => String(value ?? '').trim().toLowerCase();
const items = value => String(value ?? '').split(',').map(item => item.trim()).filter(item => item && !/^(?:none|<none>)$/i.test(item));
const has = (values, value) => values.some(item => norm(item) === norm(value));
const raw = (project, section, key) => project.get(section, key)?.value?.trim() || '';
const unitRegistries = { infantry: 'InfantryTypes', vehicle: 'VehicleTypes', aircraft: 'AircraftTypes', building: 'BuildingTypes' };
const genericNames = { power: 'Power', factory: 'Factory', barracks: 'Barracks', radar: 'Radar', tech: 'Tech', proc: 'Proc' };

function requirement(project, id, buildings) {
  // Ares resolves a registered building before looking for a generic group.
  if (buildings.has(norm(id))) return { id, options: [id], kind: 'object', source: '', unresolved: !project.section(id) };
  const generic = project.get('GenericPrerequisites', id);
  const standard = genericNames[norm(id)];
  const name = standard || id.charAt(0).toUpperCase() + id.slice(1).toLowerCase();
  const fallback = generic || standard ? project.get('General', `Prerequisite${name}`) : null;
  const group = generic?.value.trim() ? generic : fallback;
  if (!group) {
    const alternate = generic || standard ? project.get('General', `Prerequisite${name}Alternate`) : null;
    if (generic || standard) return { id, options: items(alternate?.value), kind: 'group', source: `[General]Prerequisite${name} 未加载`, alternate: alternate?.value || '', unresolved: true };
    return { id, options: [id], kind: 'object', source: '', unresolved: true };
  }
  const alternate = project.get('General', `Prerequisite${name}Alternate`);
  const groupValues = items(group.value), unresolved = groupValues.some(value => !buildings.has(norm(value)) || !project.section(value));
  return { id, options: [...groupValues, ...items(alternate?.value)], kind: 'group', source: `[${group === generic ? 'GenericPrerequisites' : 'General'}]${group.name}`, alternate: alternate?.value || '', unresolved };
}

// The supplied inventory is a hypothetical snapshot, not a game-state reader.
export function analyzeConstruction(project, { id, type, country = '', techLevel = '', inventory = null }) {
  if (!project.section(id) || !unitRegistries[type]) throw new Error('请选择已定义的单位或建筑。');
  const checks = [];
  const add = (status, label, detail) => checks.push({ status, label, detail });
  const registered = has(listTypes(project, unitRegistries[type]), id);
  add(registered ? 'ok' : 'warn', '类型登记', registered ? `已登记在 [${unitRegistries[type]}]。` : `未在已加载的 [${unitRegistries[type]}] 中找到；实际登记还可能来自其他规则。`);
  const owner = items(raw(project, id, 'Owner'));
  const required = items(raw(project, id, 'RequiredHouses'));
  const forbidden = items(raw(project, id, 'ForbiddenHouses'));
  for (const [key, list] of [['Owner', owner], ['RequiredHouses', required], ['ForbiddenHouses', forbidden]]) {
    const value = raw(project, id, key);
    if (!country) add('unknown', key, value || '未配置；请选择国家后检查。');
    else if (!value) add('unknown', key, '未配置；需要结合游戏默认值及其他规则判断。');
    else {
      const matches = has(list, country), conflict = key === 'ForbiddenHouses' ? matches : !matches;
      add(conflict ? 'warn' : 'ok', key, `${value}；所选国家 ${country} ${matches ? '在列表中' : '不在列表中'}。`);
    }
  }
  const level = raw(project, id, 'TechLevel'), numericLevel = /^[+-]?\d+$/.test(level) ? Number(level) : null;
  const selectedLevel = /^\d+$/.test(String(techLevel)) ? Number(techLevel) : null;
  if (numericLevel === null) add('unknown', '科技等级 / TechLevel', level ? `无法识别数值：${level}。` : '未配置；无法确认游戏默认值。');
  else if (numericLevel < 0) add('warn', '科技等级 / TechLevel', `配置为 ${numericLevel}；通常不在普通建造菜单中提供，仍需结合其他规则检查。`);
  else if (selectedLevel === null) add('unknown', '科技等级 / TechLevel', `需要检查的配置值为 ${numericLevel}；请选择对局科技等级。`);
  else add(numericLevel > selectedLevel ? 'warn' : 'ok', '科技等级 / TechLevel', `对象为 ${numericLevel}，选择的对局等级为 ${selectedLevel}。`);
  const buildLimit = raw(project, id, 'BuildLimit');
  if (buildLimit) add('unknown', '建造数量上限 / BuildLimit', `配置为 ${buildLimit}；还需检查对局中已有数量、累计建造和生产队列。`);

  const list0Field = project.get(id, 'Prerequisite.List0');
  // An empty List0 is ignored by Ares' ReadString and leaves Prerequisite intact.
  const list0 = list0Field?.value.trim() ? list0Field : null;
  const listCountRaw = raw(project, id, 'Prerequisite.Lists');
  const count = /^\d+$/.test(listCountRaw) ? Math.min(Number(listCountRaw), 100) : 0;
  if (listCountRaw && !/^\d+$/.test(listCountRaw)) add('unknown', '备用前置组', `Prerequisite.Lists=${listCountRaw} 无法识别，未推断额外组数。`);
  if (/^\d+$/.test(listCountRaw) && Number(listCountRaw) > 100) add('unknown', '备用前置组', '额外前置组超过 100 组，未继续展开。');
  const buildings = new Set(listTypes(project, 'BuildingTypes').map(norm));
  const prerequisiteLists = [{ key: list0 ? 'Prerequisite.List0' : 'Prerequisite', value: list0 ? list0.value : raw(project, id, 'Prerequisite') }];
  for (let i = 1; i <= count; i++) prerequisiteLists.push({ key: `Prerequisite.List${i}`, value: raw(project, id, `Prerequisite.List${i}`) });
  for (const list of prerequisiteLists) {
    list.requirements = items(list.value).map(value => requirement(project, value, buildings));
    list.status = inventory === null ? 'unknown' : list.requirements.every(req => req.options.some(value => has(inventory, value))) ? 'ok' : 'warn';
    if (inventory !== null && list.requirements.some(req => req.unresolved || (req.kind === 'group' && !req.options.length))) list.status = 'unknown';
  }
  const factoryType = { infantry: 'InfantryType', vehicle: 'UnitType', aircraft: 'AircraftType', building: 'BuildingType' }[type];
  const factories = listTypes(project, 'BuildingTypes').filter(building => norm(raw(project, building, 'Factory')) === norm(factoryType)).map(building => ({
    id: building, explicitOnly: /^(?:yes|true|1)$/i.test(raw(project, building, 'Factory.ExplicitOnly')),
  }));
  const extra = ['PrerequisiteOverride', 'Prerequisite.Negative', 'Prerequisite.StolenTechs', 'Prerequisite.RequiredTheaters', 'FactoryOwners', 'FactoryOwners.Forbidden', 'BuiltAt', 'Naval', 'BuildCat'];
  const extraFields = extra.map(key => ({ key, value: raw(project, id, key) })).filter(field => field.value);
  return { id, type, country, techLevel, checks, prerequisiteLists, factories, extraFields, incomplete: [...project.warnings] };
}

const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i;
function multiplier(value) {
  const text = String(value ?? '').trim();
  if (!numberPattern.test(text)) return null;
  const number = Number(text.endsWith('%') ? text.slice(0, -1) : text);
  return Number.isFinite(number) ? number / (text.endsWith('%') ? 100 : 1) : null;
}

export function armorMultiplier(project, warhead, armor) {
  if (!warhead || !project.section(warhead)) return { value: null, reason: '弹头未定义', path: [] };
  if (!armor) return { value: null, reason: '目标装甲未配置', path: [] };
  // Ares initializes inherited armor defaults before applying each warhead's
  // Versus.* overrides. A parent's override therefore does not propagate.
  const explicit = project.get(warhead, `Versus.${armor}`);
  if (explicit?.value.trim()) {
    const path = [`[${warhead}]${explicit.name}=${explicit.value}`], value = multiplier(explicit.value);
    return value === null ? { value, reason: '装甲修正无法识别', path } : { value, reason: '', path };
  }
  const seen = new Set(), path = [];
  const order = [...(project.section('ArmorTypes')?.fields.keys() || [])];
  let uncertainOrder = false;
  const resolved = value => uncertainOrder ? { value: null, reason: '装甲引用了后定义的扩展装甲，加载顺序需要确认', path } : { value, reason: '', path };
  let current = armor;
  while (current) {
    if (seen.has(norm(current))) return { value: null, reason: '装甲继承存在循环', path };
    seen.add(norm(current));
    const index = STANDARD_ARMORS.findIndex(item => norm(item.id) === norm(current));
    if (index >= 0) {
      const verses = project.get(warhead, 'Verses');
      const parts = verses?.value.split(',') || [];
      if (parts.some(part => !part.trim())) {
        path.push(`[${warhead}]Verses=${verses.value}`);
        return { value: null, reason: 'Verses 包含空项，装甲位置需要确认', path };
      }
      const valueText = parts[index]?.trim() || '';
      path.push(`[${warhead}]Verses 第 ${index + 1} 项（${current}）=${valueText || '未配置'}`);
      const value = multiplier(valueText);
      return value === null ? { value, reason: '未找到可确认的基础装甲修正', path } : resolved(value);
    }
    const base = project.get('ArmorTypes', current);
    if (!base) return { value: null, reason: `未找到装甲 ${current} 的定义`, path };
    path.push(`[ArmorTypes]${base.name}=${base.value}`);
    const value = multiplier(base.value);
    if (value !== null) return resolved(value);
    if (!base.value.trim()) return { value: null, reason: '装甲默认修正为空', path };
    const sourceIndex = order.indexOf(norm(current)), parentIndex = order.indexOf(norm(base.value));
    if (sourceIndex >= 0 && parentIndex >= sourceIndex && parentIndex >= 0) uncertainOrder = true;
    current = base.value.trim();
  }
  return { value: null, reason: '未找到装甲修正', path };
}

function effectStage(project, label, weapon, warhead, damage, armor, source) {
  const modifier = armorMultiplier(project, warhead, armor);
  const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(damage) ? Number(damage) : null;
  return { label, weapon, warhead, damage, source, modifier, product: number !== null && Number.isFinite(number) && modifier.value !== null ? number * modifier.value : null };
}

export function analyzeWeaponEffect(project, weapon, target) {
  if (!project.section(weapon)) throw new Error('请选择已定义的武器。');
  if (!project.section(target)) throw new Error('请选择已定义的目标。');
  const armor = raw(project, target, 'Armor');
  const direct = raw(project, weapon, 'Warhead');
  const stages = [effectStage(project, '直接命中', weapon, direct, raw(project, weapon, 'Damage'), armor, `[${weapon}]Damage`)];
  const bombRef = weaponWarheadReferences(project, weapon).find(ref => ref.key === 'IvanBomb.Warhead');
  const bombEnabled = usesIvanBomb(project, weapon);
  if (bombRef || bombEnabled) {
    const damage = project.get(weapon, 'IvanBomb.Damage')?.value.trim() || raw(project, 'CombatDamage', 'IvanDamage');
    const source = project.get(weapon, 'IvanBomb.Damage')?.value.trim() ? `[${weapon}]IvanBomb.Damage` : '[CombatDamage]IvanDamage';
    const stage = effectStage(project, '附着炸弹爆炸', weapon, bombRef?.id || '', damage, armor, source);
    stage.enabled = bombEnabled;
    stage.warheadSource = bombRef?.source === 'global' ? '[CombatDamage]IvanWarhead' : `[${weapon}]IvanBomb.Warhead`;
    stage.delay = raw(project, weapon, 'IvanBomb.Delay') || raw(project, 'CombatDamage', 'IvanTimedDelay');
    stages.push(stage);
  }
  for (const [index, item] of extraWarheadRows(project, weapon).entries()) {
    if (!item.id || /^(?:none|<none>)$/i.test(item.id)) continue;
    const damage = item.damage || raw(project, weapon, 'Damage');
    const stage = effectStage(project, `额外弹头 ${index + 1}`, weapon, item.id, damage, armor,
      item.damage ? `[${weapon}]ExtraWarheads.DamageOverrides` : `[${weapon}]Damage（额外弹头默认）`);
    stage.chance = item.chance || '100%（默认）';
    stages.push(stage);
  }
  const limitations = [];
  if (raw(project, target, 'ShieldType')) limitations.push(`目标设置了护盾 ${raw(project, target, 'ShieldType')}；以下只按本体装甲计算，不反映护盾吸收或穿透。`);
  if ([direct, ...extraWarheadRows(project, weapon).map(item => item.id)].some(id => raw(project, id, 'Crit.Chance'))) limitations.push('部分弹头设置了暴击；暴击伤害和触发概率未计入数值乘积。');
  if (raw(project, weapon, 'ExtraWarheads')) limitations.push('额外弹头需要对应武器触发，概率和其他游戏条件可能使其不生效。');
  const projectile = raw(project, weapon, 'Projectile');
  const projectileFields = ['AA', 'AG', 'AN', 'AS', 'ASW'].map(key => ({ key, value: raw(project, projectile, key) })).filter(field => field.value);
  const specialKeys = ['IsSonic', 'UseFireParticles', 'ApplyDamage', 'AmbientDamage', 'RadLevel', 'IsRailgun', 'AreaFire', 'Temporal', 'Parasite'];
  const specialFields = specialKeys.map(key => ({ key, value: raw(project, weapon, key) })).filter(field => field.value);
  const targeting = ['ForceFire', 'Retaliate', 'PassiveAcquire'].map(key => ({ key, value: raw(project, direct, `Versus.${armor}.${key}`) })).filter(field => field.value);
  return { weapon, target, armor, projectile, projectileFields, stages, specialFields, targeting, limitations, incomplete: [...project.warnings] };
}
