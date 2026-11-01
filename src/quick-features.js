import { enumChoices } from './enum-options.js';
import { listTypes } from './ini.js';
import { MAX_GAME_OBJECT_ID_LENGTH, prepareObjectCreation } from './object-creation.js';

// Values and type restrictions are deliberately explicit: no optional field is written just by opening the dialog.
// https://ares-developers.github.io/Ares-docs/new/initialpayload.html
// https://ares-developers.github.io/Ares-docs/new/cloak/index.html
// https://ares-developers.github.io/Ares-docs/new/buildings/producecash.html
// https://ares-developers.github.io/Ares-docs/new/customizableveterancy.html
// https://ares-developers.github.io/Ares-docs/new/promotion.html
const mobile = ['infantry', 'vehicle', 'aircraft'];
const technos = [...mobile, 'building'];
const boolean = key => ({ key, type: 'boolean' });
const defaultableBoolean = key => ({ key, type: 'boolean', allowClear: true });
const optionalInteger = key => ({ key, type: 'integer' });
const optionalSigned = key => ({ key, type: 'signed' });
const multiple = (key, type) => ({ key, type, allowClear: true });
const reference = (key, type) => ({ key, type, allowClear: true });
const techCaptureFields = () => ['Capturable', 'NeedsEngineer', 'Unsellable'].map(defaultableBoolean);
const globalHealField = (key, type) => ({ key, type, targetSection: 'General' });
const passengerExperienceFields = () => [
  defaultableBoolean('Trainable'),
  { ...defaultableBoolean('Experience.FromPassengers'), defaultHint: 'Ares 默认：是' },
  { ...defaultableBoolean('Experience.PromotePassengers'), defaultHint: 'Ares 默认：否' },
  { key: 'Experience.PassengerModifier', type: 'multiplier', allowClear: true, defaultHint: 'Ares 默认：100%' },
  { ...defaultableBoolean('Promote.IncludePassengers'), defaultHint: 'Ares 默认：否',
    warning: '启用后，载具晋升时会覆盖可升级乘员的已有等级和经验，可能导致乘员降级。' },
];

