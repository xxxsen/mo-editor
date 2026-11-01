import { IniProject, parseFile, serialize, listTypes } from './ini.js';
import { DEMO_MAIN, DEMO_UNITS } from './demo.js';
import { GameResources } from './resources.js';
import { STANDARD_ARMORS, GLOBAL_SECTIONS, globalFieldInfo, countriesFor, sidesFor, armorsFor, prerequisitesFor, mergeSelections, updateVerses } from './rule-schema.js';
import { getFieldInfo } from './field-metadata.js';
import { usesIvanBomb, weaponWarheadReferences } from './weapon-references.js';
import * as desktop from './desktop.js';
import { fitStartupWindow } from './startup-window.js';

const enc = new TextEncoder();
const app = document.querySelector('#app');
const fileInput = document.querySelector('#file-input');
const folderInput = document.querySelector('#folder-input');
const dialog = document.querySelector('#changes-dialog');
const editorDialog = document.querySelector('#editor-dialog');
const toast = document.querySelector('#toast');
const state = { project: null, resources: null, desktopSession: null, demo: true, category: 'all', selected: '', tab: 'basic', search: '', owner: '', notice: true, entities: [], changedSections: new Set(), listLimit: 250, globalSearch: '', armorSearch: '', armorOpen: false };
const navigation = { entries: [], index: -1, trail: [] };
let pointerDown = false;
let renderPending = false;
let composing = false;
let renderTimer;
let importSequence = 0;
let iconObserver;
let nativeCloseApproved = false;
const iconURLs = new WeakMap();

const icons = {
  logo: '<path d="M4 18 12 4l8 14h-4l-4-7-4 7H4Z"/><path d="M9 18h6"/>',
  all: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  global: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.6 2.4 4 5.1 4 8s-1.4 5.6-4 8c-2.6-2.4-4-5.1-4-8s1.4-5.6 4-8Z"/>',
  infantry: '<circle cx="12" cy="5.5" r="2.5"/><path d="m8 20 1-6-2-2 2-3h6l2 3-2 2 1 6M12 11v8"/>',
  vehicle: '<path d="M4 16h16l-1.5 3h-13L4 16Zm3-1 1.5-5h7l2 5M12 10V7h6M7.5 18h.1m4.4 0h.1m4.3 0h.1"/>',
  aircraft: '<path d="m12 3 2 7 6 4v2l-6-2v4l2 2v1l-4-1-4 1v-1l2-2v-4l-6 2v-2l6-4 2-7Z"/>',
  building: '<path d="M4 20h16M6 20V9l6-5 6 5v11M9 20v-5h6v5M9 10h.1m5.8 0h.1"/>',
  superweapon: '<circle cx="12" cy="12" r="9"/><path d="m13 4-5 9h4l-1 7 5-10h-4l1-6Z"/>',
  weapon: '<path d="m4 16 4-4 3 3-4 4H4v-3Zm7-1 2-2m-2-5 5-4 4 4-4 5-5-5Zm4 1 4 4"/>',
  warhead: '<path d="M12 3c3 2 5 5 5 9v5H7v-5c0-4 2-7 5-9ZM7 14l-3 3v3l3-1m10-5 3 3v3l-3-1M10 20h4M12 7v4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  upload: '<path d="M12 15V4m-4 4 4-4 4 4M5 15v4h14v-4"/>',
  folder: '<path d="M3 7h7l2 2h9v10H3V7Z"/>',
  download: '<path d="M12 4v11m-4-4 4 4 4-4M5 17v3h14v-3"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  link: '<path d="M10 14 14 10M8 16H7a4 4 0 0 1 0-8h3m4 0h3a4 4 0 0 1 0 8h-3"/>',
  shield: '<path d="M12 3 4 6v6c0 4 3 7 8 9 5-2 8-5 8-9V6l-8-3Zm-3 9 2 2 4-4"/>',
};
function icon(name, size = 16) { return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.all}</svg>`; }
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const lower = value => String(value ?? '').toLowerCase();
const unique = values => [...new Map(values.map(value => [lower(value), value])).values()];
const val = (section, key) => state.project.get(section, key)?.value || '';
const sourceName = file => file.sourceArchive ? `${file.sourceArchive} → ${file.path}` : file.path;
const CATEGORIES = [
  { id: 'global', label: '全局配置', icon: 'global' },
  { id: 'all', label: '全部对象', icon: 'all' },
  { id: 'infantry', label: '步兵', icon: 'infantry', list: 'InfantryTypes' },
  { id: 'vehicle', label: '载具', icon: 'vehicle', list: 'VehicleTypes' },
  { id: 'aircraft', label: '飞机', icon: 'aircraft', list: 'AircraftTypes' },
  { id: 'building', label: '建筑', icon: 'building', list: 'BuildingTypes' },
  { id: 'superweapon', label: '超级武器', icon: 'superweapon', list: 'SuperWeaponTypes' },
  { id: 'weapon', label: '武器', icon: 'weapon' },
  { id: 'warhead', label: '弹头', icon: 'warhead' },
  { id: 'sections', label: '所有规则段', icon: 'all' },
];
const labelFor = type => CATEGORIES.find(item => item.id === type)?.label || '对象';
const unitTypes = new Set(['infantry', 'vehicle', 'aircraft', 'building']);
const weaponKey = key => /^(primary|secondary|eliteprimary|elitesecondary|occupyweapon|eliteoccupyweapon|weapon\d+|eliteweapon\d+)$/i.test(key);

function buildEntities() {
  const project = state.project;
  const entities = [];
  const seen = new Set();
  const add = (id, type) => {
    id = id.trim();
    if (!id || /^none$/i.test(id) || seen.has(`${type}:${lower(id)}`)) return;
    seen.add(`${type}:${lower(id)}`);
    const originalName = val(id, 'Name');
    const uiName = val(id, 'UIName');
    const name = state.resources?.strings.get(lower(uiName)) || originalName || uiName || id;
    entities.push({ id, type, name, originalName, uiName, exists: !!project.section(id), owner: val(id, 'Owner') });
  };
  const globals = new Set();
  for (const section of GLOBAL_SECTIONS) if (project.section(section.id)) {
    entities.push({ id: section.id, type: 'global', name: section.label, originalName: section.id, uiName: '', description: section.description, exists: true, owner: '' });
    globals.add(lower(section.id));
  }
  const countryChoices = countriesFor(project, state.resources?.strings, '', [], state.resources?.clientSides);
  const sideChoices = sidesFor(project);
  for (const side of sideChoices) if (project.section(side.id) && !globals.has(lower(side.id))) {
    entities.push({ id: side.id, type: 'global', globalKind: 'side', name: `阵营 · ${side.label}`, originalName: side.id, uiName: '', description: '阵营的默认设置', exists: true, owner: '' });
    globals.add(lower(side.id));
  }
  for (const id of listTypes(project, 'Countries')) if (project.section(id) && !globals.has(lower(id))) {
    const choice = countryChoices.find(item => lower(item.id) === lower(id));
    entities.push({ id, type: 'global', globalKind: 'country', name: `国家 · ${choice?.label || id}`, originalName: id, uiName: '', description: '国家的建造、装甲与专属设置', exists: true, owner: '' });
    globals.add(lower(id));
  }
  for (const [registry, prefix] of [['Tiberiums', '矿石'], ['TunnelTypes', '隧道']]) for (const id of listTypes(project, registry)) {
    if (!project.section(id) || globals.has(lower(id))) continue;
    entities.push({ id, type: 'global', name: `${prefix} · ${id}`, originalName: id, uiName: '', description: `${prefix}类型设置`, exists: true, owner: '' });
    globals.add(lower(id));
  }
  if (state.category === 'sections') for (const section of project.sections.values()) {
    entities.push({ id: section.name, type: 'sections', name: section.name, originalName: '', uiName: '', description: '规则段中的全部参数', exists: true, owner: '' });
  }
  for (const cat of CATEGORIES.filter(item => item.list)) {
    for (const id of listTypes(project, cat.list)) add(id, cat.id);
  }
  const weaponIds = [...listTypes(project, 'WeaponTypes')];
  for (const entity of entities) {
    if (!unitTypes.has(entity.type)) continue;
    const section = project.section(entity.id);
    if (section) for (const field of section.fields.values()) {
      if (!weaponKey(field.name) || !field.value) continue;
      const id = field.value.trim();
      if (!id || /^(?:none|<none>)$/i.test(id)) continue;
      // 驻军武器的默认槽位可能以数字表示；不要把不存在的槽位当作武器定义。
      if (/^(?:elite)?occupyweapon$/i.test(field.name) && /^[+-]?\d+$/.test(id) && !project.section(id)) continue;
      weaponIds.push(id);
    }
  }
  for (const id of unique(weaponIds)) add(id, 'weapon');
  const warheadIds = [...listTypes(project, 'Warheads')];
  for (const weapon of entities.filter(entity => entity.type === 'weapon')) {
    for (const reference of weaponWarheadReferences(project, weapon.id)) warheadIds.push(reference.id);
  }
  for (const id of unique(warheadIds)) add(id, 'warhead');
  return entities;
}

function entityFor(id, type = '') {
  return state.entities.find(item => lower(item.id) === lower(id) && (!type || item.type === type));
}
function chooseInitial() {
  state.entities = buildEntities();
  const preferred = state.demo ? state.entities.find(item => item.type === 'vehicle' && item.exists) : state.entities.find(item => unitTypes.has(item.type) && item.exists);
  state.selected = preferred?.id || state.entities.find(item => item.exists)?.id || '';
  state.selectedType = entityFor(state.selected)?.type || '';
}
function sectionTitle(entity) { return entity?.name || entity?.id || ''; }
function count(type) { return type === 'sections' ? state.project.sections.size : state.entities.filter(item => type === 'all' ? unitTypes.has(item.type) : item.type === type).length; }
function filteredEntities() {
  const q = lower(state.search.trim());
  const side = state.owner.startsWith('@side:') ? state.owner.slice(6) : '';
  const sideCountries = side ? new Set(val('Sides', side).split(',').map(value => lower(value.trim())).filter(Boolean)) : null;
  return state.entities.filter(item => (state.category === 'all' ? unitTypes.has(item.type) : item.type === state.category)
    && (!state.owner || !unitTypes.has(item.type) || item.owner.split(',').some(owner => sideCountries ? sideCountries.has(lower(owner.trim())) : lower(owner.trim()) === lower(state.owner)))
    && (!q || lower([item.name, item.originalName, item.uiName, item.id, item.owner, item.description].join(' ')).includes(q)));
}
function matchingGlobalFields(query) {
  const q = lower(query.trim());
  if (!q) return [];
  const matches = [];
  for (const entity of state.entities) {
    if (entity.type !== 'global') continue;
    for (const field of state.project.section(entity.id)?.fields.values() || []) {
      const info = globalFieldInfo(entity.id, field.name, entity.globalKind);
      if (lower([field.name, info.label, ...info.aliases].join(' ')).includes(q)) matches.push({ entity, field, info });
    }
  }
  return matches;
}
function markChanges() { return state.project.changes(); }

function noticeMarkup() {
  const warnings = [...state.project.warnings, ...(state.resources?.notes || [])];
  let out = '';
  if (warnings.length) {
    out += `<div class="notice warning">${icon('info', 16)}<div><strong>加载结果可能不完整。</strong> 当前结果只反映已解析的文件；${h(warnings.slice(0, 2).join(' '))}${warnings.length > 2 ? ` 另有 ${warnings.length - 2} 项。` : ''}</div></div>`;
  }
  if (state.demo && state.notice) {
    out += `<div class="notice">${icon('info', 16)}<div><strong>你正在浏览虚构的演示数据。</strong> 导入自己的规则文件后，即可查看和修改真实配置。</div><button class="close" data-action="dismiss" aria-label="关闭提示">×</button></div>`;
  }
  if (!state.demo && state.resources) {
    const { strings, art, archives, pcxFiles } = state.resources;
    const main = state.project.resolve(state.project.mainPath);
    const origin = main?.sourceArchive ? `MIX：${main.sourceArchive}` : '独立文件';
    const hasIconSource = (art || state.entities.some(item => item.type === 'superweapon' && val(item.id, 'SidebarPCX'))) && (archives.length || pcxFiles.size);
    out += `<div class="resource-status"><span>${icon('info', 14)} 规则来源 <strong>${h(origin)}</strong></span><span>文字资源 <strong>${strings.size ? `已加载 ${strings.size} 条` : '未找到'}</strong></span><span>游戏图标 <strong>${hasIconSource ? '已连接资源' : '未找到'}</strong></span><span class="resource-hint" title="${h(state.desktopSession?.directory || '')}">${state.desktopSession ? `保存目录：${h(state.desktopSession.directory)}` : strings.size && hasIconSource ? '使用游戏目录中的资源' : '选择游戏目录可加载中文名称和游戏图标'}</span></div>`;
  }
  return out;
}

function captureView() {
  const active = document.activeElement;
  let focus = null;
  if (active && app.contains(active)) {
    if (active.id) focus = { id: active.id };
    else {
      const attribute = ['entity', 'field', 'versesIndex', 'tab', 'category', 'action', 'jump'].find(name => active.dataset[name] !== undefined);
      if (attribute) focus = { attribute, value: active.dataset[attribute], type: active.dataset.type, key: active.dataset.key };
    }
    if (focus && active instanceof HTMLInputElement && ['text', 'search'].includes(active.type)) {
      focus.start = active.selectionStart;
      focus.end = active.selectionEnd;
      focus.direction = active.selectionDirection;
    }
  }
  return { x: window.scrollX, y: window.scrollY, list: app.querySelector('.unit-list')?.scrollTop || 0, detail: app.querySelector('.detail-body')?.scrollTop || 0, armor: app.querySelector('.armor-overrides-list')?.scrollTop || 0, trail: app.querySelector('.navigation-trail')?.scrollLeft ?? null, focus };
}

function restoreView(view, resetList) {
  const list = app.querySelector('.unit-list');
  if (list) list.scrollTop = resetList ? 0 : view.list;
  const detail = app.querySelector('.detail-body');
  if (detail) detail.scrollTop = view.detail;
  const armor = app.querySelector('.armor-overrides-list');
  if (armor) armor.scrollTop = view.armor;
  const trail = app.querySelector('.navigation-trail');
  if (trail) trail.scrollLeft = view.trail ?? trail.scrollWidth;
  if (view.focus) {
    const { id, attribute, value, type, key, start, end, direction } = view.focus;
    const dataAttribute = attribute === 'versesIndex' ? 'verses-index' : attribute;
    const candidate = id ? app.querySelector(`#${CSS.escape(id)}`) : [...app.querySelectorAll(`[data-${dataAttribute}]`)]
      .find(element => element.dataset[attribute] === value && (type === undefined || element.dataset.type === type) && (key === undefined || element.dataset.key === key));
    if (candidate) {
      candidate.focus({ preventScroll: true });
      if (start !== undefined && start !== null && candidate instanceof HTMLInputElement) candidate.setSelectionRange(start, end, direction);
    }
  }
  window.scrollTo(view.x, view.y);
}

