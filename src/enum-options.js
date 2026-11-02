// 已核对的规则枚举集中维护；其他模组的未知值仍由编辑器保留。
// 原版：https://gist.github.com/Mirage-Zero-Nine/0c2df4046c279a15ee1f80e6d1608e7d
// Ares：https://ares-developers.github.io/Ares-docs/new/veteranabilities.html
//       https://ares-developers.github.io/Ares-docs/new/superweapons/targeting.html
const make = (group, entries) => entries.map(([id, label, hint]) => ({ id, label, hint, group }));

const abilities = [
  ...make('原版晋升能力', [
    ['SELF_HEAL', '自动回血', '按自愈规则恢复生命值。'],
    ['FIREPOWER', '增强火力', '使用 VeteranCombat 调整武器伤害。'],
    ['FASTER', '加快移动', '使用 VeteranSpeed 调整移动速度。'],
    ['STRONGER', '增强防御', '使用 VeteranArmor 调整受到的伤害。'],
    ['ROF', '调整射速', '使用 VeteranROF 调整攻击间隔；1.0 表示不变。'],
    ['SIGHT', '调整视野', '使用 VeteranSight 调整视野；不会改变武器射程。'],
    ['CLOAK', '隐形', '获得隐形能力，表现还受其他隐形规则影响。'],
    ['RADAR_INVISIBLE', '雷达不可见', '不在敌方雷达上显示；不等于战场隐形。'],
    ['SENSORS', '隐形探测', '探测附近的隐形对象；范围还受其他设置影响。'],
    ['SCATTER', '自动散开', '遇到部分攻击或碾压威胁时自动散开。'],
    ['FEARLESS', '无畏', '免受恐惧相关行为影响，主要用于步兵。'],
    ['GUARD_AREA', '区域警戒', '使用默认区域警戒行为。'],
    ['CRUSHER', '碾压', '获得碾压能力；可否碾压还受双方规则限制。'],
    ['C4', 'C4 破坏', '使符合条件的步兵获得 C4 破坏能力；Ares 修复了原版问题。'],
    ['EXPLODES', '爆炸死亡', '影响被摧毁时的爆炸或死亡处理，效果取决于单位配置。'],
  ]),
  ...make('Ares 扩展晋升能力', [
    ['EMPIMMUNE', '免疫 EMP', '免疫 EMP 停机效果；需要 Ares。'],
    ['RADIMMUNE', '免疫辐射', '免疫辐射弹头和辐射场效果；需要 Ares。'],
    ['PROTECTED_DRIVER', '保护驾驶员', '抵御清除驾驶员的效果；需要 Ares。'],
    ['UNWARPABLE', '免疫时空武器', '免疫 Temporal=yes 武器；需要 Ares。'],
    ['POISONIMMUNE', '免疫毒素武器', '免疫 Poison=yes 武器；需要 Ares。'],
    ['PSIONICWEAPONIMMUNE', '免疫精神伤害武器', '免疫 PsychicDamage=yes 武器；需要 Ares。'],
    ['PSIONICSIMMUNE', '免疫心灵控制', '免疫常规心灵控制等效果；心灵控制器可能覆盖，且需要 Ares。'],
  ]),
  ...make('旧版矿物机制', [
    ['TIBERIUM_PROOF', '免疫泰伯利亚伤害', '需要对应的矿物伤害机制。'],
    ['VEIN_PROOF', '免疫矿脉伤害', '需要对应的矿脉机制。'],
    ['TIBERIUM_HEAL', '矿物中回血', '需要对应的矿物治疗机制。'],
  ]),
];

