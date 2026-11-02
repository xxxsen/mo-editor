import { listTypes } from './ini.js';

const keys = ['ExtraWarheads', 'ExtraWarheads.DamageOverrides', 'ExtraWarheads.DetonationChances', 'ExtraWarheads.FullDetonation'];
const split = value => value ? String(value).split(',').map(item => item.trim()) : [];
const keyOf = value => String(value || '').trim().toLowerCase();
const effective = (values, index) => values.length ? values[Math.min(index, values.length - 1)] : '';
const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i;

export function extraWarheadRows(project, weapon) {
  const values = keys.map(key => split(project.get(weapon, key)?.value));
  return values[0].map((id, index) => ({
    id, damage: effective(values[1], index), chance: effective(values[2], index), full: effective(values[3], index),
  }));
}

// Preserve shorthand and untouched unknown values exactly. On a structural change,
// write each surviving row's effective options so positional values cannot drift.
export function prepareExtraWarheads(project, weapon, incoming) {
  if (!project.section(weapon)) throw new Error(`找不到武器 [${weapon}]。`);
  if (project.warnings.length) throw new Error(`规则加载不完整，无法安全修改：${project.warnings[0]}`);
  const rows = incoming.map(row => Object.fromEntries(['id', 'damage', 'chance', 'full'].map(key => [key, String(row[key] ?? '').trim()])));
  const before = extraWarheadRows(project, weapon);
  if (rows.some(row => Object.values(row).some(value => /[,;\r\n]/.test(value)))) throw new Error('每项不能包含逗号、分号或换行。');
  if (rows.some(row => !row.id)) throw new Error('请为每一行填写弹头，或删除空行。');
  const original = keys.map(key => project.get(weapon, key)?.value ?? '');
  const idsChanged = JSON.stringify(rows.map(row => row.id)) !== JSON.stringify(before.map(row => row.id));
  const registered = new Set(listTypes(project, 'Warheads').map(keyOf));
  const oldIds = new Set(before.map(row => keyOf(row.id)));
  for (const row of rows) if ((!registered.has(keyOf(row.id)) || !project.section(row.id)) && !oldIds.has(keyOf(row.id))) {
    throw new Error(`弹头 [${row.id}] 必须已定义并登记在 [Warheads]；请先新建或登记。`);
  }
  if (idsChanged && original.slice(1).some(value => split(value).length > before.length || split(value).some(item => !item))) {
    throw new Error('现有参数列表包含多余或空项，无法安全调整弹头顺序；请先在全部属性中整理列表。');
  }
  const columns = [rows.map(row => row.id), rows.map(row => row.damage), rows.map(row => row.chance), rows.map(row => row.full)];
  const names = ['id', 'damage', 'chance', 'full'];
  const candidate = project.fork(), changes = [];
  for (let i = 0; i < keys.length; i++) {
    const oldColumn = before.map(row => row[names[i]]), column = columns[i];
    if (!idsChanged && JSON.stringify(column) === JSON.stringify(oldColumn)) continue;
    if (i > 0 && !idsChanged && split(original[i]).length > before.length) throw new Error(`${keys[i]} 包含额外的未使用项，无法安全调整；请先在全部属性中整理列表。`);
    if (i > 0 && column.some(Boolean) && column.some(value => !value)) throw new Error(`${keys[i]} 存在空项；请全部留空或为每一行填写数值，避免位置错配。`);
    if (i === 1 && column.some(value => value && (!/^[+-]?\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < -2147483648 || Number(value) > 2147483647))) throw new Error('额外弹头伤害需要填写 32 位整数。');
    if (i === 2 && column.some(value => {
      if (!value) return false;
      if (!number.test(value)) return true;
      const n = Number(value.replace(/%$/, '')); return !Number.isFinite(n) || n < 0 || n > (value.endsWith('%') ? 100 : 1);
    })) throw new Error('触发概率请输入 0 到 1 或 0% 到 100%。');
    if (i === 3 && column.some(value => value && !/^(yes|no|true|false|1|0)$/i.test(value))) throw new Error('完整引爆请选择是或否。');
    // Keep shorthand where repeating the last value gives the same result.
    const packed = [...column];
    if (i > 0) while (packed.length > 1 && packed.at(-1) === packed.at(-2)) packed.pop();
    const next = packed.join(',');
    if (next === original[i] || (!next && !project.get(weapon, keys[i]))) continue;
    candidate.set(weapon, keys[i], next);
    changes.push({ key: keys[i], before: project.get(weapon, keys[i])?.value ?? null, after: next, file: candidate.get(weapon, keys[i])?.file || project.get(weapon, keys[i])?.file });
  }
  const warnings = [];
  for (const row of rows) if (!registered.has(keyOf(row.id)) || !project.section(row.id)) warnings.push(`已有弹头 [${row.id}] 未登记或未找到定义，游戏可能不会引爆它。`);
  if (rows.length) warnings.push('额外弹头按顺序在主弹头后引爆；AirburstWeapon 等不保留原武器引用的情况不支持此功能。');
  return { project: candidate, changes, warnings };
}