const navigationKeys = ['category', 'selected', 'selectedType', 'tab', 'search', 'owner', 'listLimit', 'globalSearch', 'armorSearch', 'armorOpen'];
function navigationLocation() {
  return Object.fromEntries(navigationKeys.map(key => [key, state[key]]));
}
function navigationNode(entity, via = '') {
  return { id: entity.id, type: entity.type, name: entity.name, via, location: null };
}
function resetNavigation() {
  const entity = entityFor(state.selected, state.selectedType) || entityFor(state.selected);
  navigation.trail = entity ? [navigationNode(entity)] : [];
  navigation.entries = [];
  navigation.index = -1;
}
function captureNavigation() {
  const entity = entityFor(state.selected, state.selectedType) || entityFor(state.selected);
  return { location: navigationLocation(), view: captureView(), trail: [...navigation.trail], label: entity?.name || entity?.id || labelFor(state.category) };
}
function initializeNavigation() {
  navigation.entries = [captureNavigation()];
  navigation.index = 0;
  updateNavigationControls();
}
function updateNavigationControls() {
  for (const [action, offset, label, shortcut] of [['nav-back', -1, '返回', 'Alt+← / 鼠标后退键'], ['nav-forward', 1, '前进', 'Alt+→ / 鼠标前进键']]) {
    const button = app.querySelector(`[data-action="${action}"]`);
    if (!button) continue;
    const entry = navigation.entries[navigation.index + offset];
    button.disabled = !entry;
    button.title = entry ? `${label}：${entry.label}（${shortcut}）` : `${label}（${shortcut}）`;
  }
}
function recordNavigation(before) {
  if (navigation.index < 0) { initializeNavigation(); return; }
  navigation.entries[navigation.index] = before;
  navigation.entries.splice(navigation.index + 1);
  navigation.entries.push(captureNavigation());
  if (navigation.entries.length > 100) navigation.entries.shift();
  navigation.index = navigation.entries.length - 1;
  updateNavigationControls();
}
function restoreNavigation(entry) {
  Object.assign(state, entry.location);
  navigation.trail = [...entry.trail];
  render({ viewOverride: entry.view });
  updateNavigationControls();
}
function moveNavigation(offset) {
  const index = navigation.index + offset;
  if (composing || index < 0 || index >= navigation.entries.length) return;
  navigation.entries[navigation.index] = captureNavigation();
  navigation.index = index;
  restoreNavigation(navigation.entries[index]);
}
function navigateTrail(index) {
  const node = navigation.trail[index];
  if (composing || !node?.location || index >= navigation.trail.length - 1) return;
  const before = captureNavigation();
  const trail = navigation.trail.slice(0, index + 1);
  restoreNavigation({ ...node.location, trail });
  recordNavigation(before);
}
function trailMarkup() {
  if (navigation.trail.length < 2) return '';
  return `<nav class="navigation-trail" aria-label="访问路径"><span class="trail-label">访问路径</span>${navigation.trail[0].truncated ? '<span class="trail-edge">… ›</span>' : ''}${navigation.trail.map((node, index) => {
    const name = entityFor(node.id, node.type)?.name || node.name || node.id;
    const label = `${h(name)}${lower(name) === lower(node.id) ? '' : ` <code>[${h(node.id)}]</code>`}`;
    return `${index ? `<span class="trail-edge">› ${h(node.via || '关联')}</span>` : ''}${index < navigation.trail.length - 1 ? `<button type="button" data-trail="${index}" title="返回 ${h(name)}">${label}</button>` : `<span class="trail-current" aria-current="page">${label}</span>`}`;
  }).join('')}</nav>`;
}

async function showIcon(element) {
  const resources = state.resources;
  const project = state.project;
  const id = element.dataset.iconId;
  if (!resources || !id) return;
  const imageKey = `${project.get(id, 'Image')?.value || id}\n${project.get(id, 'SidebarPCX')?.value || ''}`;
  const image = await resources.icon(project, id);
  if (!image || !element.isConnected || resources !== state.resources || project !== state.project || `${project.get(id, 'Image')?.value || id}\n${project.get(id, 'SidebarPCX')?.value || ''}` !== imageKey) return;
  let url = iconURLs.get(image);
  if (!url) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    const pixels = context.createImageData(image.width, image.height);
    pixels.data.set(image.pixels);
    context.putImageData(pixels, 0, 0);
    url = canvas.toDataURL('image/png');
    iconURLs.set(image, url);
  }
  const img = document.createElement('img');
  img.src = url; img.alt = ''; img.decoding = 'async';
  element.replaceChildren(img);
  element.classList.add('has-cameo');
}

function observeIcons() {
  iconObserver?.disconnect();
  if (!state.resources) return;
  if (!('IntersectionObserver' in window)) {
    app.querySelectorAll('[data-icon-id]').forEach(element => { void showIcon(element); });
    return;
  }
  iconObserver ||= new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      iconObserver.unobserve(entry.target);
      void showIcon(entry.target);
    }
  });
  app.querySelectorAll('[data-icon-id]').forEach(element => iconObserver.observe(element));
}

function libraryResults() {
  const selected = entityFor(state.selected, state.selectedType) || entityFor(state.selected);
  const filtered = filteredEntities();
  const display = filtered.slice(0, state.listLimit);
  const globalFields = matchingGlobalFields(state.search);
  const displayedFields = globalFields.slice(0, state.listLimit);
  const remaining = filtered.length - display.length + globalFields.length - displayedFields.length;
  const list = display.map(entity => {
    const isSelected = selected && lower(selected.id) === lower(entity.id) && selected.type === entity.type;
    const isChanged = state.changedSections.has(lower(entity.id));
    return `<button class="unit ${isSelected ? 'selected' : ''}" data-entity="${h(entity.id)}" data-type="${entity.type}" aria-pressed="${!!isSelected}" aria-label="${h(entity.name)}，${h(entity.id)}${isChanged ? '，有修改' : ''}"><span class="unit-icon" ${['global','sections'].includes(entity.type) ? '' : `data-icon-id="${h(entity.id)}"`}>${icon(entity.type, 19)}</span><span class="unit-info"><span class="unit-name">${h(entity.name)}</span><span class="unit-id">${h(entity.id)}${entity.exists ? '' : ' · 未定义'}</span></span>${isChanged ? '<span class="unit-dirty" title="有修改" aria-hidden="true"></span>' : ''}<span class="unit-chevron">${icon('chevron', 14)}</span></button>`;
  }).join('');
  const fieldList = displayedFields.map(({ entity, field, info }) => `<button type="button" class="unit global-result" data-global-section="${h(entity.id)}" data-global-field="${h(field.name)}" aria-label="${h(info.label)}，${h(entity.name)}，${h(field.name)}"><span class="unit-icon">${icon('global', 19)}</span><span class="unit-info"><span class="unit-name">${h(info.label)}</span><span class="unit-id">[${h(entity.id)}] · ${h(field.name)} = ${h(field.value)}</span></span><span class="unit-chevron">${icon('chevron', 14)}</span></button>`).join('');
  return {
    count: filtered.length + globalFields.length,
    markup: `${list}${fieldList ? `<div class="search-group-title">匹配的全局参数 <span>${globalFields.length}</span></div>${fieldList}` : ''}${!list && !fieldList ? '<div class="empty-list">没有找到匹配的对象或全局参数。<br>试试其他关键词或导入完整的规则文件。</div>' : ''}${remaining ? `<button class="load-more" data-action="load-more">显示更多 <span>还有 ${remaining} 项</span></button>` : ''}`,
  };
}

function refreshLibraryResults() {
  const results = libraryResults();
  app.querySelector('.library-title span').textContent = `${results.count} ITEMS`;
  app.querySelector('.list-meta span').textContent = state.search.trim() ? '搜索结果' : '对象列表';
  const list = app.querySelector('.unit-list');
  list.innerHTML = results.markup;
  list.scrollTop = 0;
  observeIcons();
}

