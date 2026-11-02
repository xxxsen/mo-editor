// LaunchSW is an ordered list. Keep repeated entries and original indices so
// every reference can be displayed and followed without rewriting the rule.
export function warheadSuperweaponReferences(project, warhead) {
  const raw = project.get(warhead, 'LaunchSW')?.value || '';
  return raw.split(',').map((part, index) => ({ id: part.trim(), index, key: 'LaunchSW' }))
    .filter(item => item.id && !/^(?:none|<none>)$/i.test(item.id));
}