export const QUICK_FEATURES = [
  {
    id: 'transport', label: '载具运输与车内开火', types: ['vehicle'],
    description: '设置载具的乘员容量、体型限制、车内开火及乘员击杀经验。乘员的 Size、武器及其他限制仍会影响实际效果。',
    note: '经验相关字段配置在载具上，需要 Ares；乘员是否能晋升还取决于乘员自身的 Trainable。已有的允许／禁止名单等规则不会自动修改。',
    fields: [
      { key: 'Passengers', type: 'integer', suggested: '5', required: true },
      { key: 'SizeLimit', type: 'integer', suggested: '2', required: true },
      { key: 'PipScale', type: 'pipScale', suggested: 'Passengers', required: true },
      { key: 'OpenTopped', type: 'boolean', suggested: 'yes', required: true },
      boolean('NoManualEnter'), boolean('NoManualUnload'), boolean('Passengers.BySize'), boolean('Selectable'),
      ...passengerExperienceFields(),
    ],
  },
  {
    id: 'passenger-experience', label: '乘员经验与晋升', types: ['vehicle'],
    description: '为载具设置乘员击杀时的经验归属，以及载具晋升时是否同步乘员等级。',
    note: '需要 Ares；字段设置在载具上。默认载具获得乘员击杀经验，载具精英后不会转给射击乘员；经验倍率不是双方同时分配的比例。',
    fields: passengerExperienceFields(),
  },
  {
    id: 'garrison', label: '建筑驻军', types: ['building'],
    description: '设置建筑是否允许步兵驻守及驻军开火；步兵本身的驻军能力和武器等条件仍然生效。',
    note: '建筑美术，以及步兵的 Occupier、OccupyWeapon 和 EliteOccupyWeapon 等条件不会自动修改。',
    fields: [
      { key: 'CanBeOccupied', type: 'boolean', suggested: 'yes', required: true },
      { key: 'MaxNumberOccupants', type: 'integer', suggested: '5', required: true },
      { key: 'CanOccupyFire', type: 'boolean', suggested: 'yes', required: true },
      boolean('Selectable'), optionalInteger('Sight'),
    ],
  },
  {
    id: 'income', label: '科技采油井／建筑自动产钱', types: ['building'],
    description: '设置科技采油井、银行等建筑定期产生的资金，以及占领时的一次性收入。',
    note: '可选设置工程师占领和出售限制；未选的占领字段不会写入。负金额及占领奖励的具体效果取决于游戏版本。',
    fields: [
      { key: 'ProduceCashAmount', type: 'signed', suggested: '20', required: true },
      { key: 'ProduceCashDelay', type: 'integer', suggested: '100', required: true },
      optionalSigned('ProduceCashStartup'), boolean('ProduceCashDisplay'), ...techCaptureFields(),
    ],
  },
  {
    id: 'tech-hospital', label: '科技医院／步兵自动治疗', types: ['building'],
    description: '为建筑添加科技医院的所属方步兵自愈效果。恢复间隔和恢复量属于全局配置，修改后影响所有玩家。',
    note: 'InfantryGainSelfHeal=1 是心灵终结科技医院的常用值，0 表示关闭；多个提供者的效果可叠加。[General] 字段影响所有玩家和相关建筑，修改前请检查预览。',
    fields: [
      { key: 'InfantryGainSelfHeal', type: 'integer', suggested: '1', required: true },
      globalHealField('SelfHealInfantryFrames', 'positiveInteger'),
      globalHealField('SelfHealInfantryAmount', 'integer'),
      ...techCaptureFields(),
    ],
  },
  {
    id: 'tech-machine-shop', label: '科技机械商店／单位自动维修', types: ['building'],
    description: '为建筑添加科技机械商店的所属方单位自动维修效果。恢复间隔和恢复量属于全局配置，修改后影响所有玩家。',
    note: 'UnitsGainSelfHeal=1 是心灵终结科技机械商店的常用值，0 表示关闭；多个提供者的效果可叠加。[General] 字段影响所有玩家和相关建筑，修改前请检查预览。',
    fields: [
      { key: 'UnitsGainSelfHeal', type: 'integer', suggested: '1', required: true },
      globalHealField('SelfHealUnitFrames', 'positiveInteger'),
      globalHealField('SelfHealUnitAmount', 'integer'),
      ...techCaptureFields(),
    ],
  },
  {
    id: 'stealth', label: '隐形能力', types: mobile,
    description: '设置单位自带隐形，并可选择是否仅在静止时隐形。',
    note: '隐形与雷达不可见是不同机制；不同移动方式和扩展版本可能有限制。',
    fields: [
      { key: 'Cloakable', type: 'boolean', suggested: 'yes', required: true },
      boolean('CloakStop'), optionalInteger('CloakingSpeed'),
    ],
  },
  {
    id: 'stealth-building', label: '隐形能力', types: ['building'],
    description: '设置建筑自带隐形，可选择低电力或停机时是否解除隐形。',
    note: 'Ares 的 Cloakable.Powered 只影响自带隐形，不影响隐形产生器。',
    fields: [
      { key: 'Cloakable', type: 'boolean', suggested: 'yes', required: true },
      boolean('Cloakable.Powered'), optionalInteger('CloakingSpeed'),
    ],
  },
  {
    id: 'detection', label: '反隐与探测', types: mobile,
    description: '设置单位的探测范围，并可单独调整近距离解除隐形的 Sensors。',
    note: 'Sensors 与 SensorsSight 是不同机制；空中及特殊移动单位的效果需在游戏中确认。',
    fields: [{ key: 'SensorsSight', type: 'integer', suggested: '7', required: true }, boolean('Sensors')],
  },
  {
    id: 'detection-building', label: '反隐与探测', types: ['building'],
    description: '配置 Ares 建筑探测器及探测范围，可探测隐形与地下单位。',
    note: '建筑探测需要 Ares 支持；电力与其他建筑逻辑仍可能影响效果。',
    fields: [
      { key: 'SensorArray', type: 'boolean', suggested: 'yes', required: true },
      { key: 'SensorsSight', type: 'integer', suggested: '7', required: true },
    ],
  },
  {
    id: 'protection', label: '防护与免疫', types: technos,
    description: '分别设置心灵控制、EMP、辐射及绑架免疫；未配置的项目保留游戏默认值。',
    note: '游戏默认值可能随对象类型变化；特殊武器或超级武器可能覆盖部分免疫。',
    fields: ['ImmuneToPsionics', 'ImmuneToEMP', 'ImmuneToRadiation', 'ImmuneToAbduction'].map(defaultableBoolean),
  },
  {
    id: 'payload', label: '出厂自带乘员', types: ['vehicle', 'building'],
    description: '设置对象创建时携带的乘员类型与数量。建筑仅允许步兵；实际数量受容量和体型限制。',
    note: '需要 Ares。只修改初始乘员列表，不会自动改变容量、体型或驻军规则。',
    fields: [
      { key: 'InitialPayload.Types', type: 'payloadTypes', allowClear: true },
      { key: 'InitialPayload.Nums', type: 'payloadNums', allowClear: true },
    ],
  },
  {
    id: 'availability', label: '建造条件', types: technos,
    description: '设置所属方、前置、科技等级、国家限制和建造数量上限。',
    note: '生产建筑、地图模式和其他规则仍可能影响是否可建造。',
    fields: [multiple('Owner', 'countryList'), multiple('Prerequisite', 'prerequisiteList'), optionalSigned('TechLevel'),
      multiple('RequiredHouses', 'countryList'), multiple('ForbiddenHouses', 'countryList'), optionalSigned('BuildLimit')],
  },
  {
    id: 'veterancy', label: '晋升与精英武器', types: mobile,
    description: '设置能否升级、老兵与精英能力，以及精英武器。',
    note: '未设置的精英武器使用游戏相应的默认选择；不会修改所选武器本身。',
    fields: [boolean('Trainable'), multiple('VeteranAbilities', 'abilities'), multiple('EliteAbilities', 'abilities'),
      reference('ElitePrimary', 'weapon'), reference('EliteSecondary', 'weapon')],
  },
  {
    id: 'death', label: '死亡爆炸', types: technos,
    description: '设置摧毁时的爆炸开关，并选择死亡武器；可查看所选武器的伤害和弹头。',
    note: '不会修改死亡武器本身；未设置时可能使用全局默认值，实际触发条件依对象和游戏逻辑而定。',
    fields: [{ key: 'Explodes', type: 'boolean', suggested: 'yes', required: true }, reference('DeathWeapon', 'weapon')],
  },
  {
    id: 'superweapon', label: '建筑提供超级武器', types: ['building'],
    description: '为建筑选择已有超级武器，并可查看其类型、充能和启动方式。',
    note: '额外超级武器列表需要 Ares；充能和可用性仍受超级武器及建筑规则限制。',
    fields: [reference('SuperWeapon', 'superweapon'), reference('SuperWeapon2', 'superweapon'), multiple('SuperWeapons', 'superweapons')],
  },
  {
    id: 'passenger-fire', label: '乘员车内开火诊断', types: ['infantry', 'vehicle'], kind: 'passenger-fire',
    description: '检查乘员普通及精英武器能否在开放式载具内开火，并可修改相关武器。',
    fields: [],
  },
];