function render({ resetList = false, viewOverride = null } = {}) {
  clearTimeout(renderTimer);
  renderPending = false;
  const view = viewOverride || captureView();
  state.entities = buildEntities();
  const owners = unique(state.entities.flatMap(item => item.owner.split(',').map(value => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const ownerChoices = countriesFor(state.project, state.resources?.strings, '', owners, state.resources?.clientSides);
  const ownerKeys = new Set(ownerChoices.map(option => lower(option.id)));
  if (state.owner && (state.owner.startsWith('@side:') ? !state.project.get('Sides', state.owner.slice(6)) : !ownerKeys.has(lower(state.owner)))) state.owner = '';
  const ownerGroups = new Map();
  for (const option of ownerChoices) {
    if (!ownerGroups.has(option.group)) ownerGroups.set(option.group, []);
    ownerGroups.get(option.group).push(option);
  }
  if (state.owner.startsWith('@side:') && ![...ownerGroups.values()].some(options => lower(options[0]?.side) === lower(state.owner.slice(6)))) state.owner = '';
  const ownerOptions = [...ownerGroups.entries()].map(([group, options]) => {
    const side = options[0]?.side;
    const groupOption = side ? `<option value="@side:${h(side)}" ${lower(state.owner) === lower(`@side:${side}`) ? 'selected' : ''}>整个${h(group)}</option>` : '';
    return `<optgroup label="${h(group)}">${groupOption}${options.map(option => `<option value="${h(option.id)}" ${lower(state.owner) === lower(option.id) ? 'selected' : ''}>${h(option.label)}${lower(option.label) === lower(option.id) ? '' : ` · ${h(option.id)}`}</option>`).join('')}</optgroup>`;
  }).join('');
  let selected = entityFor(state.selected, state.selectedType) || entityFor(state.selected);
  if (!selected && state.selected) { state.selected = ''; state.selectedType = ''; }
  const changes = markChanges();
  state.changedSections = new Set(changes.map(change => lower(change.section)));
  const library = libraryResults();
  const main = state.project.resolve(state.project.mainPath);
  const projectName = state.demo ? 'DEMO PROJECT' : main ? sourceName(main) : state.project.mainPath;
  const nav = CATEGORIES.map(cat => `<button class="nav-btn ${state.category === cat.id ? 'active' : ''}" data-category="${cat.id}" title="${cat.label}" ${state.category === cat.id ? 'aria-current="page"' : ''}>${icon(cat.icon, 16)}<span class="nav-text">${cat.label}</span><span class="count">${count(cat.id)}</span></button>`).join('');
  const mainOptions = state.project.files.map(file => `<option value="${h(file.path)}" ${file.path === state.project.mainPath ? 'selected' : ''}>${h(sourceName(file))}</option>`).join('');
  app.innerHTML = `<div class="app ${desktop.isDesktop ? 'desktop-shell' : ''}">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">${icon('logo', 22)}</span><div class="brand-copy"><div class="brand-name">规则工作台</div><div class="brand-sub">MENTAL OMEGA / EDITOR</div></div></div>
      <div class="side-label">规则对象 / OBJECTS</div><nav class="nav" aria-label="对象分类">${nav}</nav><div class="side-rule"></div>
      <div class="side-foot"><div class="local-card"><div class="local-card-title"><span class="dot"></span> 本地处理</div><p>${desktop.isDesktop ? '规则和资源在本机处理；保存前自动备份原文件。' : '文件仅在浏览器中读取。导出时不会覆盖你的原文件。'}</p></div><div class="version">RULES WORKBENCH &nbsp; / &nbsp; V0.1</div></div>
    </aside>
    <main class="main">
      <header class="topbar"><div class="topbar-context"><div class="navigation-controls" aria-label="浏览历史"><button type="button" data-action="nav-back" aria-label="返回" title="返回（Alt+←）" ${navigation.index > 0 ? '' : 'disabled'}>←</button><button type="button" data-action="nav-forward" aria-label="前进" title="前进（Alt+→）" ${navigation.index >= 0 && navigation.index < navigation.entries.length - 1 ? '' : 'disabled'}>→</button></div><div class="crumb"><strong>工作区</strong><span class="slash">/</span><span>规则编辑</span><span class="slash">/</span><span>${h(projectName)}</span></div></div>
        <div class="top-actions"><button class="btn plain" data-action="folder">${icon('folder', 15)}<span class="label-optional">${desktop.isDesktop ? '选择游戏目录' : '导入文件夹'}</span><span class="mobile-only" hidden>文件夹</span></button><button class="btn" data-action="open">${icon('upload', 15)} 打开文件</button>${desktop.isDesktop ? `<button class="btn" data-action="history" ${state.desktopSession ? '' : 'disabled'}>历史版本</button><button class="btn" data-action="save-as" ${state.desktopSession ? '' : 'disabled'}>另存为</button><button class="btn" data-action="changes">查看修改 <span class="badge-count">${changes.length}</span></button><button class="btn primary" data-action="save" ${state.desktopSession ? '' : 'disabled'}>保存</button>` : `<button class="btn primary" data-action="changes">${icon('download', 15)} 查看修改 <span class="badge-count">${changes.length}</span></button>`}</div>
      </header>
      <div class="content"><div class="intro"><div><div class="eyebrow">RULES WORKBENCH</div><h1>心灵终结规则编辑器</h1><p>让每一项规则清晰可查，从一个单位开始调整。</p></div><label class="project-badge"><span class="dot"></span> 主文件 <select id="main-select" aria-label="选择主规则文件">${mainOptions}</select></label></div>
      ${noticeMarkup()}
      <div class="workspace"><section class="library" aria-label="对象列表"><div class="library-head"><div class="library-title"><h2>${h(labelFor(state.category) === '对象' ? '全部对象' : labelFor(state.category))}</h2><span>${library.count} ITEMS</span></div><div class="search-wrap">${icon('search', 15)}<input class="search" id="search" type="search" placeholder="搜索对象或全局参数..." value="${h(state.search)}" aria-label="搜索对象或全局参数"></div>${state.category === 'all' || unitTypes.has(state.category) ? `<select id="owner-filter" class="owner-filter" aria-label="按所属方筛选"><option value="">全部所属方</option>${ownerOptions}</select>` : ''}</div><div class="list-meta"><span>${state.search.trim() ? '搜索结果' : '对象列表'}</span><span>NAME / ID</span></div><div class="unit-list">${library.markup}</div></section>
      <section class="detail" aria-label="对象详情">${selected ? renderDetail(selected) : '<div class="no-detail"><div><strong>选择一个规则对象</strong>从左侧列表中选择，或导入包含单位列表的规则文件。</div></div>'}</section></div>
      <div class="footer-note"><span>已加载 ${state.project.loadOrder.length} 次文件 · ${state.demo ? '演示项目' : '本地项目'}</span><code>LOCAL FILES / NO GAME ASSETS INCLUDED</code></div>
      </div>
    </main></div>`;
  restoreView(view, resetList);
  updateNavigationControls();
  observeIcons();
}

function renderDetail(entity) {
  if (['global', 'sections'].includes(entity.type)) return trailMarkup() + renderGlobal(entity);
  const project = state.project;
  const sec = project.section(entity.id);
  const tab = state.tab;
  const detailBody = !sec ? `<div class="no-detail"><div><strong>找不到这个对象的定义</strong>它被列入类型列表，但当前导入的文件中没有 [${h(entity.id)}]。<br>请检查是否缺少 include 文件。</div></div>` : tab === 'basic' ? renderBasic(entity) : tab === 'relations' ? renderRelations(entity) : renderRaw(entity);
  return `${trailMarkup()}<div class="detail-top"><div class="detail-kicker">OBJECT DETAILS <span>/</span> ${h(entity.type.toUpperCase())}</div><div class="detail-hero"><div class="detail-icon" data-icon-id="${h(entity.id)}">${icon(entity.type, 32)}</div><div class="detail-name"><h2>${h(sectionTitle(entity))}</h2><p>[${h(entity.id)}] &nbsp; / &nbsp; ${h(labelFor(entity.type))}${entity.originalName && entity.name !== entity.originalName ? ` &nbsp; / &nbsp; ${h(entity.originalName)}` : ''}</p></div><div class="hero-status">${entity.exists ? '● 已解析' : '○ 未定义'}${state.changedSections.has(lower(entity.id)) ? ' <span class="hero-dirty">· 有修改</span>' : ''}</div></div><div class="tabs" role="tablist"><button role="tab" aria-selected="${tab === 'basic'}" class="tab ${tab === 'basic' ? 'active' : ''}" data-tab="basic">基础属性</button><button role="tab" aria-selected="${tab === 'relations'}" class="tab ${tab === 'relations' ? 'active' : ''}" data-tab="relations">关联关系</button><button role="tab" aria-selected="${tab === 'raw'}" class="tab ${tab === 'raw' ? 'active' : ''}" data-tab="raw">全部属性 ${sec ? `<span style="font:10px var(--mono);opacity:.7">${sec.fields.size}</span>` : ''}</button></div></div>${detailBody}`;
}

const unitBasic = ['Strength', 'Cost', 'Speed', 'Sight', 'Armor', 'TechLevel'];
const unitAdvanced = ['Owner', 'Prerequisite', 'Primary', 'Secondary'];
const weaponBasic = ['Damage', 'ROF', 'Range', 'Burst', 'Projectile', 'Warhead'];
const warheadBasic = ['CellSpread', 'PercentAtMax', 'InfDeath'];
const superweaponBasic = ['Type', 'RechargeTime', 'Action', 'Money.Amount', 'IsPowered', 'ShowTimer', 'DisableableFromShell', 'SW.InitialReady', 'SW.AutoFire', 'SW.FireIntoShroud'];
const superweaponEffects = ['SW.Range', 'SW.Damage', 'SW.Warhead', 'SW.Deferment', 'SW.RangeMinimum', 'SW.RangeMaximum', 'SW.AffectsHouse', 'SW.AffectsTarget', 'SW.AITargeting', 'SW.RequiredHouses', 'SW.ForbiddenHouses'];

function fieldInfoFor(entity, key) {
  let target = entity;
  if (entity.type === 'sections') {
    target = state.entities.find(item => item.type !== 'sections' && lower(item.id) === lower(entity.id)) || entity;
  }
  return getFieldInfo(key, { type: target.type, section: entity.id, globalKind: target.globalKind });
}

function fieldNameMarkup(info, key, className = 'field-label', extraTitle = '') {
  const title = [info.description, extraTitle].filter(Boolean).join('\n');
  const text = info.known ? `<span>${h(info.label)}</span><span class="field-separator" aria-hidden="true"> / </span><code>${h(key)}</code>` : `<code>${h(key)}</code>`;
  const help = info.description ? '<span class="field-help" aria-hidden="true">i</span>' : '';
  return `<span class="${className}"${title ? ` title="${h(title)}"` : ''}>${text}${help}</span>`;
}

function choicesFor(kind, value) {
  if (kind === 'armor') return armorsFor(state.project, value);
  if (kind === 'side') return sidesFor(state.project, value);
  if (kind === 'prerequisite') return prerequisitesFor(state.project, state.resources?.strings, value);
  if (kind === 'superweapon' || kind === 'superweapons') {
    const choices = state.entities.filter(item => item.type === 'superweapon').map(item => ({ id: item.id, label: item.name, group: '已注册超级武器' }));
    const known = new Set(choices.map(item => lower(item.id)));
    for (const id of value.split(',').map(item => item.trim()).filter(Boolean)) if (!known.has(lower(id))) {
      choices.push({ id, label: id, group: '当前未登记的代码' });
      known.add(lower(id));
    }
    return choices;
  }
  const owners = state.entities.filter(item => unitTypes.has(item.type)).flatMap(item => item.owner.split(',').map(part => part.trim()).filter(Boolean));
  return countriesFor(state.project, state.resources?.strings, value, owners, state.resources?.clientSides);
}

function choiceField(entity, key, info, kind, field) {
  const raw = field?.value || '';
  const values = ['armor', 'side', 'superweapon'].includes(kind) ? (raw ? [raw] : []) : raw.split(',').map(part => part.trim()).filter(Boolean);
  const choices = new Map(choicesFor(kind, raw).map(option => [lower(option.id), option]));
  const chips = values.slice(0, 4).map(value => {
    const option = choices.get(lower(value));
    const text = option?.label || value;
    return `<span class="choice-chip">${h(text)}${lower(text) === lower(value) ? '' : ` <small>${h(value)}</small>`}</span>`;
  }).join('');
  const source = field ? `${sourceName(field.file)}${field.line.patch !== undefined ? ' · 已修改' : ''}` : '未定义 · 可选择添加';
  const control = `<button type="button" class="choice-trigger ${field?.line.patch !== undefined ? 'is-modified' : ''}" data-action="choose-options" data-kind="${kind}" data-key="${h(key)}" aria-label="选择${h(info.label)}"${info.description ? ` aria-description="${h(info.description)}"` : ''}><span class="choice-chips">${chips || '<span class="choice-placeholder">未设置，点击选择</span>'}${values.length > 4 ? `<span class="choice-more">+${values.length - 4}</span>` : ''}</span><span class="choice-arrow">${icon('chevron', 14)}</span></button>`;
  const reference = kind === 'superweapon' ? fieldReferenceMarkup(entity, key, raw) : '';
  return `<div class="field"${info.description ? ` title="${h(info.description)}"` : ''}>${fieldNameMarkup(info, key)}${reference ? `<div class="value-control">${control}${reference}</div>` : control}<div class="field-source ${field?.line.patch !== undefined ? 'changed' : ''}" title="${h(source)}">${h(source)}</div></div>`;
}

function fieldReference(entity, key, value) {
  const actual = entity.type === 'sections' ? state.entities.find(item => item.type !== 'sections' && lower(item.id) === lower(entity.id)) : entity;
  if (!actual) return null;
  let type = '';
  if (unitTypes.has(actual.type) && weaponKey(key)) type = 'weapon';
  else if (unitTypes.has(actual.type) && /^(superweapon|superweapon2)$/i.test(key)) type = 'superweapon';
  else if (actual.type === 'weapon' && /^(warhead|ivanbomb\.warhead)$/i.test(key)) type = 'warhead';
  else if (actual.type === 'superweapon' && /^sw\.warhead$/i.test(key)) type = 'warhead';
  else if (actual.type === 'superweapon' && /^(weapontype|nuke\.payload)$/i.test(key)) type = 'weapon';
  if (!type) return null;
  let id = String(value || '').trim();
  let isDefault = false;
  if (!id && actual.type === 'weapon' && lower(key) === 'ivanbomb.warhead') {
    const reference = weaponWarheadReferences(state.project, actual.id).find(ref => ref.key === 'IvanBomb.Warhead' && ref.source === 'global');
    if (reference) { id = reference.id; isDefault = true; }
  }
  if (!id || /^(?:none|<none>)$/i.test(id)) return null;
  const target = entityFor(id, type);
  if (!target) return null;
  const info = fieldInfoFor(actual, key);
  return { id: target.id, type, name: target.name, isDefault, via: `${info.label} / ${key}${isDefault ? '（全局默认）' : ''}` };
}

function fieldReferenceMarkup(entity, key, value) {
  const reference = fieldReference(entity, key, value);
  if (!reference) return '';
  return `<button type="button" class="reference-button" data-jump-field="${h(key)}" data-type="${h(reference.type)}" aria-label="查看 ${h(reference.via)}：${h(reference.name)}" title="${h(reference.isDefault ? '查看当前全局默认弹头：' : '查看关联配置：')}${h(reference.name)} [${h(reference.id)}]">${reference.isDefault ? '查看默认' : '查看'}</button>`;
}

function fieldMarkup(entity, key) {
  const field = state.project.get(entity.id, key);
  const info = fieldInfoFor(entity, key);
  const label = info.label;
  if (unitTypes.has(entity.type) && lower(key) === 'armor') return choiceField(entity, key, info, 'armor', field);
  if (unitTypes.has(entity.type) && /^(superweapon|superweapon2|superweapons)$/i.test(key)) return choiceField(entity, key, info, lower(key) === 'superweapons' ? 'superweapons' : 'superweapon', field);
  if (entity.type === 'global' && entity.globalKind === 'country' && lower(key) === 'side') return choiceField(entity, key, info, 'side', field);
  if ((unitTypes.has(entity.type) && /^(owner|requiredhouses|forbiddenhouses)$/i.test(key)) || (entity.type === 'superweapon' && /^sw\.(requiredhouses|forbiddenhouses)$/i.test(key)) || (entity.type === 'global' && lower(entity.id) === 'sides')) return choiceField(entity, key, info, 'country', field);
  if (unitTypes.has(entity.type) && lower(key) === 'prerequisite') return choiceField(entity, key, info, 'prerequisite', field);
  const source = field ? `${sourceName(field.file)}${field.line.patch !== undefined ? ' · 已修改' : ''}` : '未定义 · 输入后添加';
  const raw = field?.value || '';
  const modified = field?.line.patch !== undefined ? 'is-modified' : '';
  let control;
  if (['global', 'sections', 'superweapon'].includes(entity.type) && /^(yes|no|true|false)$/i.test(raw)) {
    const yesNo = /^(yes|no)$/i.test(raw), positive = yesNo ? 'yes' : 'true', negative = yesNo ? 'no' : 'false';
    const truthy = /^(yes|true)$/i.test(raw);
    control = `<select class="${modified}" data-field="${h(key)}" aria-label="${h(label)}"${info.description ? ` aria-description="${h(info.description)}"` : ''}><option value="${h(truthy ? raw : positive)}" ${truthy ? 'selected' : ''}>是</option><option value="${h(truthy ? negative : raw)}" ${truthy ? '' : 'selected'}>否</option></select>`;
  } else {
    control = `<div class="value-control"><input class="${modified}" data-field="${h(key)}" aria-label="${h(label)}"${info.description ? ` aria-description="${h(info.description)}"` : ''} value="${h(raw)}" placeholder="未定义" autocomplete="off" spellcheck="false">${fieldReferenceMarkup(entity, key, raw)}${raw.includes(',') ? `<button type="button" class="split-button" data-action="edit-list" data-key="${h(key)}" aria-label="分项编辑${h(label)}">分项</button>` : ''}</div>`;
  }
  return `<div class="field"${info.description ? ` title="${h(info.description)}"` : ''}>${fieldNameMarkup(info, key)}${control}<div class="field-source ${field?.line.patch !== undefined ? 'changed' : ''}" title="${h(source)}">${h(source)}</div></div>`;
}

function renderGlobal(entity) {
  const fields = [...state.project.section(entity.id).fields.values()];
  const infoFor = field => fieldInfoFor(entity, field.name);
  const common = fields.filter(field => infoFor(field).known);
  const other = fields.filter(field => !infoFor(field).known);
  const q = lower(state.globalSearch.trim());
  const row = field => {
    const info = infoFor(field);
    const search = lower([info.label, field.name, field.value, ...info.aliases].join(' '));
    return `<div data-global-row data-search-text="${h(search)}" ${q && !search.includes(q) ? 'hidden' : ''}>${fieldMarkup(entity, field.name)}${info.inlineHint ? `<p class="global-field-hint">${h(info.description)}</p>` : ''}</div>`;
  };
  const hint = lower(entity.id) === 'multiplayerdialogsettings' ? '游戏模式或启动器可能覆盖这些默认值。' : '显示当前规则段中的全部已定义参数。';
  return `<div class="detail-top"><div class="detail-kicker">${entity.type === 'global' ? 'GLOBAL SETTINGS' : 'RULE SECTION'} <span>/</span> ${h(entity.id.toUpperCase())}</div><div class="detail-hero"><div class="detail-icon">${icon('global', 32)}</div><div class="detail-name"><h2>${h(entity.name)}</h2><p>[${h(entity.id)}] &nbsp; / &nbsp; ${fields.length} 个参数</p></div><div class="hero-status">${state.changedSections.has(lower(entity.id)) ? '● 有修改' : '● 已解析'}</div></div></div><div class="detail-body"><div class="section-head"><div><h3>${h(entity.description || '全局规则')}</h3><p>${h(hint)}</p></div><button type="button" class="btn sm" data-action="add-field">＋ 添加字段</button></div><div class="search-wrap global-search-wrap">${icon('search', 15)}<input class="search" id="global-search" type="search" value="${h(state.globalSearch)}" placeholder="在此设置中搜索名称、字段或值..." aria-label="搜索全局参数"></div>${common.length ? `<div class="global-group-title">常用设置 <span>${common.length}</span></div><div class="field-grid global-grid">${common.map(row).join('')}</div>` : ''}<div class="global-group-title">${common.length ? '其他参数' : '全部参数'} <span>${other.length}</span></div><div class="field-grid global-grid">${other.map(row).join('')}</div></div>`;
}

function renderVerses(entity) {
  const field = state.project.get(entity.id, 'Verses');
  const values = field?.value ? field.value.split(',') : [];
  const original = field?.line.originalValue ? field.line.originalValue.split(',') : [];
  const source = field ? `${sourceName(field.file)}${field.line.patch !== undefined ? ' · 已修改' : ''}` : '未定义';
  const versesInfo = fieldInfoFor(entity, 'Verses');
  const inputs = STANDARD_ARMORS.map((armor, index) => {
    const info = { ...versesInfo, label: `${armor.label}（${armor.id}）`, description: `${versesInfo.description} 此项为第 ${index + 1} 项。` };
    return `<label class="verses-item" title="${h(info.description)}">${fieldNameMarkup(info, 'Verses', 'verses-field-label')}<input class="${field?.line.patch !== undefined && values[index]?.trim() !== original[index]?.trim() ? 'is-modified' : ''}" data-verses-index="${index}" aria-label="${h(armor.label)}伤害修正" aria-description="${h(info.description)}" value="${h(values[index]?.trim() || '')}" placeholder="未设置" inputmode="decimal" autocomplete="off" spellcheck="false"></label>`;
  }).join('');
  const custom = new Map([...(state.project.section('ArmorTypes')?.fields.values() || [])].map(item => [lower(item.name), { id: item.name, base: item.value }]));
  for (const item of state.project.section(entity.id)?.fields.values() || []) {
    const match = item.name.match(/^Versus\.([^.]+)$/i);
    if (match && !custom.has(lower(match[1]))) custom.set(lower(match[1]), { id: match[1], base: '' });
  }
  const explicit = [...custom.values()].filter(item => state.project.get(entity.id, `Versus.${item.id}`)).length;
  const q = lower(state.armorSearch.trim());
  const rows = [...custom.values()].map(item => {
    const key = `Versus.${item.id}`, override = state.project.get(entity.id, key);
    const info = fieldInfoFor(entity, key);
    const search = lower(`${item.id} ${item.base} ${override?.value || ''}`);
    return `<label class="armor-override-row" data-armor-row data-search-text="${h(search)}" title="${h(info.description)}" ${q && !search.includes(q) ? 'hidden' : ''}><span>${fieldNameMarkup(info, key, 'armor-field-label')}<small>${item.base ? `默认：${h(item.base)}` : '未找到默认定义'}</small></span><input data-field="${h(key)}" aria-label="${h(item.id)}伤害修正" aria-description="${h(info.description)}" class="${override?.line.patch !== undefined ? 'is-modified' : ''}" value="${h(override?.value || '')}" placeholder="沿用默认" autocomplete="off" spellcheck="false"></label>`;
  }).join('');
  return `<div class="section-head"><div><h3>装甲伤害修正</h3><p>按原版 11 类装甲顺序显示；未设置的项不会自动填充。0%、1%、2% 还可能影响选敌和开火行为。</p></div><span class="section-num">VERSES</span></div><div class="verses-grid">${inputs}</div><div class="field-source" title="${h(source)}">来源：${h(source)}${values.length > 11 ? ` · 另有 ${values.length - 11} 项原始值保留在全部属性中` : ''}</div>${custom.size ? `<details class="armor-overrides" id="armor-overrides" ${state.armorOpen ? 'open' : ''}><summary><span>扩展装甲修正 <small>已单独设置 ${explicit} / ${custom.size}</small></span>${icon('chevron', 14)}</summary><div class="armor-overrides-content"><p>留空表示没有单独设置；默认值由装甲定义及其他规则决定。</p><div class="search-wrap">${icon('search', 15)}<input class="search" id="armor-search" type="search" value="${h(state.armorSearch)}" placeholder="搜索扩展装甲代码..." aria-label="搜索扩展装甲"></div><div class="armor-overrides-list">${rows}</div></div></details>` : ''}`;
}

function renderBasic(entity) {
  const isUnit = unitTypes.has(entity.type);
  const fields = entity.type === 'weapon' ? weaponBasic : entity.type === 'warhead' ? warheadBasic : entity.type === 'superweapon' ? superweaponBasic : unitBasic;
  const title = isUnit ? '单位属性' : entity.type === 'weapon' ? '武器属性' : entity.type === 'superweapon' ? '超级武器属性' : '弹头属性';
  let body = `<div class="detail-body">${usageMarkup(entity)}<div class="section-head"><div><h3>${title}</h3><p>编辑现有值，或为未定义的属性添加值。</p></div><span class="section-num">01 / GENERAL</span></div><div class="field-grid">${fields.map(key => fieldMarkup(entity, key)).join('')}</div>`;
  if (isUnit) {
    const extraHouses = ['RequiredHouses', 'ForbiddenHouses'].filter(key => state.project.get(entity.id, key));
    body += `<div class="block-divider"></div><div class="section-head"><div><h3>建造与武装</h3><p>选择国家和建造条件；实际可建造性还受其他规则影响。</p></div><span class="section-num">02 / LOADOUT</span></div><div class="field-grid">${[...unitAdvanced, ...extraHouses].map(key => fieldMarkup(entity, key)).join('')}</div>`;
    const granted = ['SuperWeapon', 'SuperWeapon2', 'SuperWeapons'];
    if (entity.type === 'building' || granted.some(key => state.project.get(entity.id, key))) {
      body += `<div class="block-divider"></div><div class="section-head"><div><h3>提供的超级武器</h3><p>选择此对象提供的超级武器；具体可用性还受其他规则限制。</p></div></div><div class="field-grid">${granted.map(key => fieldMarkup(entity, key)).join('')}</div>`;
    }
  }
  if (entity.type === 'weapon') {
    const existing = [...state.project.section(entity.id).fields.values()].filter(field => /^IvanBomb\./i.test(field.name));
    if (existing.length || usesIvanBomb(state.project, entity.id)) {
      const keys = ['IvanBomb.Warhead', 'IvanBomb.Damage', 'IvanBomb.Delay'];
      for (const field of existing) if (!keys.some(key => lower(key) === lower(field.name))) keys.push(field.name);
      const fallback = weaponWarheadReferences(state.project, entity.id).find(ref => ref.key === 'IvanBomb.Warhead' && ref.source === 'global');
      const note = fallback ? `未单独设置炸弹弹头，当前使用 [CombatDamage]IvanWarhead = ${fallback.id}。` : '未单独设置的炸弹参数使用游戏或全局默认值。';
      body += `<div class="block-divider"></div><div class="section-head"><div><h3>附着炸弹</h3><p>直接命中弹头需启用 IvanBomb=yes 才会应用炸弹效果。${h(note)}</p></div></div><div class="field-grid">${keys.map(key => fieldMarkup(entity, key)).join('')}</div>`;
    }
  }
  if (entity.type === 'superweapon') body += `<div class="block-divider"></div><div class="section-head"><div><h3>效果与限制</h3><p>未定义的值由游戏或武器类型决定；不同类型支持的参数可能不同。</p></div><span class="section-num">02 / EFFECTS</span></div><div class="field-grid">${superweaponEffects.map(key => fieldMarkup(entity, key)).join('')}</div>`;
  if (entity.type === 'warhead') body += `<div class="block-divider"></div>${renderVerses(entity)}`;
  body += `<div class="source-bar">${icon('shield', 16)}<div><strong>保留原文件结构</strong><br>${state.desktopSession ? '保存前自动备份来源文件；MIX 内的规则保存为独立 INI，不修改资源包。' : '已有属性在来源规则中修改；MIX 内的规则会导出为独立 INI，不修改资源包。'}</div></div></div>`;
  return body;
}
function referencesTo(id) {
  const users = [];
  for (const entity of state.entities.filter(item => unitTypes.has(item.type))) {
    const section = state.project.section(entity.id);
    if (section && [...section.fields.values()].some(field => weaponKey(field.name) && lower(field.value.trim()) === lower(id))) users.push(entity);
  }
  return users;
}
function weaponsReferencingWarhead(id) {
  return state.entities.filter(item => item.type === 'weapon').map(weapon => ({
    weapon, refs: weaponWarheadReferences(state.project, weapon.id).filter(ref => lower(ref.id) === lower(id)),
  })).filter(item => item.refs.length);
}
function superweaponsReferencing(id, keys) {
  return state.entities.filter(item => item.type === 'superweapon').map(superweapon => ({
    superweapon, keys: keys.filter(key => lower(val(superweapon.id, key).trim()) === lower(id)),
  })).filter(item => item.keys.length);
}
function usageMarkup(entity) {
  if (!['weapon', 'warhead'].includes(entity.type)) return '';
  const weapon = entity.type === 'weapon';
  const count = weapon ? referencesTo(entity.id).length : weaponsReferencingWarhead(entity.id).length;
  const supers = superweaponsReferencing(entity.id, weapon ? ['WeaponType', 'Nuke.Payload'] : ['SW.Warhead']).length;
  return `<div class="usage-notice">${icon('info', 15)}<div><strong>已识别 ${count} 个${weapon ? '对象' : '武器'}${supers ? `、${supers} 个超级武器` : ''}${weapon ? '使用此武器' : '引用此弹头'}</strong><p>修改配置可能影响这些使用者；特殊规则可能未列出。</p></div>${count || supers ? '<button type="button" class="text-action" data-action="show-referrers">查看引用</button>' : ''}</div>`;
}
function grantedSuperweapons(entity) {
  return ['SuperWeapon', 'SuperWeapon2', 'SuperWeapons'].flatMap(key => val(entity.id, key).split(',')
    .map(id => id.trim()).filter(id => id && !/^(?:none|<none>)$/i.test(id)).map(id => ({ id, key })));
}
function refMarkup(title, id, type, source = null) {
  const target = entityFor(id, type) || entityFor(id);
  const heading = source ? fieldNameMarkup(fieldInfoFor(source.entity, source.key), source.key, 'ref-title', source.note) : `<div class="ref-title">${h(title)}</div>`;
  const via = source ? `${fieldInfoFor(source.entity, source.key).label} / ${source.key}${source.note ? `（${source.note}）` : ''}` : title;
  const name = target && lower(target.name) !== lower(target.id) ? ` · ${h(target.name)}` : '';
  return `<div class="ref"><div class="ref-icon">${icon(type || 'link', 16)}</div><div>${heading}<div class="ref-code">${h(id || '未设置')}${name}</div>${source?.note ? `<div class="field-source">${h(source.note)}</div>` : ''}</div>${target ? `<button class="btn sm" data-jump="${h(target.id)}" data-type="${h(target.type)}" data-via="${h(via)}">查看 ${icon('chevron', 12)}</button>` : ''}</div>`;
}
function renderRelations(entity) {
  let items = '';
  let description = '';
  if (entity.type === 'weapon') {
    const users = referencesTo(entity.id);
    const supers = superweaponsReferencing(entity.id, ['WeaponType', 'Nuke.Payload']);
    description = `根据已加载对象的常用武器字段和超级武器设置，发现 ${users.length} 个对象及 ${supers.length} 个超级武器引用；其他特殊武器逻辑可能未列出。`;
    items = refMarkup('弹头', val(entity.id, 'Warhead'), 'warhead', { entity, key: 'Warhead' });
    const bomb = weaponWarheadReferences(state.project, entity.id).find(ref => ref.key === 'IvanBomb.Warhead');
    if (bomb) items += refMarkup('', bomb.id, 'warhead', { entity, key: bomb.key, note: bomb.source === 'global' ? '沿用 [CombatDamage]IvanWarhead' : '' });
    if (users.length || supers.length) items += `<div class="block-divider"></div><div class="section-head" data-ref-users><div><h3>使用此武器的对象</h3><p>修改武器可能同时影响这些对象。</p></div></div>` + users.map(user => refMarkup(labelFor(user.type), user.id, user.type)).join('') + supers.map(({ superweapon, keys }) => refMarkup(`超级武器 · ${keys.join('、')}`, superweapon.id, 'superweapon')).join('');
  } else if (entity.type === 'warhead') {
    const weapons = weaponsReferencingWarhead(entity.id);
    const supers = superweaponsReferencing(entity.id, ['SW.Warhead']);
    description = `根据已加载的规则，发现 ${weapons.length} 个武器和 ${supers.length} 个超级武器引用此弹头；包括直接命中弹头和炸弹弹头。`;
    items = (weapons.length || supers.length ? '<div class="section-head" data-ref-users><div><h3>引用此弹头的对象</h3></div></div>' : '') + (weapons.map(({ weapon, refs }) => {
      const roles = refs.map(ref => `${fieldInfoFor(weapon, ref.key).label}${ref.source === 'global' ? '（全局默认）' : ''}`).join('、');
      return refMarkup(`武器 · ${roles}`, weapon.id, 'weapon');
    }).join('') + supers.map(({ superweapon }) => refMarkup('超级武器 · SW.Warhead', superweapon.id, 'superweapon')).join('') || '<p class="ref-note">当前没有发现关联对象。</p>');
  } else if (entity.type === 'superweapon') {
    const providers = state.entities.filter(item => unitTypes.has(item.type) && grantedSuperweapons(item).some(ref => lower(ref.id) === lower(entity.id)));
    description = `根据已加载对象的 SuperWeapon、SuperWeapon2 和 SuperWeapons 字段，发现 ${providers.length} 个提供对象；其他规则也可能影响可用性。`;
    const linked = [['SW.Warhead', '效果弹头', 'warhead'], ['WeaponType', '发射武器', 'weapon'], ['Nuke.Payload', '载荷武器', 'weapon']];
    items = linked.filter(([key]) => val(entity.id, key) && !/^(?:none|<none>)$/i.test(val(entity.id, key))).map(([key, label, type]) => refMarkup(label, val(entity.id, key), type, { entity, key })).join('');
    if (providers.length) items += providers.map(provider => refMarkup(`提供对象 · ${provider.name}`, provider.id, provider.type)).join('');
    if (!items) items = '<p class="ref-note">当前没有发现直接关联的对象。</p>';
  } else {
    description = '沿着对象、武器和弹头之间的引用查看配置。';
    const weapons = ['Primary','Secondary','ElitePrimary','EliteSecondary'];
    if (entity.type === 'infantry') weapons.push(...['OccupyWeapon','EliteOccupyWeapon'].filter(key => val(entity.id, key)));
    items = weapons.map(key => refMarkup('', val(entity.id,key), 'weapon', { entity, key })).join('');
    const primary = val(entity.id, 'Primary');
    const users = primary ? referencesTo(primary) : [];
    if (users.length > 1) items += `<div class="source-bar">${icon('info',16)}<div><strong>主武器被 ${users.length} 个已识别对象使用。</strong><br>修改武器定义可能同时影响它们。</div></div>`;
    const supers = grantedSuperweapons(entity);
    if (supers.length) items += `<div class="block-divider"></div>` + supers.map(ref => refMarkup('', ref.id, 'superweapon', { entity, key: ref.key })).join('');
  }
  return `<div class="detail-body"><div class="section-head"><div><h3>关联关系</h3><p>${h(description)}</p></div><span class="section-num">REFERENCES</span></div><div class="refs">${items}</div></div>`;
}
function renderRaw(entity) {
  const fields = [...state.project.section(entity.id).fields.values()];
  return `<div class="detail-body"><div class="section-head"><div><h3>全部已解析属性</h3><p>未知字段同样保留；只会修改你编辑的值。</p></div><span class="section-num">${fields.length} KEYS</span></div><div class="raw-list">${fields.map(field => {
    const info = fieldInfoFor(entity, field.name);
    return `<div class="raw-row"${info.description ? ` title="${h(info.description)}"` : ''}>${fieldNameMarkup(info, field.name, 'raw-key', `来源：${sourceName(field.file)}`)}<div class="value-control"><input class="${field.line.patch !== undefined ? 'is-modified' : ''}" data-field="${h(field.name)}" aria-label="${h(info.label)}"${info.description ? ` aria-description="${h(info.description)}"` : ''} value="${h(field.value)}" autocomplete="off" spellcheck="false">${fieldReferenceMarkup(entity, field.name, field.value)}${field.value.includes(',') ? `<button type="button" class="split-button" data-action="edit-list" data-key="${h(field.name)}" aria-label="分项编辑 ${h(info.label)}">分项</button>` : ''}</div></div>`;
  }).join('')}</div></div>`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('visible'), 4500);
}
function selectEntity(id, type, via = '关联') {
  let entity = entityFor(id, type) || entityFor(id);
  if (!entity) { state.entities = buildEntities(); entity = entityFor(id, type) || entityFor(id); }
  if (!entity) { showToast(`未找到关联对象 ${id}。`); return; }
  const before = captureNavigation();
  const source = entityFor(state.selected, state.selectedType) || entityFor(state.selected);
  const last = navigation.trail.at(-1);
  const path = source && last && lower(last.id) === lower(source.id) && last.type === source.type
    ? [...navigation.trail] : source ? [navigationNode(source)] : [];
  if (path.length) path[path.length - 1] = { ...path.at(-1), location: { location: before.location, view: before.view, label: before.label } };
  navigation.trail = [...path, navigationNode(entity, via)];
  if (navigation.trail.length > 64) {
    navigation.trail = navigation.trail.slice(-64);
    navigation.trail[0] = { ...navigation.trail[0], truncated: true };
  }
  state.category = ['weapon','warhead','superweapon','global','sections'].includes(entity.type) ? entity.type : 'all';
  state.search = '';
  state.owner = '';
  state.listLimit = 250;
  state.selected = entity.id;
  state.selectedType = entity.type;
  state.tab = 'basic';
  state.globalSearch = ''; state.armorSearch = ''; state.armorOpen = false;
  const index = filteredEntities().findIndex(item => lower(item.id) === lower(entity.id) && item.type === entity.type);
  if (index >= state.listLimit) state.listLimit = Math.ceil((index + 1) / 250) * 250;
  render({ resetList: true, viewOverride: { ...before.view, list: 0, detail: 0, armor: 0, trail: null, focus: null } });
  const list = app.querySelector('.unit-list'), selected = list?.querySelector('.unit.selected');
  if (list && selected) list.scrollTop += selected.getBoundingClientRect().top - list.getBoundingClientRect().top - Math.max(0, (list.clientHeight - selected.clientHeight) / 2);
  recordNavigation(before);
}

function refreshDetail(focusTab = false) {
  const entity = entityFor(state.selected, state.selectedType) || entityFor(state.selected);
  if (!entity) return;
  const x = window.scrollX, y = window.scrollY;
  const trailScroll = app.querySelector('.navigation-trail')?.scrollLeft;
  app.querySelector('.detail').innerHTML = renderDetail(entity);
  const trail = app.querySelector('.navigation-trail');
  if (trail) trail.scrollLeft = trailScroll ?? trail.scrollWidth;
  if (focusTab) app.querySelector(`[data-tab="${state.tab}"]`)?.focus({ preventScroll: true });
  window.scrollTo(x, y);
  observeIcons();
}

function selectListItem(button) {
  const changed = lower(state.selected) !== lower(button.dataset.entity) || state.selectedType !== button.dataset.type;
  const before = changed ? captureNavigation() : null;
  if (changed) {
    state.globalSearch = ''; state.armorSearch = ''; state.armorOpen = false;
    const entity = entityFor(button.dataset.entity, button.dataset.type);
    navigation.trail = entity ? [navigationNode(entity)] : [];
  }
  state.selected = button.dataset.entity;
  state.selectedType = button.dataset.type;
  state.tab = 'basic';
  app.querySelectorAll('[data-entity]').forEach(item => {
    const selected = item === button;
    item.classList.toggle('selected', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  refreshDetail();
  if (before) recordNavigation(before);
}

function selectGlobalField(section, key) {
  const entity = entityFor(section, 'global');
  const field = state.project.get(section, key);
  if (!entity || !field) return;
  const before = captureNavigation();
  navigation.trail = [navigationNode(entity)];
  state.category = 'global';
  state.owner = '';
  state.selected = entity.id;
  state.selectedType = entity.type;
  state.tab = 'basic';
  state.globalSearch = field.name;
  state.armorSearch = ''; state.armorOpen = false;
  render({ resetList: true });
  const detail = app.querySelector('.detail-body');
  if (detail) detail.scrollTop = 0;
  app.querySelector(`[data-field="${CSS.escape(field.name)}"]`)?.focus({ preventScroll: true });
  recordNavigation(before);
}

// A field can lose focus during pointerdown. Keep its click target mounted
// until pointerup and click have both been dispatched.
function scheduleRender() {
  renderPending = true;
  clearTimeout(renderTimer);
  if (!pointerDown && !composing) renderTimer = setTimeout(() => { if (!pointerDown && !composing && renderPending) render(); }, 0);
}
function finishPointer() {
  pointerDown = false;
  if (renderPending) scheduleRender();
}
window.addEventListener('pointerdown', () => { pointerDown = true; }, true);
window.addEventListener('pointerup', finishPointer, true);
window.addEventListener('pointercancel', finishPointer, true);
window.addEventListener('blur', finishPointer);
app.addEventListener('compositionstart', () => { composing = true; clearTimeout(renderTimer); });
app.addEventListener('compositionend', () => { composing = false; if (renderPending) scheduleRender(); });
window.addEventListener('beforeunload', event => {
  if (!nativeCloseApproved && state.project && markChanges().length) {
    event.preventDefault();
    event.returnValue = '';
  }
});
function navigateByShortcut(offset) {
  if (composing || app.inert || dialog.open || editorDialog.open || !navigation.entries[navigation.index + offset]) return;
  // Side buttons do not normally move focus, so commit an active input before leaving.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  moveNavigation(offset);
}
const mouseNavigationOffset = button => button === 3 ? -1 : button === 4 ? 1 : 0;
window.addEventListener('mousedown', event => {
  if (mouseNavigationOffset(event.button)) event.preventDefault();
}, true);
window.addEventListener('mouseup', event => {
  const offset = mouseNavigationOffset(event.button);
  if (!offset) return;
  event.preventDefault();
  navigateByShortcut(offset);
}, true);
window.addEventListener('auxclick', event => {
  if (mouseNavigationOffset(event.button)) event.preventDefault();
}, true);
window.addEventListener('keydown', event => {
  const arrow = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key);
  const browserKey = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && ['BrowserBack', 'BrowserForward'].includes(event.key);
  if (!arrow && !browserKey) return;
  event.preventDefault();
  if (!event.repeat && !event.isComposing) navigateByShortcut(event.key === 'ArrowLeft' || event.key === 'BrowserBack' ? -1 : 1);
});

function commitField(section, key, value) {
  const existing = state.project.get(section, key);
  if ((existing && existing.value === value) || (!existing && value === '')) return false;
  state.project.set(section, key, value);
  state.changedSections = new Set(markChanges().map(change => lower(change.section)));
  scheduleRender();
  return true;
}

app.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !app.contains(button)) return;
  if (button.dataset.category !== undefined) {
    const before = captureNavigation();
    state.category = button.dataset.category;
    state.search = '';
    state.listLimit = 250;
    if (state.category === 'superweapon') {
      const first = state.entities.find(item => item.type === 'superweapon' && item.exists) || state.entities.find(item => item.type === 'superweapon');
      state.selected = first?.id || ''; state.selectedType = first ? first.type : ''; state.tab = 'basic';
      state.globalSearch = ''; state.armorSearch = ''; state.armorOpen = false;
    } else if (state.category === 'global') {
      const first = state.entities.find(item => item.type === 'global');
      if (first) { state.selected = first.id; state.selectedType = first.type; state.tab = 'basic'; }
      else { state.selected = ''; state.selectedType = ''; }
      state.globalSearch = ''; state.armorSearch = ''; state.armorOpen = false;
    } else if (state.category === 'sections') {
      const first = state.project.sections.values().next().value;
      state.selected = first?.name || ''; state.selectedType = first ? 'sections' : ''; state.tab = 'basic';
      state.globalSearch = ''; state.armorSearch = ''; state.armorOpen = false;
    }
    const selected = entityFor(state.selected, state.selectedType) || (state.selected ? { id: state.selected, type: state.selectedType, name: state.selected } : null);
    navigation.trail = selected ? [navigationNode(selected)] : [];
    render({ resetList: true });
    if (before.trail.length > 1 || navigationKeys.some(key => before.location[key] !== state[key])) recordNavigation(before);
  } else if (button.dataset.globalField !== undefined) {
    selectGlobalField(button.dataset.globalSection, button.dataset.globalField);
  } else if (button.dataset.entity !== undefined) {
    selectListItem(button);
  } else if (button.dataset.tab !== undefined) {
    const hadFocus = document.activeElement === button;
    state.tab = button.dataset.tab;
    refreshDetail(hadFocus);
  } else if (button.dataset.trail !== undefined) {
    navigateTrail(Number(button.dataset.trail));
  } else if (button.dataset.jumpField !== undefined) {
    const entity = entityFor(state.selected, state.selectedType) || entityFor(state.selected);
    const key = button.dataset.jumpField;
    const value = entity && state.project.get(entity.id, key)?.value;
    let reference = entity && fieldReference(entity, key, value);
    if (entity && !reference) { state.entities = buildEntities(); reference = fieldReference(entity, key, value); }
    if (reference) selectEntity(reference.id, reference.type, reference.via);
    else showToast('当前字段没有可查看的关联对象。');
  } else if (button.dataset.jump !== undefined) {
    selectEntity(button.dataset.jump, button.dataset.type, button.dataset.via);
  } else if (button.dataset.action === 'nav-back') {
    moveNavigation(-1);
  } else if (button.dataset.action === 'nav-forward') {
    moveNavigation(1);
  } else if (button.dataset.action === 'show-referrers') {
    state.tab = 'relations';
    refreshDetail();
    const detail = app.querySelector('.detail-body'), target = detail?.querySelector('[data-ref-users]');
    if (detail && target) detail.scrollTop += target.getBoundingClientRect().top - detail.getBoundingClientRect().top;
  } else if (button.dataset.action === 'load-more') {
    state.listLimit += 250;
    render();
  } else if (button.dataset.action === 'choose-options') {
    openChoices(button.dataset.kind, button.dataset.key);
  } else if (button.dataset.action === 'edit-list') {
    openListEditor(button.dataset.key);
  } else if (button.dataset.action === 'add-field') {
    openAddField();
  } else if (button.dataset.action === 'open') fileInput.click();
  else if (button.dataset.action === 'folder') { if (desktop.isDesktop) openDesktopDirectory(); else folderInput.click(); }
  else if (button.dataset.action === 'changes') showChanges();
  else if (button.dataset.action === 'save') saveDesktopProject();
  else if (button.dataset.action === 'save-as') exportDesktopProject();
  else if (button.dataset.action === 'history') showDesktopHistory();
  else if (button.dataset.action === 'dismiss') { state.notice = false; render(); }
});

app.addEventListener('input', event => {
  if (event.target.id === 'search') {
    state.search = event.target.value;
    state.listLimit = 250;
    refreshLibraryResults();
  } else if (event.target.id === 'global-search' || event.target.id === 'armor-search') {
    const isGlobal = event.target.id === 'global-search';
    const query = lower(event.target.value.trim());
    if (isGlobal) state.globalSearch = event.target.value; else state.armorSearch = event.target.value;
    app.querySelectorAll(isGlobal ? '[data-global-row]' : '[data-armor-row]').forEach(row => { row.hidden = !!query && !row.dataset.searchText.includes(query); });
  }
});

app.addEventListener('toggle', event => {
  if (event.target.id === 'armor-overrides' && event.target.isConnected) state.armorOpen = event.target.open;
}, true);

app.addEventListener('change', event => {
  const input = event.target;
  if (input.dataset.versesIndex !== undefined) {
    const index = Number(input.dataset.versesIndex);
    const current = state.project.get(state.selected, 'Verses')?.value || '';
    try { commitField(state.selected, 'Verses', updateVerses(current, index, input.value)); }
    catch (error) { showToast(error.message); input.value = current.split(',')[index]?.trim() || ''; }
  } else if (input.dataset.field !== undefined) {
    try {
      commitField(state.selected, input.dataset.field, input.value);
    } catch (error) {
      showToast(error.message);
      input.value = state.project.get(state.selected, input.dataset.field)?.value || '';
    }
  } else if (input.id === 'owner-filter') {
    state.owner = input.value;
    state.listLimit = 250;
    render({ resetList: true });
  } else if (input.id === 'main-select') {
    state.project.mainPath = input.value;
    state.listLimit = 250;
    state.project.rebuild();
    chooseInitial();
    resetNavigation();
    render({ resetList: true });
    initializeNavigation();
  }
});

async function loadFiles(list, { nativeSession = null, skipConfirm = false } = {}) {
  const selected = [...list];
  const isFolder = selected.some(file => file.webkitRelativePath);
  const hasMix = selected.some(file => /\.mix$/i.test(file.name));
  let incoming = selected.filter(file => /\.ini$/i.test(file.name) || (!isFolder && /\.(map|mpr|yrm)$/i.test(file.name)));
  if (isFolder && !incoming.length && !hasMix) incoming = selected.filter(file => /\.(map|mpr|yrm)$/i.test(file.name));
  if (!incoming.length && !hasMix) { showToast('请选择规则文件或包含规则的 MIX，可同时选择 CSF 等资源。'); return false; }
  if (!skipConfirm && markChanges().length && !confirm('当前有未保存的修改。导入新文件会丢弃这些修改，继续吗？')) return false;
  const sequence = ++importSequence;
  showToast('正在读取规则和本地资源，请稍候。');
  try {
    const folderPaths = incoming.every(file => file.webkitRelativePath?.includes('/'));
    const [parsed, resources] = await Promise.all([
      Promise.all(incoming.map(async file => {
        const path = folderPaths ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;
        return parseFile(file.name, new Uint8Array(await file.arrayBuffer()), path);
      })),
      GameResources.load(selected),
    ]);
    if (sequence !== importSequence) return false;
    const nearest = [...parsed].sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    const looseRules = nearest.find(file => lower(file.path) === 'rulesmo.ini');
    let packedRules = null;
    if (!looseRules && hasMix) {
      const packed = await resources.findFile('rulesmo.ini');
      if (sequence !== importSequence) return false;
      if (packed) {
        packedRules = parseFile('rulesmo.ini', packed.bytes, 'rulesmo.ini');
        packedRules.sourceArchive = packed.archive;
        parsed.push(packedRules);
      }
    }
    const rules = looseRules || packedRules;
    if (nativeSession && !rules) throw new Error('游戏目录及其 MIX 中均未找到 rulesmo.ini。');
    if (isFolder && !rules) resources.notes.push('根目录和所选 MIX 中均未找到 rulesmo.ini；当前显示其他选入的规则文件。');
    const main = rules || nearest.find(file => /^rulesmd\.ini$/i.test(file.name)) || parsed[0];
    if (!main) throw new Error('没有找到可读取的 rulesmo.ini。');
    let project = new IniProject(parsed, main.path);
    const attempted = new Set();
    while (project.missingIncludes.length && attempted.size < 1024) {
      let added = false;
      for (const missing of project.missingIncludes) {
        const name = missing.name.trim();
        const key = lower(name);
        if (attempted.has(key) || /[\\/]/.test(name)) continue;
        attempted.add(key);
        if (parsed.some(file => lower(file.path.split('/').at(-1)) === key)) continue;
        let packed;
        try { packed = await resources.findFile(name); } catch { continue; }
        if (!packed) continue;
        const file = parseFile(name, packed.bytes, name);
        file.sourceArchive = packed.archive;
        parsed.push(file);
        added = true;
      }
      if (!added) break;
      project = new IniProject(parsed, main.path);
    }
    if (sequence !== importSequence) return false;
    state.project = project;
    state.resources = resources;
    state.desktopSession = nativeSession;
    state.demo = false; state.category = 'all'; state.search = ''; state.owner = ''; state.tab = 'basic'; state.listLimit = 250;
    state.globalSearch = ''; state.armorSearch = ''; state.armorOpen = false;
    chooseInitial(); resetNavigation(); render({ resetList: true }); initializeNavigation();
    showToast(main.sourceArchive ? `已从 ${main.sourceArchive} 读取 rulesmo.ini。` : `已导入 ${parsed.length} 个规则文件${resources.strings.size ? '，并加载文字资源' : ''}。请确认右上角选择的主文件。`);
    return true;
  } catch (error) { if (sequence === importSequence) showToast(`导入失败：${error.message || error}`); return false; }
}
fileInput.addEventListener('change', async () => { await loadFiles(fileInput.files); fileInput.value = ''; });
folderInput.addEventListener('change', async () => { await loadFiles(folderInput.files); folderInput.value = ''; });

async function openDesktopDirectory() {
  if (markChanges().length && !confirm('当前有未保存的修改。选择其他目录会丢弃这些修改，继续吗？')) return;
  app.inert = true;
  try {
    const session = await desktop.pickDirectory();
    if (!session) return;
    const loaded = await loadFiles(desktop.localFiles(session), { nativeSession: session, skipConfirm: true });
    if (loaded) {
      try { await desktop.rememberDirectory(session.sessionId); }
      catch (error) { showToast(`目录已打开，但无法记住路径：${error.message || error}`); }
    }
  } catch (error) { showToast(`打开游戏目录失败：${error.message || error}`); }
  finally { app.inert = false; }
}

async function saveDesktopProject() {
  if (app.inert || dialog.open || editorDialog.open) return;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  const session = state.desktopSession;
  if (!session) return;
  if (!markChanges().length) { showToast('当前没有需要保存的修改。'); return; }
  if (state.project.warnings.length) {
    showToast(`规则加载不完整，暂不能保存：${state.project.warnings[0]}`);
    return;
  }
  const project = state.project;
  const changed = [...new Set(markChanges().map(change => change.file))];
  const main = project.resolve(project.mainPath);
  if (main?.sourceArchive && !changed.includes(main)) changed.push(main);
  const files = changed.map(file => ({ file, bytes: serialize(file) }));
  app.inert = true;
  showToast('正在校验文件并保存，原文件会自动备份。');
  let saved = false;
  try {
    const replacements = new Map(files.map(({ file, bytes }) => [file, parseFile(file.name, bytes, file.path)]));
    const updatedProject = new IniProject(project.files.map(file => replacements.get(file) || file), project.mainPath);
    await desktop.saveFiles(session.sessionId, files);
    saved = true;
    state.project = updatedProject;
    state.changedSections = new Set();
    render();
    showToast(`已保存 ${files.length} 个规则文件，保存前的版本可在「历史版本」中恢复。`);
  } catch (error) {
    if (saved) state.desktopSession = null;
    showToast(`${saved ? '文件已保存，但界面更新失败，请重新打开游戏目录' : '保存失败'}：${error.message || error}`);
  }
  finally { app.inert = false; }
}

async function exportDesktopProject() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  const current = state.desktopSession;
  if (!current) return;
  if (state.project.warnings.length) { showToast(`规则加载不完整，暂不能另存：${state.project.warnings[0]}`); return; }
  const project = state.project;
  app.inert = true;
  try {
    const destination = await desktop.pickOutputDirectory();
    if (!destination) return;
    if (destination.sessionId === current.sessionId) { showToast('请选择其他目录；写回游戏目录请使用「保存」。'); return; }
    showToast('正在生成规则版本，请稍候。');
    const existing = new Map(desktop.localFiles(destination).map(file => [lower(file.path), file]));
    const projectFiles = [...new Set(project.loadOrder)];
    const conflicts = projectFiles.filter(file => existing.has(lower(file.path)));
    if (conflicts.length && !confirm(`输出目录已有 ${conflicts.length} 个同名规则文件。继续将覆盖这些文件，并自动备份原文件。`)) return;
    const files = await Promise.all(projectFiles.map(async file => {
      const old = existing.get(lower(file.path));
      return { file: { ...file, path: old?.path || file.path }, bytes: serialize(file),
        expectedHash: old ? await desktop.hashBytes(new Uint8Array(await old.arrayBuffer())) : null };
    }));
    await desktop.prepareExportDirectories(destination.sessionId, files.map(item => item.file.path));
    await desktop.saveFiles(destination.sessionId, files);
    showToast(`已将 ${files.length} 个规则文件另存到 ${destination.directory}${markChanges().length ? '；当前项目仍保留未保存的修改' : ''}。`);
  } catch (error) { showToast(`另存失败：${error.message || error}`); }
  finally { app.inert = false; }
}

