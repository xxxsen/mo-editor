// Completely fictional data, included only to exercise the editor.
export const DEMO_MAIN = `; 编辑器演示文件；不是游戏数据
[#include]
0=demo-units.ini

[General]
Name=示例全局配置
BuildSpeed=.6
RefundPercent=50%
VeteranRatio=4.5
TiberiumGrows=yes

[MultiplayerDialogSettings]
Money=10000
MaxMoney=50000
Crates=yes

[CombatDamage]
DestroyableBridges=yes
BridgeStrength=2500

[IQ]
RepairSell=1

[Sides]
Allied=Allied
Soviet=Soviet
Epsilon=Epsilon
Foehn=Foehn

[Countries]
0=Allied
1=Soviet
2=Epsilon
3=Foehn

[Allied]
Name=示例盟军

[Soviet]
Name=示例苏联

[Epsilon]
Name=示例厄普西隆

[Foehn]
Name=示例焚风

[ArmorTypes]
demo_tank=heavy
demo_hero=flak

[InfantryTypes]
0=DEMO_RANGER
1=DEMO_ENGINEER

[VehicleTypes]
0=DEMO_VANGUARD
1=DEMO_WALKER
2=DEMO_ARTILLERY

[AircraftTypes]
0=DEMO_AIRCRAFT

[BuildingTypes]
0=DEMO_FACTORY

[SuperWeaponTypes]
0=DEMO_POWER
1=DEMO_SUPPORT

[Warheads]
0=DEMO_AP
1=DEMO_HE

[DEMO_RANGER]
Name=示例突击兵
Strength=125
Cost=200
Speed=5
Armor=flak
Owner=Allied
Primary=DEMO_RIFLE

[DEMO_ENGINEER]
Name=示例工程师
Strength=75
Cost=500
Speed=4
Armor=none
Owner=Allied

[DEMO_WALKER]
Name=示例步行机甲
Strength=520
Cost=1200
Speed=5
Armor=heavy
Owner=Epsilon
Primary=DEMO_CANNON

[DEMO_ARTILLERY]
Name=示例攻城火炮
Strength=280
Cost=1100
Speed=4
Armor=light
Owner=Soviet
Primary=DEMO_HOWITZER

[DEMO_AIRCRAFT]
Name=示例飞行器
Strength=220
Cost=1400
Speed=16
Armor=light
Owner=Foehn
Primary=DEMO_RIFLE

[DEMO_FACTORY]
Name=示例载具工厂
Strength=1000
Cost=2000
Armor=wood
Owner=Allied
SuperWeapon=DEMO_POWER
SuperWeapons=DEMO_SUPPORT

[DEMO_POWER]
Name=示例超级武器
Type=GenericWarhead
RechargeTime=5
IsPowered=yes
SW.Range=3,3
SW.Damage=200
SW.Warhead=DEMO_HE

[DEMO_SUPPORT]
Name=示例支援技能
Type=ParaDrop
RechargeTime=4

[DEMO_CANNON]
Damage=70
ROF=65
Range=6
Projectile=DEMO_SHELL
Warhead=DEMO_AP

[DEMO_RIFLE]
Damage=18
ROF=20
Range=4
Projectile=DEMO_BULLET
Warhead=DEMO_HE

[DEMO_HOWITZER]
Damage=110
ROF=110
Range=10
Projectile=DEMO_SHELL
Warhead=DEMO_HE

[DEMO_AP]
Verses=25%,25%,25%,75%,100%,100%,65%,45%,60%,100%,100%
Versus.demo_tank=80%
CellSpread=0.2

[DEMO_HE]
Verses=100%,100%,100%,50%,25%,10%,75%,50%,25%,100%,100%
CellSpread=0.5
`;

export const DEMO_UNITS = `; 此文件模拟 Ares include 对已有属性的覆盖
[DEMO_VANGUARD]
Name=示例先锋坦克
Strength=400       ; 装甲耐久
Cost=850
Speed=7
Armor=heavy
Sight=8
Owner=Allied
Prerequisite=DEMO_FACTORY
Primary=DEMO_CANNON
`;