const normalize = value => String(value ?? '').trim().toLowerCase();
const enabled = value => /^(yes|true|1)$/i.test(String(value ?? '').trim());
const disabled = value => /^(no|false|0)$/i.test(String(value ?? '').trim());
const tokens = value => String(value ?? '').split(',').map(value => value.trim()).filter(Boolean);
const validInt = (value, signed = false) => (signed ? /^[+-]?\d+$/ : /^\d+$/).test(value)
  && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647 && Number(value) >= (signed ? -2147483648 : 0);
const validMultiplier = value => /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(value)
  && Number.isFinite(Number(value.replace(/%$/, '')));

export function quickFeaturesFor(type) { return QUICK_FEATURES.filter(feature => feature.types.includes(type)); }

export function quickFeatureFields(project, section, feature) {
  if (!project.section(section)) throw new Error(`找不到规则段 [${section}]。`);
  return feature.fields.map(field => {
    const target = field.targetSection || section;
    const current = project.get(target, field.key);
    return { ...field, current, unavailable: !!field.targetSection && !project.section(target), value: current ? current.value : field.suggested || '' };
  });
}

export function garrisonWeaponWarning(project, section) {
  const fields = [...(project.section(section)?.fields.values() || [])].filter(field =>
    /^(?:Primary|Secondary|ElitePrimary|EliteSecondary|Weapon\d+|EliteWeapon\d+)$/i.test(field.name)
    && field.value.trim() && !/^(?:none|<none>)$/i.test(field.value.trim()));
  if (!fields.length) return '';
  const weapons = fields.map(field => `${field.name}=${field.value}`).join('、');
  return `此建筑已有武器：${weapons}。启用建筑驻军后，驻军逻辑可能覆盖建筑原有武器的开火，即使没有驻军也可能无法使用；请在游戏中验证。`;
}