async function showDesktopHistory() {
  const session = state.desktopSession;
  if (!session) return;
  app.inert = true;
  try {
    const versions = await desktop.listVersions(session.sessionId);
    if (state.desktopSession?.sessionId !== session.sessionId) return;
    dialog.innerHTML = `<div class="dialog-head"><h2 id="changes-title">历史版本</h2><button data-close aria-label="关闭">×</button></div><div class="dialog-body"><p>每条记录保存了当次操作之前的文件；恢复时只还原列出的文件，并先备份当前文件。</p>${versions.length ? versions.map((version, index) => `<div class="file-export"><div><strong>${h(new Date(version.createdMs).toLocaleString('zh-CN'))} · ${version.kind === 'restore' ? '恢复前' : '保存前'}</strong><div class="field-source" title="${h(version.paths.join('、'))}">${h(version.paths.join('、'))}</div></div><button class="btn sm" data-restore="${index}">恢复</button></div>`).join('') : '<p>还没有历史版本。首次保存后会自动创建备份。</p>'}</div>`;
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click', async () => {
      const version = versions[Number(button.dataset.restore)];
      const unsaved = markChanges().length ? '当前未保存的修改会丢失。' : '';
      if (!confirm(`${unsaved}将恢复该记录中的 ${version.paths.length} 个文件，并先备份当前文件。继续吗？`)) return;
      dialog.close(); app.inert = true;
      let restored = false;
      try {
        const expected = await desktop.expectedFiles(state.project, version.paths);
        await desktop.restoreVersion(session.sessionId, version.id, expected);
        restored = true;
        const refreshed = await desktop.refreshDirectory(session.sessionId);
        const loaded = await loadFiles(desktop.localFiles(refreshed), { nativeSession: refreshed, skipConfirm: true });
        if (!loaded) throw new Error('恢复完成，但重新读取游戏目录失败。请重新选择游戏目录。');
        showToast('已恢复备份；恢复前的文件也已备份。');
      } catch (error) {
        if (restored) { state.desktopSession = null; render(); }
        showToast(`恢复失败：${error.message || error}`);
      } finally { app.inert = false; }
    }));
    dialog.showModal();
  } catch (error) { showToast(`无法读取历史版本：${error.message || error}`); }
  finally { app.inert = false; }
}

