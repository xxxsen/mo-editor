import { listTypes } from './ini.js';
import { getFieldInfo } from './field-metadata.js';

export const STANDARD_ARMORS = [
  ['none', '无装甲'], ['flak', '防弹装甲'], ['plate', '板甲'], ['light', '轻型装甲'], ['medium', '中型装甲'], ['heavy', '重型装甲'],
  ['wood', '木质装甲'], ['steel', '钢制装甲'], ['concrete', '混凝土装甲'], ['special_1', '特殊装甲 1'], ['special_2', '特殊装甲 2'],
].map(([id, label]) => ({ id, label }));

export const GLOBAL_SECTIONS = [
  ['General', '常规设置', '建造、维修、升级、资源与其他通用规则'],
  ['CombatDamage', '战斗与伤害', '伤害、爆炸及战斗效果的全局参数'],
  ['MultiplayerDialogSettings', '遭遇战默认设置', '初始资金、单位数及对局选项的默认值'],
  ['AI', '电脑行为', '电脑建造、进攻与防御设置'], ['IQ', '电脑智能等级', '各项自动行为对应的智能等级'],
  ['Easy', '简单难度', '简单难度的全局倍率与行为'], ['Normal', '普通难度', '普通难度的全局倍率与行为'],
  ['Difficult', '困难难度', '困难难度的全局倍率与行为'], ['CrateRules', '箱子规则', '随机箱子的生成与全局设置'],
  ['Powerups', '箱子奖励', '各类箱子奖励的参数'], ['Radiation', '辐射设置', '辐射持续、强度和表现'],
  ['SpecialWeapons', '特殊武器', '特殊武器引用的全局参数'], ['GenericPrerequisites', '通用建造条件', '建造条件与建筑组的对应关系'],
  ['Maximums', '数量上限', '全局数量限制'], ['AudioVisual', '声音与画面', '全局音效、动画与画面设置'],
  ['JumpjetControls', '飞行控制', '喷气飞行单位的默认控制参数'], ['ElevationModel', '高低地形', '地形高度相关设置'],
  ['WallModel', '围墙设置', '围墙相关设置'], ['GlobalControls', '扩展全局设置', '扩展引擎的全局开关'],
  ['MouseCursors', '鼠标指针', '鼠标指针的全局定义'], ['Colors', '颜色', '颜色列表'], ['ColorAdd', '颜色增量', '颜色增量定义'],
  ['TunnelTypes', '隧道类型', '隧道类型列表'], ['ArmorTypes', '扩展装甲类型', '自定义装甲及其默认继承关系'],
  ['Sides', '阵营与所属方', '阵营与国家的对应关系'], ['Countries', '国家列表', '已注册的国家与所属方'],
  ['Tiberiums', '矿石类型', '矿石类型列表'],
].map(([id, label, description]) => ({ id, label, description }));

const key = value => String(value ?? '').trim().toLowerCase();

export function globalFieldInfo(section, fieldName, globalKind = '') {
  return getFieldInfo(fieldName, { type: 'global', section, globalKind });
}

const entries = value => String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
const MO_COUNTRY_NAMES = { unitedstates: '美国', europeans: '欧洲联盟', pacific: '太平洋阵线', ussr: '苏俄', latin: '拉丁同盟', chinese: '中国', psicorps: '心灵军团', scorpioncell: '天蝎组织', headquaters: '总部守卫', guild1: '狂鲨先锋', guild2: '科洛尼亚侧翼', guild3: '最后堡垒', neutral: '中立', special: '特殊' };
const localized = (project, strings, id) => {
  const uiName = project.get(id, 'UIName')?.value;
  return strings?.get(key(uiName)) || project.get(id, 'Name')?.value || id;
};
function uniqueOptions(options) {
  const result = new Map();
  for (const option of options) if (option.id && !result.has(key(option.id))) result.set(key(option.id), option);
  return [...result.values()];
}