function payloadWarnings(project, section, type, selected) {
  const values = tokens(selected['InitialPayload.Types']), nums = tokens(selected['InitialPayload.Nums']);
  const warnings = [];
  if (nums.length > values.length || nums.some(value => !validInt(value) || Number(value) < 1)) warnings.push('现有初始乘员数量与类型不匹配或包含无效值，请检查。');
  if (['InitialPayload.Types', 'InitialPayload.Nums'].some(key => selected[key] && selected[key].split(',').some(item => !item.trim()))) warnings.push('现有初始乘员列表包含空项，请检查。');
  if (!values.length) return warnings;
  const inf = new Set(listTypes(project, 'InfantryTypes').map(normalize));
  const units = new Set(listTypes(project, 'VehicleTypes').map(normalize));
  for (const id of values) {
    if ((!inf.has(normalize(id)) && (type === 'building' || !units.has(normalize(id)))) || !project.section(id)) warnings.push(`乘员 ${id} 没有找到可用的${type === 'building' ? '步兵' : '步兵或载具'}定义；保留原有值，请检查。`);
    if (normalize(id) === normalize(section)) warnings.push(`初始乘员 ${id} 与自身相同，可能形成递归。`);
    if (project.get(id, 'InitialPayload.Types')?.value.trim()) warnings.push(`乘员 ${id} 自身也配置了初始乘员；Ares 不支持嵌套初始乘员。`);
  }
  const occupied = type === 'building' && enabled(project.get(section, 'CanBeOccupied')?.value);
  if (type === 'building' && !occupied && !enabled(project.get(section, 'InfantryAbsorb')?.value)) warnings.push('建筑需要 CanBeOccupied=yes 或 InfantryAbsorb=yes 才支持初始乘员。');
  const capacityKey = occupied ? 'MaxNumberOccupants' : 'Passengers';
  const capacity = project.get(section, capacityKey)?.value;
  const counts = values.map((_, i) => nums.length ? Number(nums[Math.min(i, nums.length - 1)]) : 1);
  if (capacity === undefined || capacity === '') warnings.push(`未配置 ${capacityKey}，请确认初始乘员容量。`);
  else if (validInt(capacity)) {
    if (counts.every(Number.isFinite) && counts.reduce((sum, value) => sum + value, 0) > Number(capacity)) warnings.push(`选择的乘员数量超过 ${capacityKey}=${capacity}，实际容纳数量会受限制。`);
  }
  if (type === 'vehicle') {
    const limit = project.get(section, 'SizeLimit')?.value;
    const sizes = values.map(id => project.get(id, 'Size')?.value);
    if (limit === undefined || limit === '') warnings.push('未配置 SizeLimit，请确认每个乘员的体型限制。');
    else if (validInt(limit)) for (const id of values) {
      const size = project.get(id, 'Size')?.value;
      if (size !== undefined && validInt(size) && Number(size) > Number(limit)) warnings.push(`${id} 的 Size=${size} 超过 SizeLimit=${limit}。`);
    }
    if (!disabled(project.get(section, 'Passengers.BySize')?.value)) {
      if (sizes.some(size => size === undefined || !validInt(size))) warnings.push('部分乘员没有明确的 Size，无法准确计算按体型占用的容量。');
      else if (capacity !== undefined && validInt(capacity) && counts.every(Number.isFinite)) {
        const occupied = sizes.reduce((sum, size, index) => sum + Number(size) * counts[index], 0);
        if (occupied > Number(capacity)) warnings.push(`乘员按 Size 计算占用 ${occupied}，超过 Passengers=${capacity}。`);
      }
    }
    warnings.push('容量还受 Passengers.BySize、单位类型及游戏规则影响；不会自动修改这些字段。');
  }
  return warnings;
}