function showEditorError(message) {
  let error = editorDialog.querySelector('[data-editor-error]');
  if (!error) {
    error = document.createElement('div');
    error.dataset.editorError = '';
    error.className = 'dialog-error';
    error.setAttribute('role', 'alert');
    editorDialog.querySelector('.dialog-actions').before(error);
  }
  error.textContent = message;
}
editorDialog.addEventListener('input', () => editorDialog.querySelector('[data-editor-error]')?.remove());

function openChoices(kind, key) {
  const section = state.selected;
  const raw = state.project.get(section, key)?.value || '';
  const single = ['armor', 'side', 'superweapon'].includes(kind);
  const values = single ? (raw ? [raw] : []) : raw.split(',').map(value => value.trim()).filter(Boolean);
  const selected = new Map(values.map(value => [lower(value), value]));
  const options = choicesFor(kind, raw);
  const labels = { country: '选择所属国家', side: '选择所属阵营', armor: '选择装甲类型', prerequisite: '选择建造前置', superweapon: '选择超级武器', superweapons: '选择超级武器' };
  const title = labels[kind] || '选择规则项';
  const description = kind === 'armor' ? '可搜索基础装甲和当前规则定义的扩展装甲。' : kind === 'country' ? '按阵营选择国家；当前未登记的代码也会保留。' : kind === 'side' ? '选择当前规则中注册的阵营。' : kind.startsWith('superweapon') ? '选择当前规则中注册的超级武器；当前未登记的代码也会保留。' : '选择建筑或通用建造条件，实际限制还可能由其他参数决定。';
  editorDialog.innerHTML = `<div class="dialog-head"><h2 id="editor-title">${h(title)}</h2><button type="button" data-editor-close aria-label="关闭">×</button></div><div class="dialog-body option-dialog-body"><p>${h(description)}</p><div class="search-wrap">${icon('search', 15)}<input class="search" id="choice-search" type="search" placeholder="搜索中文、英文或代码..." aria-label="搜索选项"></div><div class="option-toolbar"><span data-selected-count></span>${single ? '<button type="button" class="text-action" data-clear-selection>清空选择</button>' : ''}</div><div class="option-list" data-option-list></div></div><div class="dialog-actions"><button type="button" class="btn plain" data-editor-close>取消</button><button type="button" class="btn primary" data-editor-apply>应用选择</button></div>`;
  const search = editorDialog.querySelector('#choice-search');
  const list = editorDialog.querySelector('[data-option-list]');
  const countLabel = editorDialog.querySelector('[data-selected-count]');
  function drawOptions() {
    const q = lower(search.value.trim());
    const matches = options.filter(option => !q || lower([option.id, option.label, option.group, option.hint].join(' ')).includes(q));
    const ordered = [...matches.filter(option => selected.has(lower(option.id))), ...matches.filter(option => !selected.has(lower(option.id)))];
    const shown = ordered.slice(0, 250);
    const groups = new Map();
    for (const option of shown) {
      if (!groups.has(option.group)) groups.set(option.group, []);
      groups.get(option.group).push(option);
    }
    countLabel.textContent = single ? (selected.size ? '已选择 1 项' : '未选择') : `已选择 ${selected.size} 项`;
    list.innerHTML = [...groups.entries()].map(([group, items]) => `<div class="option-group"><div class="option-group-title"><span>${h(group)}</span>${kind === 'country' && !q ? `<span><button type="button" class="text-action" data-group-select="${h(group)}">全选</button><button type="button" class="text-action" data-group-clear="${h(group)}">清除</button></span>` : ''}</div><div class="option-grid">${items.map(option => `<label class="option-row"><input type="${single ? 'radio' : 'checkbox'}" name="rule-choice" data-choice="${h(option.id)}" ${selected.has(lower(option.id)) ? 'checked' : ''}><span><strong>${h(option.label)}</strong><small>${lower(option.label) === lower(option.id) ? '' : h(option.id)}${option.hint ? `${lower(option.label) === lower(option.id) ? '' : ' · '}${h(option.hint)}` : ''}</small></span></label>`).join('')}</div></div>`).join('') || '<div class="empty-list">没有匹配的选项。</div>';
    if (matches.length > shown.length) list.insertAdjacentHTML('beforeend', `<p class="option-limit">显示前 ${shown.length} 项，请输入关键词缩小范围。</p>`);
  }
  search.addEventListener('input', drawOptions);
  list.addEventListener('change', event => {
    const input = event.target;
    if (input.dataset.choice === undefined) return;
    if (single) selected.clear();
    if (input.checked) selected.set(lower(input.dataset.choice), input.dataset.choice);
    else selected.delete(lower(input.dataset.choice));
    countLabel.textContent = single ? (selected.size ? '已选择 1 项' : '未选择') : `已选择 ${selected.size} 项`;
  });
  list.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const group = button.dataset.groupSelect ?? button.dataset.groupClear;
    if (group === undefined) return;
    for (const option of options.filter(item => item.group === group)) {
      if (button.dataset.groupSelect !== undefined) selected.set(lower(option.id), option.id);
      else selected.delete(lower(option.id));
    }
    drawOptions();
  });
  editorDialog.querySelector('[data-clear-selection]')?.addEventListener('click', () => { selected.clear(); drawOptions(); });
  editorDialog.querySelectorAll('[data-editor-close]').forEach(button => button.addEventListener('click', () => editorDialog.close()));
  editorDialog.querySelector('[data-editor-apply]').addEventListener('click', () => {
    const value = single ? ([...selected.values()][0] || '') : mergeSelections(raw, [...selected.values()]);
    try { commitField(section, key, value); editorDialog.close(); }
    catch (error) { showEditorError(error.message); }
  });
  drawOptions();
  editorDialog.showModal();
  search.focus({ preventScroll: true });
}