export function countriesFor(project, strings, current = '', fallbackOwners = [], clientSides = []) {
  const sideOf = new Map();
  const sides = project.section('Sides');
  for (const side of sides?.fields.values() || []) for (const id of entries(side.value)) if (!sideOf.has(key(id))) sideOf.set(key(id), { id, side: side.name });
  const mo = /mental omega/i.test(project.get('General', 'Name')?.value || '');
  const labels = { gdi: '盟军', nod: '苏联', thirdside: '厄普西隆', fourthside: '焚风', civilian: '平民', mutant: '特殊' };
  const ids = [...listTypes(project, 'Countries'), ...[...sideOf.values()].map(item => item.id), ...fallbackOwners];
  const choices = uniqueOptions(ids.map(id => {
    const side = sideOf.get(key(id))?.side;
    const group = side ? (mo && labels[key(side)] ? `${labels[key(side)]} · ${side}` : `阵营 ${side}`) : '其他所属方';
    const uiName = project.get(id, 'UIName')?.value;
    const index = project.get(id, 'ListIndex')?.value;
    const fromClient = index !== undefined && /^\d+$/.test(index) ? clientSides[Number(index)] : null;
    const label = strings?.get(key(uiName)) || fromClient || (mo ? MO_COUNTRY_NAMES[key(id)] : null) || localized(project, strings, id);
    return { id, label, group, side: side || '' };
  }));
  const seen = new Set(choices.map(option => key(option.id)));
  for (const id of entries(current)) if (!seen.has(key(id))) { choices.push({ id, label: id, group: '当前未登记的代码' }); seen.add(key(id)); }
  return choices;
}

export function armorsFor(project, current = '') {
  const base = STANDARD_ARMORS.map(item => ({ ...item, group: '基础装甲' }));
  const extra = [...(project.section('ArmorTypes')?.fields.values() || [])].map(field => ({ id: field.name, label: field.name, group: '扩展装甲', hint: `默认：${field.value || '未设置'}` }));
  const choices = uniqueOptions([...base, ...extra]);
  if (current && !choices.some(item => key(item.id) === key(current))) choices.push({ id: current, label: current, group: '当前未登记的代码' });
  return choices;
}

export function sidesFor(project, current = '') {
  const mo = /mental omega/i.test(project.get('General', 'Name')?.value || '');
  const labels = { gdi: '盟军', nod: '苏联', thirdside: '厄普西隆', fourthside: '焚风', civilian: '平民', mutant: '特殊' };
  const choices = [...(project.section('Sides')?.fields.values() || [])].map(field => ({ id: field.name, label: mo && labels[key(field.name)] ? labels[key(field.name)] : field.name, group: '已注册阵营' }));
  if (current && !choices.some(item => key(item.id) === key(current))) choices.push({ id: current, label: current, group: '当前未登记的代码' });
  return choices;
}

export function prerequisitesFor(project, strings, current = '') {
  const generic = [...(project.section('GenericPrerequisites')?.fields.values() || [])].map(field => ({ id: field.name, label: field.name, group: '通用建造条件', hint: field.value }));
  const buildings = listTypes(project, 'BuildingTypes').map(id => ({ id, label: localized(project, strings, id), group: '建筑' }));
  const choices = uniqueOptions([...generic, ...buildings]);
  const seen = new Set(choices.map(item => key(item.id)));
  for (const id of entries(current)) if (!seen.has(key(id))) { choices.push({ id, label: id, group: '当前未登记的代码' }); seen.add(key(id)); }
  return choices;
}

// Preserve untouched list members, their whitespace, duplicates and unknown codes.
export function mergeSelections(raw, selected) {
  const original = String(raw ?? '');
  const values = original ? original.split(',') : [];
  const wanted = new Map(selected.map(id => [key(id), id]));
  const originalKeys = new Set(values.map(key).filter(Boolean));
  if (originalKeys.size === wanted.size && [...originalKeys].every(id => wanted.has(id))) return original;
  const kept = values.filter(value => !key(value) || wanted.has(key(value)));
  const keptKeys = new Set(kept.map(key).filter(Boolean));
  for (const [id, value] of wanted) if (!keptKeys.has(id)) kept.push(value);
  return kept.join(',');
}

export function updateVerses(raw, index, value) {
  const input = String(value).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?$/.test(input)) throw new Error('请输入数值，例如 80% 或 0.8。');
  const original = String(raw ?? '');
  const values = original ? original.split(',') : [];
  if (index > values.length) throw new Error('前面的装甲项尚未定义，请按顺序添加。');
  if (index === values.length) values.push(input);
  else {
    const match = values[index].match(/^(\s*)(.*?)(\s*)$/s);
    values[index] = `${match[1]}${input}${match[3]}`;
  }
  return values.join(',');
}