function warningsFor(project, section, type, feature, values) {
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
    const weaponWarning = garrisonWeaponWarning(project, section);
    if (weaponWarning) warnings.push(weaponWarning);
    if (disabled(current('CanBeOccupied'))) warnings.push('CanBeOccupied 已关闭，建筑不能通过此选项驻军。');
    if (Number(current('MaxNumberOccupants')) === 0) warnings.push('MaxNumberOccupants=0 时没有可用的驻军位置。');
    if (disabled(current('CanOccupyFire'))) warnings.push('CanOccupyFire 已关闭，驻军不能通过此选项向外开火。');
    if (disabled(current('Selectable'))) warnings.push('Selectable 已关闭，玩家可能无法选择建筑并撤出驻军。');
    if (current('Sight') !== '' && Number(current('Sight')) === 0) warnings.push('Sight=0 可能影响驻军发现和攻击目标。');
    if (enabled(current('InfantryAbsorb')) || enabled(current('UnitAbsorb'))) warnings.push('建筑已启用吸收单位逻辑，可能与驻军交互；此功能不会修改吸收字段。');
    if (enabled(current('Wall')) || enabled(current('Gate'))) warnings.push('建筑同时具有围墙或闸门逻辑，驻军效果需要在游戏中确认。');
  } else if (feature.id === 'payload') warnings.push(...payloadWarnings(project, section, type, values));
  else if (feature.id === 'income' && Number(current('ProduceCashDelay')) === 0) warnings.push('ProduceCashDelay=0 的实际行为请在游戏中确认。');
  else if (feature.id === 'stealth' || feature.id === 'stealth-building') {
    if (disabled(current('Cloakable'))) warnings.push('Cloakable 已关闭，单位不会通过此选项获得自带隐形。');
    if (enabled(current('CloakStop')) && enabled(current('BalloonHover'))) warnings.push('Ares 的 CloakStop 不支持 BalloonHover=yes 单位。');
  } else if (feature.id === 'detection' || feature.id === 'detection-building') {
    if (Number(current('SensorsSight')) === 0) warnings.push('SensorsSight=0 时没有配置探测范围。');
    if (feature.id === 'detection-building' && disabled(current('SensorArray'))) warnings.push('SensorArray 已关闭，建筑探测功能不会通过此选项开启。');
  } else if (feature.id === 'availability') {
    if (current('TechLevel') !== '' && (Number(current('TechLevel')) < 0 || Number(current('TechLevel')) > 10)) warnings.push('TechLevel 处于常规可建造等级之外，能否建造取决于游戏及模式规则。');
    const owners = tokens(current('Owner')), forbidden = new Set(tokens(current('ForbiddenHouses')).map(normalize));
    const overlap = owners.filter(owner => forbidden.has(normalize(owner)));
    if (overlap.length) warnings.push(`以下国家同时出现在 Owner 和 ForbiddenHouses 中：${overlap.join('、')}；禁止条件仍会影响建造。`);
  } else if (feature.id === 'veterancy') {
    if (disabled(current('Trainable'))) warnings.push('Trainable 已关闭，正常经验晋升及晋升能力可能不会生效。');
  } else if (feature.id === 'death') {
    if (disabled(current('Explodes'))) warnings.push('Explodes 已关闭，死亡爆炸的触发取决于其他规则。');
    const weapon = current('DeathWeapon');
    if (!weapon && project.get('CombatDamage', 'DeathWeapon')?.value) warnings.push(`未单独指定死亡武器；全局默认值为 ${project.get('CombatDamage', 'DeathWeapon').value}。`);
    else if (weapon && !project.section(weapon)) warnings.push(`找不到死亡武器 [${weapon}] 的定义。`);
  } else if (feature.id === 'superweapon') {
    const seen = new Set(), duplicated = new Set();
    for (const value of ['SuperWeapon', 'SuperWeapon2', 'SuperWeapons'].flatMap(key => tokens(current(key)))) {
      if (/^(none|<none>)$/i.test(value)) continue;
      if (seen.has(normalize(value))) duplicated.add(value); else seen.add(normalize(value));
      if (!project.section(value)) warnings.push(`找不到超级武器 [${value}] 的定义，请检查。`);
    }
    if (duplicated.size) warnings.push(`同一超级武器出现在多个位置：${[...duplicated].join('、')}；是否重复提供取决于游戏规则。`);
  }
  if (feature.id === 'transport' || feature.id === 'passenger-experience') {
    if (disabled(current('Trainable'))) warnings.push('Trainable 已关闭，载具无法通过经验晋升；乘员能否晋升还取决于其自身配置。');
    if (disabled(current('Experience.FromPassengers'))) warnings.push('Experience.FromPassengers 已关闭，载具不会因乘员击杀获得经验；射击乘员的经验还取决于载具等级和炮手逻辑。');
    if (enabled(current('Promote.IncludePassengers'))) warnings.push('Promote.IncludePassengers 会在载具晋升时覆盖所有可升级乘员的已有等级和经验，可能使原本更高等级的乘员降级；请谨慎用于可手动上下车的载具。');
    if (feature.id === 'passenger-experience' && !enabled(current('OpenTopped')) && !enabled(current('Gunner'))) {
      warnings.push('未检测到 OpenTopped=yes 或 Gunner=yes；乘员击杀经验归属需要相应的开放式载具或炮手逻辑。');
    }
  }
  if (feature.id === 'income' || feature.id === 'tech-hospital' || feature.id === 'tech-machine-shop') {
    if (enabled(current('NeedsEngineer')) && disabled(current('Capturable'))) warnings.push('NeedsEngineer 已开启，但 Capturable 已关闭，请核对工程师占领设置。');
  }
  if (feature.id === 'tech-hospital' || feature.id === 'tech-machine-shop') {
    const infantry = feature.id === 'tech-hospital';
    const gain = infantry ? 'InfantryGainSelfHeal' : 'UnitsGainSelfHeal';
    const frames = infantry ? 'SelfHealInfantryFrames' : 'SelfHealUnitFrames';
    const amount = infantry ? 'SelfHealInfantryAmount' : 'SelfHealUnitAmount';
    if (Number(current(gain)) === 0) warnings.push(`${gain}=0 时该建筑不会提供此类自动恢复。`);
    if (current(frames) !== '' && Number(current(frames)) === 0) warnings.push(`[General] ${frames}=0 可能导致游戏错误，请使用大于 0 的间隔。`);
    if (current(amount) !== '' && Number(current(amount)) === 0) warnings.push(`[General] ${amount}=0 时，对应的全局自动恢复量为 0。`);
    const changed = [frames, amount].filter(key => (values[key] ?? '') !== (project.get('General', key)?.value ?? ''));
    if (changed.length) warnings.push(`将修改全局 [General] 的 ${changed.join('、')}，会影响所有玩家及使用该恢复机制的建筑。`);
    if (!project.section('General')) warnings.push('当前未加载 [General]；全局恢复间隔和恢复量无法在此修改。');
  }
  return warnings;
}