const definitions = {
  boolean: { title: '选择开关', options: make('开关', [['yes', '是'], ['no', '否']]) },
  phobosTrajectory: { title: '选择投射物轨迹', description: 'Phobos 0.4 轨迹会停用冲突的原版轨迹逻辑。', options: make('Phobos 0.4', [['Straight', '直线'], ['Bombard', '轰炸']]) },
  phobosInterceptorSlot: { title: '选择拦截武器槽', options: make('Phobos 0.4', [['0', '主武器'], ['1', '副武器']]) },
  phobosAutoDeath: { title: '选择自动销毁方式', options: make('Phobos 0.4', [['kill', '正常摧毁'], ['vanish', '直接移除'], ['sell', '出售建筑']]) },
  phobosHouses: { title: '选择所属方范围', multiple: true, exclusive: ['none', 'all'], options: make('Phobos 0.4', [['none', '无'], ['owner', '自身'], ['allies', '盟友'], ['team', '自身与盟友'], ['enemies', '敌方'], ['all', '全部']]) },
  phobosTargets: { title: '选择暴击目标类型', multiple: true, exclusive: ['none', 'all'], options: make('Phobos 0.4', [['none', '无'], ['land', '陆地'], ['water', '水面'], ['infantry', '步兵'], ['units', '载具'], ['buildings', '建筑'], ['all', '全部']]) },

  abilities: {
    title: '选择晋升能力', multiple: true,
    description: '可搜索中文或规则代码；精英会保留老兵能力。Ares 选项需要对应扩展。未识别的现有值会保留。',
    options: abilities,
  },
  category: { title: '选择对象类别', options: make('对象类别', [
    ['Soldier', '士兵'], ['Civilian', '平民'], ['VIP', '重要人物'], ['Recon', '侦察'], ['AFV', '战斗载具'],
    ['IFV', '步兵战车'], ['LRFS', '远程火力'], ['Support', '支援'], ['Transport', '运输'], ['AirPower', '空中战斗'], ['AirLift', '空运'],
  ]) },
  speedType: { title: '选择移动类型', options: make('移动类型', [
    ['Foot', '步行'], ['Track', '履带'], ['Wheel', '轮式'], ['Hover', '悬浮'], ['Winged', '飞行'],
    ['Float', '水面'], ['Amphibious', '两栖'], ['FloatBeach', '水面与海滩'],
  ]) },
  movementZone: { title: '选择移动区域类型', options: make('移动区域类型', [
    ['Normal', '普通'], ['Crusher', '可碾压'], ['Destroyer', '可破坏障碍'], ['AmphibiousDestroyer', '两栖并可破坏障碍'],
    ['AmphibiousCrusher', '两栖并可碾压'], ['Amphibious', '两栖'], ['Subterannean', '地下'], ['Infantry', '步兵'],
    ['InfantryDestroyer', '步兵并可破坏障碍'], ['Fly', '飞行'], ['Water', '水域'], ['WaterBeach', '水域与海滩'], ['CrusherAll', '广泛碾压'],
  ]) },
  pipScale: { title: '选择状态标记类型', options: make('状态标记类型', [
    ['none', '不显示'], ['Ammo', '弹药'], ['Tiberium', '矿物'], ['Passengers', '乘员'], ['Power', '电力'], ['MindControl', '心灵控制数量'],
  ]) },
  buildCat: { title: '选择建筑分类', options: make('建筑分类', [
    ['DontCare', '自动判定'], ['Tech', '科技'], ['Resource', '资源'], ['Power', '电力'], ['Infrastructure', '基础设施'], ['Combat', '战斗与防御'],
  ]) },
  factory: { title: '选择生产类别', options: make('生产类别', [
    ['InfantryType', '步兵'], ['UnitType', '载具'], ['AircraftType', '飞机'], ['BuildingType', '建筑'],
  ]) },
  swHouse: {
    title: '选择所属方', multiple: true, exclusive: ['none', 'all'],
    description: '可组合所属方；none 与 all 单独使用。留空时的默认值、none 的含义由具体字段和超级武器类型决定。',
    options: make('所属方', [
      ['none', '无／不限制', '影响范围与目标限制字段对 none 的处理不同，请结合字段说明。'],
      ['owner', '自身'], ['allies', '盟友'], ['team', '自身与盟友'], ['enemies', '敌方'], ['others', '盟友与敌方'], ['all', '所有所属方'],
    ]),
  },
  swTarget: {
    title: '选择目标类型', multiple: true, exclusive: ['none', 'all'],
    description: '可组合地形与对象类型；none 与 all 单独使用。未设置时的默认值和可选组合由具体超级武器决定。',
    options: make('目标类型', [
      ['none', '不设置限制', '不指定具体限制；实际效果取决于字段和超级武器类型。'],
      ['land', '陆地'], ['water', '水面'], ['empty', '空地'], ['infantry', '步兵'], ['units', '载具'], ['buildings', '建筑'], ['all', '全部目标'],
    ]),
  },
  swAITargeting: {
    title: '选择电脑目标选择方式', description: '不同方式的目标条件和默认限制不同；请结合超级武器类型设置。',
    options: make('Ares 电脑目标选择', [
      ['None', '不自动释放'], ['Nuke', '核弹式选目标'], ['LightningStorm', '闪电风暴'], ['PsychicDominator', '心灵控制器'],
      ['GeneticMutator', '基因突变器'], ['IronCurtain', '铁幕脚本请求'], ['ForceShield', '力场护盾'], ['ParaDrop', '伞兵空降'],
      ['DropPod', '空降舱'], ['Offensive', '进攻目标'], ['MultiMissile', '多枚导弹'], ['HunterSeeker', '猎杀者'],
      ['NoTarget', '无目标释放'], ['Stealth', '隐形目标'], ['Self', '提供超级武器的建筑'], ['Base', '己方基地中心'],
      ['EnemyBase', '敌方基地中心'], ['Attack', '近期遭受攻击时'], ['LowPower', '电力不足时'], ['LowPowerAttack', '电力不足并遭受攻击时'], ['LightningRandom', '随机格'],
    ]),
  },
  swPreference: { title: '选择电脑目标偏好', options: make('目标偏好', [
    ['None', '无偏好'], ['Offensive', '进攻位置'], ['Defensive', '防御位置'],
  ]) },
  swConstraints: {
    title: '选择电脑目标约束', multiple: true, exclusive: ['none'],
    exclusiveGroups: [['Offensive_Cell_Set', 'Offensive_Cell_Clear'], ['Defensive_Cell_Set', 'Defensive_Cell_Clear']],
    description: '选中的约束需同时满足；none 单独使用。默认约束取决于超级武器类型。',
    options: make('目标约束', [
      ['None', '无约束'], ['Enemy', '已有首要敌人'], ['Offensive_Cell_Set', '已设置进攻位置'], ['Offensive_Cell_Clear', '未设置进攻位置'],
      ['Defensive_Cell_Set', '已设置防御位置'], ['Defensive_Cell_Clear', '未设置防御位置'], ['LightningStorm_Inactive', '没有闪电风暴'],
      ['Dominator_Inactive', '没有心灵控制器效果'], ['Attacked', '近期遭到攻击'], ['LowPower', '电力不足'],
    ]),
  },
};

