import { enumChoices } from './enum-options.js';

// Each feature lists only fields it can edit; optional unset fields remain unset.
// https://ares-developers.github.io/Ares-docs/new/passengers.html
// https://ares-developers.github.io/Ares-docs/new/manual.html
export const QUICK_FEATURES = [
  {
    id: 'transport', label: '载具运输与车内开火', types: ['vehicle'],
    description: '设置载具的乘员容量、体型限制和车内开火。乘员的 Size、武器及其他限制仍会影响实际效果。',
    fields: [
      { key: 'Passengers', type: 'integer', suggested: '5', required: true },
      { key: 'SizeLimit', type: 'integer', suggested: '2', required: true },
      { key: 'PipScale', type: 'pipScale', suggested: 'Passengers', required: true },
      { key: 'OpenTopped', type: 'boolean', suggested: 'yes', required: true },
      { key: 'NoManualEnter', type: 'boolean' },
      { key: 'NoManualUnload', type: 'boolean' },
      { key: 'Passengers.BySize', type: 'boolean' },
      { key: 'Selectable', type: 'boolean' },
    ],
  },
  {
    id: 'garrison', label: '建筑驻军', types: ['building'],
    description: '设置建筑是否允许步兵驻守及驻军开火；步兵本身的驻军能力和武器等条件仍然生效。',
    fields: [
      { key: 'CanBeOccupied', type: 'boolean', suggested: 'yes', required: true },
      { key: 'MaxNumberOccupants', type: 'integer', suggested: '5', required: true },
      { key: 'CanOccupyFire', type: 'boolean', suggested: 'yes', required: true },
      { key: 'Selectable', type: 'boolean' },
      { key: 'Sight', type: 'integer' },
    ],
  },
];

const normalize = value => String(value ?? '').trim().toLowerCase();
const enabled = value => /^(yes|true|1)$/i.test(String(value ?? '').trim());
const disabled = value => /^(no|false|0)$/i.test(String(value ?? '').trim());

export function quickFeaturesFor(type) { return QUICK_FEATURES.filter(feature => feature.types.includes(type)); }

export function quickFeatureFields(project, section, feature) {
  if (!project.section(section)) throw new Error(`找不到规则段 [${section}]。`);
  return feature.fields.map(field => {
    const current = project.get(section, field.key);
    return { ...field, current, value: current ? current.value : field.suggested || '' };
  });
}

function warningsFor(project, section, feature, values) {
  const current = key => values[key] ?? project.get(section, key)?.value ?? '';
  const warnings = [];
  if (project.warnings.length) warnings.push(`规则加载不完整，预览仅依据已加载的内容：${project.warnings[0]}`);
  if (feature.id === 'transport') {
    if (Number(current('Passengers')) === 0) warnings.push('Passengers=0 时没有可用的乘员容量。');
    if (Number(current('SizeLimit')) === 0) warnings.push('SizeLimit=0 可能不允许普通步兵进入；请对照步兵的 Size。');
    if (disabled(current('OpenTopped'))) warnings.push('OpenTopped 已关闭，乘员不能通过此选项在车内开火。');
    if (normalize(current('PipScale')) !== 'passengers') warnings.push('PipScale 当前不是 Passengers，乘员数量可能不会按运输栏显示。');
    if (enabled(current('NoManualEnter'))) warnings.push('NoManualEnter 已启用，玩家不会看到手动进入运输工具的指针。');
    if (enabled(current('NoManualUnload'))) warnings.push('NoManualUnload 已启用，玩家不能手动卸载乘员。');
    if (disabled(current('Selectable'))) warnings.push('Selectable 已关闭，玩家可能无法选中载具并手动卸载乘员。');
    if (enabled(current('Gunner'))) warnings.push('Gunner 已启用，乘员可能改变载具的武器或炮塔；具体效果取决于相关配置。');
    for (const key of ['Passengers.Allowed', 'Passengers.Disallowed']) {
      const value = current(key).trim();
      if (value && !/^(none|<none>)$/i.test(value)) warnings.push(`已有 ${key}=${value}，可能限制可进入的单位；此功能不会修改该字段。`);
    }
  } else if (feature.id === 'garrison') {
    if (disabled(current('CanBeOccupied'))) warnings.push('CanBeOccupied 已关闭，建筑不能通过此选项驻军。');
    if (Number(current('MaxNumberOccupants')) === 0) warnings.push('MaxNumberOccupants=0 时没有可用的驻军位置。');
    if (disabled(current('CanOccupyFire'))) warnings.push('CanOccupyFire 已关闭，驻军不能通过此选项向外开火。');
    if (disabled(current('Selectable'))) warnings.push('Selectable 已关闭，玩家可能无法选择建筑并撤出驻军。');
    if (current('Sight') !== '' && Number(current('Sight')) === 0) warnings.push('Sight=0 可能影响驻军发现和攻击目标。');
    if (enabled(current('InfantryAbsorb')) || enabled(current('UnitAbsorb'))) warnings.push('建筑已启用吸收单位逻辑，可能与驻军交互；此功能不会修改吸收字段。');
    if (enabled(current('Wall')) || enabled(current('Gate'))) warnings.push('建筑同时具有围墙或闸门逻辑，驻军效果需要在游戏中确认。');
  }
  return warnings;
}

// Validate the whole form before touching the fork, then apply all fields atomically.
export function prepareQuickFeature(project, { featureId, type, section, values }) {
  const feature = quickFeaturesFor(type).find(item => item.id === featureId);
  if (!feature) throw new Error('此对象类型不支持该快捷功能。');
  if (!project.section(section)) throw new Error(`找不到规则段 [${section}]。`);
  const selected = {};
  for (const field of feature.fields) {
    const existing = project.get(section, field.key);
    const raw = String(values?.[field.key] ?? '').trim();
    if (!raw) {
      if (field.required) throw new Error(`请填写 ${field.key}。`);
      if (existing?.value) throw new Error(`${field.key} 已有值；如需清空，请在全部属性中单独编辑。`);
      selected[field.key] = '';
      continue;
    }
    if (field.type === 'integer' && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 2147483647)) {
      throw new Error(`${field.key} 需要填写 0 到 2147483647 之间的整数。`);
    }
    if (field.type === 'boolean' && !/^(yes|no|true|false|1|0)$/i.test(raw) && raw !== existing?.value) {
      throw new Error(`${field.key} 需要选择“是”或“否”。`);
    }
    if (field.type === 'pipScale' && !enumChoices('pipScale').some(item => normalize(item.id) === normalize(raw)) && raw !== existing?.value) {
      throw new Error('PipScale 需要选择已知类型，或保留原有值。');
    }
    selected[field.key] = raw;
  }
  const candidate = project.fork();
  const changes = [];
  for (const field of feature.fields) {
    const value = selected[field.key], before = project.get(section, field.key);
    if (!value || (before && before.value === value)) continue;
    candidate.set(section, field.key, value);
    const after = candidate.get(section, field.key);
    changes.push({ key: field.key, before: before ? before.value : null, after: after?.value ?? '', file: after?.file });
  }
  return { feature, project: candidate, section, changes, warnings: warningsFor(project, section, feature, selected) };
}