// Validate the whole form before touching the fork, then apply all fields atomically.
export function prepareQuickFeature(project, { featureId, type, section, values }) {
  const feature = quickFeaturesFor(type).find(item => item.id === featureId);
  if (!feature || feature.kind) throw new Error('此对象类型不支持该快捷功能。');
  if (!project.section(section)) throw new Error(`找不到规则段 [${section}]。`);
  const selected = {};
  for (const field of feature.fields) {
    const target = field.targetSection || section;
    const existing = project.get(target, field.key);
    const raw = String(Object.prototype.hasOwnProperty.call(values || {}, field.key) ? (values[field.key] ?? '') : (existing?.value ?? '')).trim();
    if (!raw) {
      if (field.required) throw new Error(`请填写 ${field.key}。`);
      if (existing?.value && !field.allowClear) throw new Error(`${field.key} 已有值；如需清空，请在全部属性中单独编辑。`);
      selected[field.key] = '';
      continue;
    }
    if (field.targetSection && !project.section(target)) throw new Error(`未加载 [${target}]，无法修改 ${field.key}。`);
    if ((field.type === 'integer' || field.type === 'signed' || field.type === 'positiveInteger') && (!validInt(raw, field.type === 'signed') || (field.type === 'positiveInteger' && Number(raw) === 0)) && raw !== existing?.value) {
      if (field.type === 'positiveInteger') throw new Error(`${field.key} 需要填写 1 到 2147483647 之间的整数。`);
      throw new Error(`${field.key} 需要填写 ${field.type === 'signed' ? '-2147483648' : '0'} 到 2147483647 之间的整数。`);
    }
    if (field.type === 'multiplier' && !validMultiplier(raw) && raw !== existing?.value) throw new Error(`${field.key} 需要填写非负倍率或百分比，例如 1、0.5 或 50%。`);
    if (field.type === 'boolean' && !/^(yes|no|true|false|1|0)$/i.test(raw) && raw !== existing?.value) throw new Error(`${field.key} 需要选择“是”或“否”。`);
    if (field.type === 'pipScale' && !enumChoices('pipScale').some(item => normalize(item.id) === normalize(raw)) && raw !== existing?.value) throw new Error('PipScale 需要选择已知类型，或保留原有值。');
    if ((field.type === 'weapon' || field.type === 'superweapon') && raw !== existing?.value && !/^(none|<none>)$/i.test(raw) && !project.section(raw)) throw new Error(`找不到 ${field.key} 所选对象 [${raw}] 的定义。`);
    selected[field.key] = raw;
  }
  if (feature.id === 'payload') {
    const types = tokens(selected['InitialPayload.Types']), nums = tokens(selected['InitialPayload.Nums']);
    const unchanged = ['InitialPayload.Types', 'InitialPayload.Nums'].every(key => selected[key] === (project.get(section, key)?.value || ''));
    if (!unchanged) {
      if (['InitialPayload.Types', 'InitialPayload.Nums'].some(key => selected[key] && selected[key].split(',').some(item => !item.trim()))) throw new Error('初始乘员类型或数量包含空项，请修正后重试。');
      if (!types.length && nums.length) throw new Error('请先选择初始乘员，再设置数量。');
      if (nums.length > types.length || nums.some(value => !validInt(value) || Number(value) < 1)) throw new Error('初始乘员数量必须为正整数，且数量项不能多于乘员类型。');
      const allowed = new Set([...listTypes(project, 'InfantryTypes'), ...(type === 'vehicle' ? listTypes(project, 'VehicleTypes') : [])].map(normalize));
      const old = new Set(tokens(project.get(section, 'InitialPayload.Types')?.value).map(normalize));
      for (const id of types) if ((!allowed.has(normalize(id)) || !project.section(id)) && !old.has(normalize(id))) throw new Error(`未找到可用的乘员 [${id}]。`);
      if (types.some(id => normalize(id) === normalize(section) && !old.has(normalize(id)))) throw new Error('对象不能将自身设为初始乘员。');
    }
  }
  const candidate = project.fork();
  const changes = [];
  for (const field of feature.fields) {
    const target = field.targetSection || section;
    const value = selected[field.key], before = project.get(target, field.key);
    const changeScope = field.targetSection ? { section: target, type: 'global' } : {};
    if ((!value && !before?.value) || (before && before.value === value)) continue;
    if (!value && field.allowClear) {
      for (const removed of candidate.remove(target, field.key)) {
        changes.push({ ...changeScope, kind: 'remove', key: removed.key, before: removed.before, after: null, file: removed.file });
      }
      continue;
    }
    candidate.set(target, field.key, value);
    const after = candidate.get(target, field.key);
    changes.push({ ...changeScope, key: field.key, before: before ? before.value : null, after: after?.value ?? '', file: after?.file || before?.file });
  }
  return { feature, project: candidate, section, changes, warnings: warningsFor(project, section, type, feature, selected) };
}

const passengerWeaponKey = /^(?:Primary|Secondary|ElitePrimary|EliteSecondary|Weapon\d+|EliteWeapon\d+)$/i;
const weaponReferenceKey = /^(?:Primary|Secondary|ElitePrimary|EliteSecondary|Weapon\d+|EliteWeapon\d+|OccupyWeapon|EliteOccupyWeapon|DeathWeapon|WeaponType|Nuke\.Payload|AirburstWeapon|ShrapnelWeapon)$/i;

