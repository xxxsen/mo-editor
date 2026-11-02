# 规则与兼容性

编辑器展示和修改已加载的规则；实际效果还取决于游戏版本、扩展引擎、地图、模式以及其他可能覆盖配置的文件。项目不包含心灵终结或游戏本体资源。

## 规则对象与引用

超级武器读取 `[SuperWeaponTypes]` 登记项，可编辑充能、费用、效果和限制等字段，也可查看建筑及其他提供对象。未定义字段的默认值取决于超级武器类型和游戏引擎。

投射物从 `[Projectiles]` 列表及已识别武器的 `Projectile` 引用收集；编辑器也会继续解析空爆和弹片子武器。修改共享武器、弹头或投射物会影响引用它们的对象；未加载文件和特殊逻辑中的引用可能未列出。

武器的 `Warhead` 是直接命中弹头，`IvanBomb.Warhead` 是附着炸弹爆炸弹头。命中弹头需要启用 `IvanBomb=yes`，炸弹效果才会生效；未单独设置或留空时，编辑器根据已加载的 `[CombatDamage]IvanWarhead` 显示全局默认值及来源，不会自动写入覆盖值。详见 [Ares 炸弹规则](https://ares-developers.github.io/Ares-docs/new/weapons/ivanbombs.html)。

武器效果对照分别展示命中和炸弹的弹头。基础装甲读取 `Verses`；扩展装甲优先读取当前装甲的 `Versus.<装甲>`，否则追踪 `[ArmorTypes]` 的默认关系。按 Ares 初始化顺序，父装甲的专属 `Versus` 不会自动应用到子装甲。显示的伤害与修正乘积只用于解释配置，不计算特殊武器、免疫、溅射、目标选择或实战伤害。参考 [Ares 装甲规则](https://ares-developers.github.io/Ares-docs/new/additionalarmortypesandverses.html)和[装甲加载代码](https://github.com/Ares-Developers/Ares/blob/master/src/Enum/ArmorTypes.cpp)。

## 快捷功能

快捷功能的表单会带入当前已有值，包括未保存修改；缺少的必要字段提供可调整的建议值，可选字段留空时不写入。确认预览后仍需保存。实际生效条件取决于单位类型、其他规则和相应扩展版本。

### 运输与建筑驻军

载具运输涉及 `Passengers`、`SizeLimit`、`PipScale`、`OpenTopped` 等字段；建筑驻军涉及 `CanBeOccupied`、`MaxNumberOccupants` 和 `CanOccupyFire`。步兵的体型、驻军能力、武器、名单限制及建筑美术等条件仍然生效。已有武器的建筑配置驻军时，界面会提醒其原有武器可能失效。

初始乘员可按类型和数量配置，并根据当前容量和体型提示限制；该功能不会自动修改其他运输或驻军字段。参考 [Ares 乘员规则](https://ares-developers.github.io/Ares-docs/new/passengers.html)和[初始乘员与驻军](https://ares-developers.github.io/Ares-docs/new/initialpayload.html)。

载具的乘员经验字段需要 Ares 支持：

- `Experience.FromPassengers` 控制载具是否获得乘员击杀经验。
- `Experience.PromotePassengers` 控制精英载具是否将后续击杀经验交给射击乘员。
- `Experience.PassengerModifier` 是乘员实际获得经验时的倍率，不是双方经验分配比例。
- `Promote.IncludePassengers` 在载具晋升时同步可升级乘员等级，会覆盖乘员原有等级和经验，可能导致降级。载具和乘员自身的 `Trainable` 仍然生效。

表单显示 Ares 默认值，留空不会写入。参考 [Ares 经验规则](https://ares-developers.github.io/Ares-docs/new/customizableveterancy.html)和[乘员等级同步](https://ares-developers.github.io/Ares-docs/new/promotion.html)。

### 科技建筑及其他能力

建筑快捷功能提供科技采油井式的定期收入、科技医院的所属方步兵自动治疗，以及科技机械商店的所属方单位自动维修；可选配置工程师占领和出售限制。医院和机械商店的恢复间隔、基础恢复量位于全局 `[General]`，修改后影响所有玩家。未加载 `[General]` 时，这些字段不可修改，仍可设置建筑自身能力。

免疫项目支持保留或恢复游戏默认值。恢复默认或清空可选择字段时，会移除所有已加载文件中该规则段的同名定义，预览逐一列出变更；加载不完整时不能安全移除。地图、模式或未加载规则仍可能覆盖默认值。建筑自带隐形、建筑探测器、初始乘员及额外超级武器等功能需要对应 Ares 支持。

## 文件格式与加载限制

- 未改动的文件按原始字节输出；修改已有属性时保留所在行的其他内容、注释、顺序和原始换行。修改写入已加载文件中最后一个定义该属性的位置，新增属性写入最后一个同名区块。
- 规则文件支持 UTF-8 和常见 GBK。为避免破坏原始编码，GBK 和无法判断编码的纯 ASCII 文件目前只允许写入 ASCII 字符；规则文件暂不支持 UTF-16。历史快照的差异查看另支持 UTF-16。
- 按 Ares 的 `[#include]` 深度优先顺序解析导入文件；找不到独立文件时，在 MIX 中查找不带子目录的 include。不支持 Phobos INI 包含机制或 `$Inherits` 继承，出现这些规则或缺少引用时会提示。
- 未加密 MIX 索引可用于读取主规则、美术配置和 PCX 图标；暂不支持加密索引、嵌套 MIX、SHP 图标或模型动画。资源仅在内存中按需读取，不解包到磁盘。
- 选择的文件中包含 `ra2md.csf` 时，名称优先使用 `UIName` 对应的本地字符串，否则回退到 INI 的 `Name` 或代码。找到 PCX 资源后，单位图标从美术配置读取，超级武器图标从 `SidebarPCX` 读取。
- 国家、装甲及前置选项根据当前规则生成，未登记的原有代码会保留。基础装甲伤害修正按游戏的 11 类固定顺序编辑，不会自动补齐未设置项。
- 桌面版「保存」直接修改选择的游戏目录并自动备份；「另存为」输出到另选目录。浏览器版只下载文件。程序不启动游戏，也不保证当前客户端加载生成的文件，仍需在游戏中验证。