function openListEditor(key) {
  const section = state.selected;
  const raw = state.project.get(section, key)?.value || '';
  let values = raw.split(',');
  editorDialog.innerHTML = `<div class="dialog-head"><h2 id="editor-title">分项编辑 ${h(key)}</h2><button type="button" data-editor-close aria-label="关闭">×</button></div><div class="dialog-body option-dialog-body"><p>按原顺序编辑每一项；这些值的具体含义由对应规则决定。</p><div class="ordered-list" data-ordered-list></div><button type="button" class="btn sm" data-list-add>＋ 添加一项</button></div><div class="dialog-actions"><button type="button" class="btn plain" data-editor-close>取消</button><button type="button" class="btn primary" data-editor-apply>应用修改</button></div>`;
  const list = editorDialog.querySelector('[data-ordered-list]');
  function draw() {
    list.innerHTML = values.map((value, index) => `<div class="ordered-row"><span>${index + 1}</span><input data-list-index="${index}" aria-label="第 ${index + 1} 项" value="${h(value)}" autocomplete="off" spellcheck="false"><button type="button" data-move="up" data-index="${index}" ${index === 0 ? 'disabled' : ''} aria-label="上移第 ${index + 1} 项">↑</button><button type="button" data-move="down" data-index="${index}" ${index === values.length - 1 ? 'disabled' : ''} aria-label="下移第 ${index + 1} 项">↓</button><button type="button" data-remove="${index}" aria-label="删除第 ${index + 1} 项">×</button></div>`).join('');
  }
  list.addEventListener('input', event => { if (event.target.dataset.listIndex !== undefined) values[Number(event.target.dataset.listIndex)] = event.target.value; });
  list.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.remove !== undefined) values.splice(Number(button.dataset.remove), 1);
    else if (button.dataset.move) {
      const index = Number(button.dataset.index), other = index + (button.dataset.move === 'up' ? -1 : 1);
      if (other >= 0 && other < values.length) [values[index], values[other]] = [values[other], values[index]];
    }
    draw();
  });
  editorDialog.querySelector('[data-list-add]').addEventListener('click', () => { values.push(''); draw(); list.querySelector(`[data-list-index="${values.length - 1}"]`)?.focus(); });
  editorDialog.querySelectorAll('[data-editor-close]').forEach(button => button.addEventListener('click', () => editorDialog.close()));
  editorDialog.querySelector('[data-editor-apply]').addEventListener('click', () => {
    if (values.some(value => value.includes(','))) { showEditorError('单项不能包含逗号，请使用“添加一项”。'); return; }
    try { commitField(section, key, values.join(',')); editorDialog.close(); }
    catch (error) { showEditorError(error.message); }
  });
  draw();
  editorDialog.showModal();
}

