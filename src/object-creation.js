import { listTypes } from './ini.js';

export const CREATE_TYPES = [
  { id: 'infantry', label: '步兵', registry: 'InfantryTypes', reuseImage: true },
  { id: 'vehicle', label: '载具', registry: 'VehicleTypes', reuseImage: true },
  { id: 'aircraft', label: '飞机', registry: 'AircraftTypes', reuseImage: true },
  { id: 'building', label: '建筑', registry: 'BuildingTypes', reuseImage: true },
  { id: 'weapon', label: '武器', registry: 'WeaponTypes' },
  { id: 'projectile', label: '投射物', registry: 'Projectiles' },
  { id: 'warhead', label: '弹头', registry: 'Warheads' },
  { id: 'superweapon', label: '超级武器', registry: 'SuperWeaponTypes' },
  { id: 'shield', label: 'Phobos 护盾', registry: 'ShieldTypes' },
  { id: 'attachtype', label: 'Phobos 附加效果', registry: 'AttachEffectTypes' },
  { id: 'radiation', label: 'Phobos 辐射类型', registry: 'RadiationTypes' },
  { id: 'lasertrail', label: 'Phobos 激光尾迹', registry: 'LaserTrailTypes' },
  { id: 'sections', label: '规则段', registry: '' },
];

const lower = value => String(value ?? '').trim().toLowerCase();
// YR's AbstractTypeClass stores 24 ID bytes; ordinary INI sections need not be game objects.
export const MAX_GAME_OBJECT_ID_LENGTH = 24;

// Prepare on a fork: a failed validation or a cancelled preview leaves the project untouched.
export function prepareObjectCreation(project, options) {
  return createObjectOnCandidate(project.fork(), options);
}

// Only use on an isolated candidate: callers discard the candidate if any step fails.
export function createObjectOnCandidate(candidate, { type, id, template = '', reservedIds = [] }) {
  const project = candidate;
  const kind = CREATE_TYPES.find(item => item.id === type);
  id = String(id ?? '').trim();
  if (!kind) throw new Error('请选择支持的对象类型。');
  if (type === 'lasertrail' && !/^art(?:mo|md)\.ini$/i.test(project.mainPath)) throw new Error('激光尾迹需写入美术规则；请先选择根目录的 artmo.ini 或 artmd.ini 为主文件。');
  if (['shield', 'attachtype', 'radiation'].includes(type) && /^art(?:mo|md)\.ini$/i.test(project.mainPath)) throw new Error('此 Phobos 类型需写入规则 INI；请先切换到规则主文件。');
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(id)) throw new Error('规则 ID 只能使用英文字母、数字、下划线、点和连字符，且必须以字母、数字或下划线开头。');
  if (kind.registry && id.length > MAX_GAME_OBJECT_ID_LENGTH) throw new Error(`游戏对象的规则 ID 最多 ${MAX_GAME_OBJECT_ID_LENGTH} 个字符，请缩短后重试。`);
  if (project.warnings.length) throw new Error(`规则加载不完整，无法安全新增：${project.warnings[0]}`);
  const reserved = new Set(['none', '<none>', ...CREATE_TYPES.map(item => lower(item.registry)).filter(Boolean), ...reservedIds.map(lower)]);
  for (const item of CREATE_TYPES) if (item.registry) for (const value of listTypes(project, item.registry)) reserved.add(lower(value));
  if (project.section(id) || reserved.has(lower(id))) throw new Error(`规则 ID ${id} 已存在或已被引用，请使用其他 ID。`);
  const source = template ? project.section(template) : null;
  if (template && !source) throw new Error(`找不到模板规则段 [${template}]。`);

  const sourceCopy = source && candidate.section(source.name);
  const registry = kind.registry ? candidate.section(kind.registry) : null;
  const destination = sourceCopy?.occurrences.at(-1)?.file || registry?.occurrences.at(-1)?.file || candidate.resolve(candidate.mainPath);
  if (!destination) throw new Error('找不到可写入的规则文件。');
  const previous = kind.registry ? listTypes(candidate, kind.registry) : [];
  const numbers = registry ? [...registry.fields.keys()].filter(key => /^\d+$/.test(key)).map(Number) : [];
  if (numbers.some(number => !Number.isSafeInteger(number)) || numbers.some(number => number >= Number.MAX_SAFE_INTEGER)) {
    throw new Error(`类型列表 [${kind.registry}] 的编号过大，无法安全追加。`);
  }
  const index = numbers.length ? Math.max(...numbers) + 1 : 0;
  candidate.createSection(id, destination, sourceCopy?.name || '');
  if (sourceCopy && kind.reuseImage && !candidate.get(id, 'Image')?.value.trim()) {
    candidate.set(id, 'Image', sourceCopy.name);
  }
  if (kind.registry) {
    candidate.appendEntry(kind.registry, String(index), id, candidate.resolve(candidate.mainPath));
    const after = listTypes(candidate, kind.registry);
    if (after.length !== previous.length + 1 || previous.some((value, i) => value !== after[i]) || after.at(-1) !== id) {
      throw new Error(`无法安全追加到 [${kind.registry}]，原有列表顺序可能变化。`);
    }
  }
  return {
    project: candidate,
    id,
    type,
    label: kind.label,
    template: sourceCopy?.name || '',
    definitionFile: candidate.section(id).occurrences.at(-1).file,
    registry: kind.registry,
    registryIndex: kind.registry ? index : null,
    registryFile: kind.registry ? candidate.get(kind.registry, String(index)).file : null,
    registryCreated: !!kind.registry && !registry,
  };
}