const keyOf = value => String(value ?? '').trim().toLowerCase();
const units = new Set(['infantry', 'vehicle', 'aircraft', 'building']);
const technoBooleans = new Set(`trainable experience.frompassengers experience.promotepassengers promote.includepassengers selfhealing immunetoemp immunetopsionics immunetopsionicweapons immunetoradiation immunetoveins immunetoabduction protecteddriver crusher crushable omnicrusher cloakable cloakstop cloakable.powered sensors sensorarray radarinvisible radarvisible selectable legaltarget isselectablecombatant canpassiveaquire canretaliate insignificant nominal turret accelerates movingfire opportunityfire deploytofire deployfire deployer preventattackmove preventautodeploy allowedtostartinmultiplayer powered radar refinery orepurifier constructionyard weaponsfactory capturable canbeoccupied canoccupyfire opentopped nomanualenter nomanualunload passengers.bysize producecashdisplay explodes gunner naval jumpjet balloonhover fighter organic cyborg engineer agent infiltrate fearless c4`.split(' '));
const projectileBooleans = new Set(`inviso aa ag an as asw arcing inaccurate proximity shadow high veryhigh level vertical dropping subjecttocliffs subjecttoelevation subjecttowalls subjecttobuildings subjecttotrenches ignoresfirestorm ranged airburst splits aroundtarget retargetself flakscatter firerspalette scalable rotates`.split(' '));
const superweaponBooleans = new Set(`ispowered showtimer disableablefromshell sw.initialready sw.virtualcharge sw.autofire sw.manualfire sw.fireintoshroud sw.useaitargeting sw.showcameo`.split(' '));
const weaponBooleans = new Set(`revealonfire fireintransport ivanbomb.detachable ivanbomb.destroysbridges decloaktofire omnifire bright islaser issonic israilgun isradbeam`.split(' '));
const warheadBooleans = new Set(`ivanbomb mindcontrol temporal psychicdamage psychedelic poison radiation preventscatter malicious rocker`.split(' '));
const phobosBooleans = {
  unit: new Set(['interceptor', 'interceptor.deleteonintercept', 'passengers.syncowner', 'passengers.syncowner.revertonexit', 'passengerdeletion.dontscore', 'passengerdeletion.rate.sizemultiply', 'passengerdeletion.soylent', 'autodeath.onammodepletion', 'immunetocrit', 'multimindcontrol.releasevictim']),
  weapon: new Set(['burst.firewithinsequence', 'attacheffect.checkonfirer']),
  projectile: new Set(['interceptable', 'interceptable.deleteonintercept', 'trajectory.straight.passthrough']),
  warhead: new Set(['crit.applychancepertarget', 'crit.warhead.fulldetonation', 'shield.penetrate', 'shield.break']),
  superweapon: new Set(['detonate.atfirer', 'detonate.warhead.full', 'sw.next.reallaunch']),
  shield: new Set(['inheritarmorfromtechno', 'powered', 'absorboverdamage', 'selfhealing.restartincombat', 'immunetocrit']),
  attachtype: new Set(['cumulative', 'powered', 'cloakable', 'forcedecloak']),
  radiation: new Set(['radsitewarhead.detonate', 'radhasowner', 'radhasinvoker']),
  lasertrail: new Set(['ishousecolor', 'ignorevertical', 'isintense', 'cloakvisible', 'cloakvisible.detectedonly']),
};
const targetFields = new Set(['sw.affectstarget', 'sw.requirestarget', 'sw.airequirestarget']);
const houseFields = new Set(['sw.affectshouse', 'sw.requireshouse', 'sw.airequireshouse', 'sw.timervisibility', 'sw.animationvisibility', 'lightning.radaroutageaffects']);