function openAddField() {
  const section = state.selected;
  editorDialog.innerHTML = `<div class="dialog-head"><h2 id="editor-title">添加规则字段</h2><button type="button" data-editor-close aria-label="关闭">×</button></div><div class="dialog-body option-dialog-body"><p>字段将添加到当前规则段 [${h(section)}]；请使用规则支持的字段名和值。</p><div class="editor-fields"><label>字段名<input id="new-field-name" placeholder="例如 BuildSpeed" autocomplete="off" spellcheck="false"></label><label>值<input id="new-field-value" placeholder="输入规则值" autocomplete="off" spellcheck="false"></label></div></div><div class="dialog-actions"><button type="button" class="btn plain" data-editor-close>取消</button><button type="button" class="btn primary" data-editor-apply>添加字段</button></div>`;
  editorDialog.querySelectorAll('[data-editor-close]').forEach(button => button.addEventListener('click', () => editorDialog.close()));
  editorDialog.querySelector('[data-editor-apply]').addEventListener('click', () => {
    const key = editorDialog.querySelector('#new-field-name').value.trim();
    const value = editorDialog.querySelector('#new-field-value').value.trim();
    if (!key || !value) { showEditorError('请输入字段名和值。'); return; }
    if (state.project.get(section, key)) { showEditorError('该字段已存在，请直接编辑原有字段。'); return; }
    try { commitField(section, key, value); editorDialog.close(); }
    catch (error) { showEditorError(error.message); }
  });
  editorDialog.showModal();
  editorDialog.querySelector('#new-field-name').focus({ preventScroll: true });
}