// Includes other loaded rule sections, not just the current category. Unloaded or special references may still exist.
export function weaponReferences(project, id) {
  const target = normalize(id), result = [];
  if (!target) return result;
  for (const section of project.sections.values()) for (const field of section.fields.values()) {
    if (weaponReferenceKey.test(field.name) && normalize(field.value) === target) result.push({ section: section.name, key: field.name });
  }
  return result;
}

export function passengerWeapons(project, passenger) {
  const section = project.section(passenger);
  if (!section) return [];
  const groups = new Map();
  for (const field of section.fields.values()) {
    if (!passengerWeaponKey.test(field.name)) continue;
    const id = field.value.trim(), key = normalize(id);
    if (!key || /^(none|<none>)$/i.test(id)) continue;
    if (!groups.has(key)) groups.set(key, { id, slots: [], field: project.get(id, 'FireInTransport'), exists: !!project.section(id), references: weaponReferences(project, id) });
    groups.get(key).slots.push(field.name);
  }
  return [...groups.values()];
}

function suggestWeaponCopyId(project, id, reservedIds) {
  const reserved = new Set([...project.sections.keys(), ...reservedIds.map(normalize)]);
  for (const registry of ['WeaponTypes', 'InfantryTypes', 'VehicleTypes', 'AircraftTypes', 'BuildingTypes', 'Warheads', 'Projectiles', 'SuperWeaponTypes']) {
    for (const value of listTypes(project, registry)) reserved.add(normalize(value));
  }
  // Also avoid activating unresolved references that are not in a type registry.
  for (const section of project.sections.values()) for (const field of section.fields.values()) {
    if (/(?:weapon|primary|secondary|nuke\.payload)/i.test(field.name)) {
      for (const value of tokens(field.value)) reserved.add(normalize(value));
    }
  }
  for (let i = 1; i < 100000; i++) {
    const suffix = `_OT${i === 1 ? '' : i}`;
    const candidate = `${id.slice(0, MAX_GAME_OBJECT_ID_LENGTH - suffix.length)}${suffix}`;
    if (!reserved.has(normalize(candidate))) return candidate;
  }
  throw new Error(`无法为武器 ${id} 生成可用 ID。`);
}