export function enumKindForField(type, field) {
  const name = keyOf(field);
  if (type === 'building' && (name === 'needsengineer' || name === 'unsellable')) return 'boolean';
  if ((units.has(type) ? phobosBooleans.unit : phobosBooleans[type])?.has(name)) return 'boolean';
  if (units.has(type) && name === 'interceptor.weapon') return 'phobosInterceptorSlot';
  if (units.has(type) && name === 'autodeath.behavior') return 'phobosAutoDeath';
  if (type === 'projectile' && name === 'trajectory') return 'phobosTrajectory';
  if (type === 'warhead' && name === 'crit.affects') return 'phobosTargets';
  if ((type === 'warhead' && name === 'crit.affectshouses') || (units.has(type) && /^passengerdeletion\.(allowedhouses|soylentallowedhouses)$/.test(name))) return 'phobosHouses';
  if ((units.has(type) && technoBooleans.has(name)) || (type === 'projectile' && projectileBooleans.has(name))
    || (type === 'superweapon' && superweaponBooleans.has(name)) || (type === 'weapon' && weaponBooleans.has(name))
    || (type === 'warhead' && warheadBooleans.has(name))) return 'boolean';
  if (units.has(type)) {
    if (name === 'veteranabilities' || name === 'eliteabilities') return 'abilities';
    if (name === 'category') return 'category';
    if (name === 'pipscale') return 'pipScale';
    if (type !== 'building' && name === 'speedtype') return 'speedType';
    if (type !== 'building' && name === 'movementzone') return 'movementZone';
    if (type === 'building' && name === 'buildcat') return 'buildCat';
    if (type === 'building' && name === 'factory') return 'factory';
  }
  if (type === 'superweapon') {
    if (houseFields.has(name)) return 'swHouse';
    if (targetFields.has(name)) return 'swTarget';
    if (name === 'sw.aitargeting') return 'swAITargeting';
    if (name === 'sw.aitargeting.preference') return 'swPreference';
    if (name === 'sw.aitargeting.constraints') return 'swConstraints';
  }
  return '';
}

export function enumDefinition(kind) { return definitions[kind] || null; }

export function enumChoices(kind, current = '') {
  const definition = enumDefinition(kind);
  if (!definition) return [];
  const choices = definition.options.map(option => ({ ...option }));
  if (kind === 'boolean' && /^(true|false)$/i.test(String(current).trim())) {
    choices[0].id = 'true'; choices[1].id = 'false';
  }
  const seen = new Set(choices.map(option => keyOf(option.id)));
  const values = definition.multiple ? String(current).split(',') : [current];
  for (const value of values) {
    const id = String(value).trim(), key = keyOf(id);
    if (id && !seen.has(key)) {
      choices.push({ id, label: id, group: '当前未识别的代码', hint: '原值会保留；请确认游戏或扩展是否支持。' });
      seen.add(key);
    }
  }
  return choices;
}

// 仅在用户主动勾选时处理互斥项，不改动原有的未知值或未经操作的组合。
export function selectEnumOption(kind, selected, id, checked) {
  const definition = enumDefinition(kind), item = keyOf(id);
  if (!definition || !checked) return;
  const exclusive = new Set((definition.exclusive || []).map(keyOf));
  const known = new Set(definition.options.map(option => keyOf(option.id)));
  if (exclusive.has(item)) {
    for (const value of selected.keys()) if (known.has(value) && value !== item) selected.delete(value);
  } else {
    for (const value of exclusive) selected.delete(value);
  }
  for (const group of definition.exclusiveGroups || []) {
    const related = group.map(keyOf);
    if (related.includes(item)) for (const value of related) if (value !== item) selected.delete(value);
  }
}
