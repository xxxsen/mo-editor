// References supported by Phobos 0.4 warheads. Group IDs and numeric values
// are deliberately excluded: they are not object IDs.
const fields = new Map([
  ['crit.warhead', ['warhead', false]],
  ['launchsw', ['superweapon', true]],
  ['shield.breakweapon', ['weapon', false]],
  ['suppressrevengeweapons.types', ['weapon', true]],
  ...['shield.affecttypes', 'shield.penetrate.types', 'shield.break.types', 'shield.respawn.types', 'shield.selfhealing.types', 'shield.attachtypes', 'shield.removetypes'].map(key => [key, ['shield', true]]),
  ...['attacheffect.attachtypes', 'attacheffect.removetypes', 'suppressreflectdamage.types'].map(key => [key, ['attachtype', true]]),
  ...['detonateonallmapobjects.affecttypes', 'detonateonallmapobjects.ignoretypes'].map(key => [key, ['techno', true]]),
  ...['animlist', 'crit.animlist', 'crit.activechanceanims', 'splashlist', 'debrisanims'].map(key => [key, ['animation', true]]),
  ...['infdeathanim', 'preimpactanim', 'emp.sparkles', 'temporal.warpaway', 'mindcontrol.anim', 'attacheffect.animation', 'shield.breakanim', 'shield.hitanim'].map(key => [key, ['animation', false]]),
]);

export function warheadReferences(project, id) {
  const refs = [];
  for (const field of project.section(id)?.fields.values() || []) {
    const name = field.name.toLowerCase();
    let spec = fields.get(name);
    if (!spec && /^convert\d*\.(?:from|to)$/.test(name)) spec = ['techno', name.endsWith('.from')];
    if (!spec) continue;
    const [type, multiple] = spec;
    const values = multiple ? field.value.split(',') : [field.value];
    values.forEach((value, index) => {
      const target = value.trim();
      if (!target || /^(?:none|<none>)$/i.test(target)) return;
      refs.push({ id: target, type, key: field.name, ...(multiple ? { index } : {}) });
    });
  }
  return refs;
}
