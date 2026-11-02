const referenceId = value => {
  const id = String(value ?? '').trim();
  return !id || /^(?:none|<none>)$/i.test(id) ? '' : id;
};

// Ares 的炸弹配置仅在直接命中弹头启用 IvanBomb 时参与默认值解析。
export function usesIvanBomb(project, weaponId) {
  const direct = referenceId(project.get(weaponId, 'Warhead')?.value);
  return !!direct && /^(?:yes|true|1)$/i.test(project.get(direct, 'IvanBomb')?.value?.trim() || '');
}

// 显式字段始终作为配置引用保留；缺省或留空且启用了炸弹逻辑时解析全局默认值。
export function weaponWarheadReferences(project, weaponId) {
  const references = [];
  const direct = referenceId(project.get(weaponId, 'Warhead')?.value);
  if (direct) references.push({ key: 'Warhead', id: direct, source: 'weapon' });

  const bombField = project.get(weaponId, 'IvanBomb.Warhead');
  if (bombField?.value.trim()) {
    const bomb = referenceId(bombField.value);
    if (bomb) references.push({ key: 'IvanBomb.Warhead', id: bomb, source: 'weapon' });
  } else if (usesIvanBomb(project, weaponId)) {
    const fallback = referenceId(project.get('CombatDamage', 'IvanWarhead')?.value);
    if (fallback) references.push({ key: 'IvanBomb.Warhead', id: fallback, source: 'global' });
  }
  // Phobos extra warheads are positional and may intentionally contain duplicates.
  const extra = project.get(weaponId, 'ExtraWarheads')?.value || '';
  extra.split(',').forEach((value, index) => {
    const id = referenceId(value);
    if (id) references.push({ key: 'ExtraWarheads', id, source: 'weapon', index });
  });
  return references;
}