function showChanges() {
  const changes = markChanges();
  const files = [...new Set(changes.map(change => change.file))];
  dialog.innerHTML = `<div class="dialog-head"><h2 id="changes-title">修改与导出 <span style="color:#90a58e;font:11px var(--mono)">${changes.length} CHANGES</span></h2><button data-close aria-label="关闭">×</button></div><div class="dialog-body">${changes.length ? `<p>每个按钮下载对应的修改文件。MIX 中的规则会导出为独立 INI，不会修改资源包；文件夹结构不会自动创建。</p>${files.map((file,index) => `<div class="file-export"><strong>${h(sourceName(file))}</strong><button class="btn primary sm" data-export="${index}">${icon('download',14)} 下载 ${h(file.name)}</button></div>`).join('')}<div style="margin-top:18px">${changes.map(change => `<div class="change-row"><div class="where">${h(sourceName(change.file))} / [${h(change.section)}]</div><div>${h(change.key)}: <span class="before">${h(change.before === null ? '（新增）' : change.before || '（空）')}</span> → <span class="after">${h(change.after || '（空）')}</span></div></div>`).join('')}</div>` : '<p>还没有修改。选择一个对象，修改属性后可在这里预览并下载。</p>'}</div>`;
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => {
    const file = files[Number(button.dataset.export)];
    const url = URL.createObjectURL(new Blob([serialize(file)], { type: 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  dialog.showModal();
}

const demoFiles = [parseFile('demo-rules.ini', enc.encode(DEMO_MAIN)), parseFile('demo-units.ini', enc.encode(DEMO_UNITS))];
state.project = new IniProject(demoFiles, 'demo-rules.ini');
chooseInitial();
resetNavigation();
render();
initializeNavigation();

if (desktop.isDesktop) {
  const initialViewport = { width: window.innerWidth, height: window.innerHeight };
  let resizedDuringStartup = false;
  const startupSizeUnchanged = () => !resizedDuringStartup && window.innerWidth === initialViewport.width && window.innerHeight === initialViewport.height;
  const recordStartupResize = () => { if (!startupSizeUnchanged()) resizedDuringStartup = true; };
  window.addEventListener('resize', recordStartupResize);
  window.__TAURI__?.window?.getCurrentWindow?.().onCloseRequested(event => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (app.inert) { event.preventDefault(); showToast('正在处理本地文件，请稍候。'); return; }
    if (markChanges().length && !confirm('当前有未保存的修改，关闭窗口将丢弃这些修改。继续吗？')) event.preventDefault();
    else nativeCloseApproved = true;
  }).catch(error => showToast(`无法启用关闭提示：${error.message || error}`));
  window.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !composing) {
      event.preventDefault();
      saveDesktopProject();
    }
  });
  (async () => {
    app.inert = true;
    try {
      const session = await desktop.recentDirectory();
      if (session && state.demo && !markChanges().length) await loadFiles(desktop.localFiles(session), { nativeSession: session, skipConfirm: true });
    } catch (error) { showToast(`无法打开上次的游戏目录：${error.message || error}`); }
    finally {
      try { await fitStartupWindow(startupSizeUnchanged); }
      catch (error) { console.warn('无法调整启动窗口尺寸：', error); }
      window.removeEventListener('resize', recordStartupResize);
      app.inert = false;
    }
  })();
}
