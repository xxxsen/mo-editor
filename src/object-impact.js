import { listTypes } from './ini.js';
import { createObjectOnCandidate, MAX_GAME_OBJECT_ID_LENGTH } from './object-creation.js';
import { weaponWarheadReferences } from './weapon-references.js';

const norm = value => String(value ?? '').trim().toLowerCase();
const empty = value => !norm(value) || /^(?:none|<none>)$/i.test(String(value).trim());
export const UNIT_WEAPON_SLOT = /^(?:primary|secondary|eliteprimary|elitesecondary|occupyweapon|eliteoccupyweapon|deathweapon|weapon\d+|eliteweapon\d+)$/i;
const unitRegistries = ['InfantryTypes', 'VehicleTypes', 'AircraftTypes', 'BuildingTypes'];

export function unitWeaponSlots(project, unit) {
  const result = [];
  for (const field of project.section(unit)?.fields.values() || []) {
    const id = field.value.trim();
    if (!UNIT_WEAPON_SLOT.test(field.name) || empty(id)) continue;
    // OccupyWeapon may be an index instead of a weapon ID.
    if (/^(?:elite)?occupyweapon$/i.test(field.name) && /^[+-]?\d+$/.test(id) && !project.section(id)) continue;
    result.push({ key: field.name, id, exists: !!project.section(id) });
  }
  return result;
}

// Reserve existing identifiers and possible unresolved references, including custom fields.
function reservedIdentifiers(project, reservedIds) {
  const reserved = new Set([...project.sections.keys(), ...reservedIds.map(norm)]);
  for (const section of project.sections.values()) for (const field of section.fields.values()) {
    for (const value of field.value.split(',')) {
      const id = norm(value);
      if (/^[a-z0-9_][a-z0-9_.-]*$/.test(id)) reserved.add(id);
    }
  }
  return reserved;
}

function nextCopyId(source, reserved) {
  let stem = String(source).replace(/[^A-Za-z0-9_.-]/g, '_');
  if (!/^[A-Za-z0-9_]/.test(stem)) stem = `NEW_${stem}`;
  for (let n = 1; n < 100000; n++) {
    const suffix = `_COPY${n === 1 ? '' : n}`;
    const id = stem.slice(0, MAX_GAME_OBJECT_ID_LENGTH - suffix.length) + suffix;
    if (!reserved.has(norm(id))) { reserved.add(norm(id)); return id; }
  }
  throw new Error(`无法为 [${source}] 生成可用的复制 ID。`);
}

// Produces one isolated draft; neither failed previews nor cancelled dialogs touch the source.
export function prepareIsolatedWeapon(project, { unit, slot, copyProjectile = false, copyWarhead = false, copyBombWarhead = false, reservedIds = [] }) {
  if (!project.section(unit) || !unitRegistries.some(registry => listTypes(project, registry).some(id => norm(id) === norm(unit)))) {
    throw new Error('请选择已登记且已定义的单位或建筑。');
  }
  if (project.warnings.length) throw new Error(`规则加载不完整，无法安全复制关联对象：${project.warnings[0]}`);
  const selected = unitWeaponSlots(project, unit).find(item => norm(item.key) === norm(slot));
  if (!selected || !selected.exists) throw new Error('请选择当前单位已定义的武器槽。');
  const weapon = selected.id;
  const projectile = project.get(weapon, 'Projectile')?.value.trim() || '';
  const refs = weaponWarheadReferences(project, weapon);
  const direct = refs.find(ref => ref.key === 'Warhead');
  const bomb = refs.find(ref => ref.key === 'IvanBomb.Warhead');
  for (const [checked, id, label] of [[copyProjectile, projectile, '投射物'], [copyWarhead, direct?.id, '命中弹头'], [copyBombWarhead, bomb?.id, '炸弹弹头']]) {
    if (checked && (empty(id) || !project.section(id))) throw new Error(`未找到要复制的${label}定义。`);
  }
  const candidate = project.fork(), reserved = reservedIdentifiers(project, reservedIds), copies = [], rewires = [], copied = new Map();
  function copy(type, source) {
    const identity = `${type}:${norm(source)}`;
    if (copied.has(identity)) return copied.get(identity);
    const id = nextCopyId(source, reserved);
    const created = createObjectOnCandidate(candidate, { type, id, template: source, reservedIds: [...reserved].filter(value => value !== norm(id)) });
    copies.push({ type, from: source, to: id, definitionFile: created.definitionFile, registry: created.registry, registryIndex: created.registryIndex, registryFile: created.registryFile });
    copied.set(identity, id);
    return id;
  }
  const weaponCopy = copy('weapon', weapon);
  const rewire = (section, key, next, before) => {
    candidate.set(section, key, next);
    rewires.push({ section, key, before, after: next, file: candidate.get(section, key).file });
  };
  if (copyProjectile) rewire(weaponCopy, 'Projectile', copy('projectile', projectile), projectile);
  if (copyWarhead) rewire(weaponCopy, 'Warhead', copy('warhead', direct.id), direct.id);
  if (copyBombWarhead) rewire(weaponCopy, 'IvanBomb.Warhead', copy('warhead', bomb.id), bomb.source === 'global' ? `${bomb.id}（全局默认）` : bomb.id);
  rewire(unit, selected.key, weaponCopy, weapon);
  return { project: candidate, unit, slot: selected.key, weapon, weaponCopy, copies, rewires };
}