// Direct edits or copied weapons and remapped passenger slots are prepared on a fork, as one preview.
export function preparePassengerFire(project, { type, section, passenger, mode, selections, reservedIds = [] }) {
  if (!quickFeaturesFor(type).some(feature => feature.id === 'passenger-fire') || !project.section(section)) throw new Error('此对象类型不支持乘员开火诊断。');
  const id = String(passenger ?? '').trim();
  const allowed = new Set([...listTypes(project, 'InfantryTypes'), ...listTypes(project, 'VehicleTypes')].map(normalize));
  if (!id || !allowed.has(normalize(id)) || !project.section(id)) throw new Error('请选择已定义的步兵或载具乘员。');
  if (type === 'infantry' && normalize(id) !== normalize(section)) throw new Error('请检查当前步兵的武器。');
  if (type === 'vehicle' && normalize(id) === normalize(section)) throw new Error('载具不能作为自身的乘员，请选择其他单位。');
  if (!['direct', 'copy'].includes(mode)) throw new Error('请选择修改共享武器或为乘员复制武器。');
  const weapons = passengerWeapons(project, id), byId = new Map(weapons.map(weapon => [normalize(weapon.id), weapon]));
  const updates = [], selectedById = new Map();
  for (const [weaponId, value] of Object.entries(selections || {})) {
    if (!value) continue;
    const key = normalize(weaponId), weapon = byId.get(key);
    if (!weapon || !weapon.exists || !/^(yes|no)$/.test(value)) throw new Error(`无法修改武器 ${weaponId}；请检查规则定义和选择。`);
    if (selectedById.has(key) && selectedById.get(key) !== value) throw new Error(`武器 ${weaponId} 的开火选项互相冲突。`);
    if (selectedById.has(key)) continue;
    selectedById.set(key, value);
    if ((value === 'yes' && enabled(weapon.field?.value)) || (value === 'no' && disabled(weapon.field?.value))) continue;
    updates.push({ ...weapon, value });
  }
  let candidate = project.fork();
  const changes = [], warnings = [];
  if (project.warnings.length) warnings.push(`规则加载不完整，诊断仅依据已加载的内容：${project.warnings[0]}`);
  if (type === 'vehicle') {
    const open = project.get(section, 'OpenTopped')?.value;
    if (!enabled(open)) warnings.push(`[${section}] 的 OpenTopped 当前未启用；仅修改乘员武器不足以开启车内开火。`);
    if (!project.get(section, 'Passengers')?.value || Number(project.get(section, 'Passengers')?.value) === 0) warnings.push(`[${section}] 尚未配置有效乘员容量，请检查 Passengers。`);
    const size = project.get(id, 'Size')?.value, limit = project.get(section, 'SizeLimit')?.value;
    if (size !== undefined && limit !== undefined && validInt(size) && validInt(limit) && Number(size) > Number(limit)) warnings.push(`[${id}] 的 Size=${size} 超过 [${section}] 的 SizeLimit=${limit}，可能无法进入。`);
    const allow = tokens(project.get(section, 'Passengers.Allowed')?.value).filter(value => !/^(none|<none>)$/i.test(value));
    const deny = tokens(project.get(section, 'Passengers.Disallowed')?.value).filter(value => !/^(none|<none>)$/i.test(value));
    if (allow.length && !allow.some(value => normalize(value) === normalize(id))) warnings.push(`[${section}] 的 Passengers.Allowed 未包含 ${id}，该乘员可能无法进入。`);
    if (deny.some(value => normalize(value) === normalize(id))) warnings.push(`[${section}] 的 Passengers.Disallowed 包含 ${id}，该乘员可能无法进入。`);
    if (enabled(project.get(section, 'NoManualEnter')?.value)) warnings.push(`[${section}] 的 NoManualEnter 已启用，玩家看不到手动进入指针。`);
    if (enabled(project.get(section, 'Gunner')?.value)) warnings.push(`[${section}] 启用了 Gunner，乘员武器和炮塔还受炮手逻辑影响。`);
  } else warnings.push('乘员所在载具还需要可容纳该单位并启用 OpenTopped；实际目标和开火逻辑也可能受其他规则影响。');
  const forced = project.get(id, 'OpenTransportWeapon')?.value;
  if (forced !== undefined && validInt(forced)) warnings.push(`[${id}] 的 OpenTransportWeapon=${forced} 会指定车内使用的武器槽，请结合目标和实际武器检查。`);
  if (!weapons.length) warnings.push(`没有找到 [${id}] 的普通、精英或编号武器。`);
  for (const weapon of weapons) {
    const next = selectedById.get(normalize(weapon.id)) || weapon.field?.value || '';
    if (!weapon.exists) warnings.push(`找不到乘员武器 [${weapon.id}] 的定义，无法确认车内开火状态。`);
    else if (disabled(next)) warnings.push(`[${weapon.id}] 的 FireInTransport 已关闭，不能使用此武器从开放式载具开火。`);
    else if (next && !enabled(next)) warnings.push(`[${weapon.id}] 的 FireInTransport=${next} 未识别，无法确认车内开火状态。`);
  }
  for (const weapon of updates) {
    if (mode === 'direct') {
      const before = candidate.get(weapon.id, 'FireInTransport');
      candidate.set(weapon.id, 'FireInTransport', weapon.value);
      const after = candidate.get(weapon.id, 'FireInTransport');
      changes.push({ section: weapon.id, type: 'weapon', key: 'FireInTransport', before: before?.value ?? null, after: after.value, file: after.file });
      const others = weapon.references.filter(ref => normalize(ref.section) !== normalize(id));
      if (others.length) warnings.push(`直接修改 [${weapon.id}] 会影响至少 ${others.length} 处其他已识别引用，例如 ${others.slice(0, 3).map(ref => `[${ref.section}]${ref.key}`).join('、')}；未加载或特殊引用可能未列出。`);
    } else {
      const copyId = suggestWeaponCopyId(candidate, weapon.id, reservedIds);
      const created = prepareObjectCreation(candidate, { type: 'weapon', id: copyId, template: weapon.id, reservedIds });
      candidate = created.project;
      changes.push({ kind: 'copy', section: copyId, type: 'weapon', before: weapon.id, after: copyId, file: created.definitionFile });
      changes.push({ section: created.registry, key: String(created.registryIndex), before: null, after: copyId, file: created.registryFile });
      const before = candidate.get(copyId, 'FireInTransport');
      candidate.set(copyId, 'FireInTransport', weapon.value);
      const after = candidate.get(copyId, 'FireInTransport');
      changes.push({ section: copyId, type: 'weapon', key: 'FireInTransport', before: before?.value ?? null, after: after.value, file: after.file });
      for (const slot of weapon.slots) {
        const old = candidate.get(id, slot);
        candidate.set(id, slot, copyId);
        changes.push({ section: id, type: 'passenger', key: slot, before: old.value, after: copyId, file: candidate.get(id, slot).file });
      }
    }
  }
  if (mode === 'copy' && updates.length) warnings.push('仅替换此乘员列出的武器槽；复制的武器仍共享原来的弹头、投射物和其他引用，并可能影响该乘员乘坐其他开放式载具时的行为。');
  return { feature: quickFeaturesFor(type).find(item => item.id === 'passenger-fire'), project: candidate, section, changes, warnings };
}
