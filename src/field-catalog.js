import { FIELD_METADATA, getFieldInfo } from './field-metadata.js';

const keyOf = value => String(value ?? '').trim().toLowerCase();
const unitTypes = new Set(['infantry', 'vehicle', 'aircraft', 'building']);
const difficulty = new Set(['easy', 'normal', 'difficult']);
const commonTechno = new Set(`name uiname strength armor cost techlevel sight owner prerequisite requiredhouses forbiddenhouses primary secondary eliteprimary elitesecondary image buildlimit buildtimemultiplier category points threatposed specialthreatvalue trainable veteranabilities eliteabilities selfhealing immunetoemp immunetopsionics immunetoradiation immunetoveins immunetoabduction chronoshift.allow chronoshift.crushable ironcurtain.modifier cloakable sensors sensorssight radarinvisible radarvisible selectable legaltarget canpassiveaquire canretaliate insignificant nominal explosion explodes deathweapon mindebris maxdebris debrisanims damageparticlesystems damagesmokeoffset diesound damagesound`.split(' '));

function documentedFields(type, section, globalKind) {
  if (unitTypes.has(type)) return [FIELD_METADATA.common, FIELD_METADATA.techno, FIELD_METADATA.attachEffect];
  if (['weapon', 'projectile', 'warhead', 'superweapon', 'shield', 'attachtype', 'radiation', 'lasertrail'].includes(type)) {
    return [FIELD_METADATA.common, FIELD_METADATA[type], ...(type === 'warhead' ? [FIELD_METADATA.attachEffect] : [])];
  }
  if (type === 'global') {
    const name = difficulty.has(keyOf(section)) ? 'difficulty' : keyOf(section);
    return [FIELD_METADATA.sections[name] || {}, ...(globalKind === 'country' ? [FIELD_METADATA.country, FIELD_METADATA.common] : name === 'general' ? [FIELD_METADATA.common] : [])];
  }
  return [];
}

// The dictionary's techno group combines four engine object types. A field seen on
// another object of this type is useful evidence, but not a promise that it will work.
export function availableFields(project, entity, entities = [], pending = []) {
  if (!entity || !project.section(entity.id)) return [];
  const section = project.section(entity.id);
  const present = new Set([...section.fields.keys(), ...pending.map(keyOf)]);
  const observed = new Map();
  for (const item of entities) {
    if (item.type !== entity.type || !item.exists || keyOf(item.id) === keyOf(entity.id)) continue;
    if (entity.type === 'global') {
      const comparable = entity.globalKind === 'country' ? item.globalKind === 'country'
        : difficulty.has(keyOf(entity.id)) && difficulty.has(keyOf(item.id));
      if (!comparable) continue;
    }
    for (const field of project.section(item.id)?.fields.values() || []) {
      const id = keyOf(field.name);
      if (!observed.has(id)) observed.set(id, field.name);
    }
  }
  const candidates = new Map();
  const add = (name, origin) => {
    const id = keyOf(name);
    if (!id || present.has(id) || candidates.has(id)) return;
    const info = getFieldInfo(name, { type: entity.type, section: entity.id, globalKind: entity.globalKind });
    if (origin === 'documented' && !info.known) return;
    let group;
    if (origin === 'observed') group = info.known ? '同类对象已使用 · 已收录' : '同类对象已使用 · 含义未收录';
    else if (unitTypes.has(entity.type) && !commonTechno.has(id) && !observed.has(id)) group = '其他已收录单位字段 · 适用类型待确认';
    else group = '当前类型已收录';
    candidates.set(id, { name, ...info, group });
  };
  for (const name of observed.values()) add(name, 'observed');
  for (const table of documentedFields(entity.type, entity.id, entity.globalKind)) for (const name of Object.keys(table)) add(name, 'documented');
  if (unitTypes.has(entity.type)) {
    for (const index of [1, 2]) for (const prefix of ['Weapon', 'EliteWeapon', 'Stage', 'EliteStage']) add(`${prefix}${index}`, 'documented');
    if (entity.type === 'vehicle') for (let index = 0; index < 4; index++) add(`BurstDelay${index}`, 'documented');
  }
  if (entity.type === 'sections' && /^art(?:mo|md)\.ini$/i.test(project.mainPath)) {
    for (const index of [0, 1]) for (const suffix of ['Type', 'FLH', 'IsOnTurret']) add(`LaserTrail${index}.${suffix}`, 'documented');
    add('LaserTrail.Types', 'documented');
  }
  if (entity.type === 'warhead') {
    for (const prefix of ['Convert', 'Convert0', 'Convert1']) for (const suffix of ['From', 'To', 'AffectedHouses']) add(`${prefix}.${suffix}`, 'documented');
    for (const prefix of ['SpawnsCrate', 'SpawnsCrate0', 'SpawnsCrate1']) for (const suffix of ['Type', 'Weight']) add(`${prefix}.${suffix}`, 'documented');
    for (const field of project.section('ArmorTypes')?.fields.values() || []) {
      for (const suffix of ['', '.ForceFire', '.Retaliate', '.PassiveAcquire']) add(`Versus.${field.name}${suffix}`, 'documented');
    }
  }
  const groups = ['同类对象已使用 · 已收录', '当前类型已收录', '同类对象已使用 · 含义未收录', '其他已收录单位字段 · 适用类型待确认'];
  return [...candidates.values()].sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || a.name.localeCompare(b.name));
}
