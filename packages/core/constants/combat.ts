import * as Buff from './buff.ts';
import * as UnitType from './unit-type.ts';
import * as Upgrade from './upgrade.ts';
import { Attribute, WeaponTargetType } from './enums.ts';

export const speedUpgrade: Record<number, number> = {
    [UnitType.MEDIVAC]: Upgrade.MEDIVACRAPIDDEPLOYMENT,
    [UnitType.BANSHEE]: Upgrade.BANSHEESPEED,
    [UnitType.ZEALOT]: Upgrade.CHARGE,
    [UnitType.OBSERVER]: Upgrade.OBSERVERGRAVITICBOOSTER,
    [UnitType.WARPPRISM]: Upgrade.GRAVITICDRIVE,
    [UnitType.VOIDRAY]: Upgrade.VOIDRAYSPEEDUPGRADE,
    [UnitType.OVERLORD]: Upgrade.OVERLORDSPEED,
    [UnitType.OVERSEER]: Upgrade.OVERLORDSPEED,
    [UnitType.ZERGLING]: Upgrade.ZERGLINGMOVEMENTSPEED,
    [UnitType.BANELING]: Upgrade.CENTRIFICALHOOKS,
    [UnitType.ROACH]: Upgrade.GLIALRECONSTITUTION,
    [UnitType.LURKERMP]: Upgrade.DIGGINGCLAWS,
};

export const speedIncrease: Record<number, number> = {
    [UnitType.MEDIVAC]: 1.18,
    [UnitType.BANSHEE]: 1.3636,
    [UnitType.ZEALOT]: 1.5,
    [UnitType.OBSERVER]: 2,
    [UnitType.WARPPRISM]: 1.3,
    [UnitType.VOIDRAY]: 1.328,
    [UnitType.OVERLORD]: 2.915,
    [UnitType.OVERSEER]: 1.8015,
    [UnitType.ZERGLING]: 1.6,
    [UnitType.BANELING]: 1.18,
    [UnitType.ROACH]: 1.3333333333,
    [UnitType.LURKERMP]: 1.1,
};

export const speedIncreaseOnCreep: Record<number, number> = {
    [UnitType.QUEEN]: 2.67,
    [UnitType.ZERGLING]: 1.3,
    [UnitType.BANELING]: 1.3,
    [UnitType.ROACH]: 1.3,
    [UnitType.RAVAGER]: 1.3,
    [UnitType.HYDRALISK]: 1.3,
    [UnitType.LURKERMP]: 1.3,
    [UnitType.ULTRALISK]: 1.3,
    [UnitType.INFESTOR]: 1.3,
    [UnitType.INFESTORTERRAN]: 1.3,
    [UnitType.SWARMHOSTMP]: 1.3,
    [UnitType.LOCUSTMP]: 1.4,
    [UnitType.SPINECRAWLER]: 2.5,
    [UnitType.SPORECRAWLER]: 2.5,
};

export const offCreepSpeedUpgrade: Record<number, number> = {
    [UnitType.HYDRALISK]: Upgrade.EVOLVEMUSCULARAUGMENTS,
    [UnitType.ULTRALISK]: Upgrade.ANABOLICSYNTHESIS,
};

export const offCreepSpeedIncrease: Record<number, number> = {
    [UnitType.HYDRALISK]: 1.25,
    [UnitType.ULTRALISK]: 1.2,
};

// Unnamed in 4.10 data; python-sc2's DUTCHMARAUDERSLOW id, and the named ids on both sides of it match 4.10
export const CONCUSSIVE_SLOW_BUFF = 226;

export const speedAlteringBuffs: Record<number, number> = {
    [Buff.STIMPACK]: 1.5,
    [CONCUSSIVE_SLOW_BUFF]: 0.5,
    [Buff.STIMPACKMARAUDER]: 1.5,
    [Buff.CHARGEUP]: 2.2,
    [Buff.TIMEWARPPRODUCTION]: 0.5,
    [Buff.FUNGALGROWTH]: 0.25,
    [Buff.INHIBITORZONETEMPORALFIELD]: 0.65,
};

export type UpgradeDamageBonus = { base?: number } & Record<number, number>;

export const damageBonusPerUpgrade: Record<number, Record<number, UpgradeDamageBonus>> = {
    [UnitType.PROBE]: { [WeaponTargetType.GROUND]: { base: 0 } },
    [UnitType.ADEPT]: { [WeaponTargetType.GROUND]: { [Attribute.LIGHT]: 1 } },
    [UnitType.STALKER]: { [WeaponTargetType.ANY]: { [Attribute.ARMORED]: 1 } },
    [UnitType.DARKTEMPLAR]: { [WeaponTargetType.GROUND]: { base: 5 } },
    [UnitType.ARCHON]: { [WeaponTargetType.ANY]: { base: 3, [Attribute.BIOLOGICAL]: 1 } },
    [UnitType.IMMORTAL]: { [WeaponTargetType.GROUND]: { base: 2, [Attribute.ARMORED]: 3 } },
    [UnitType.COLOSSUS]: { [WeaponTargetType.GROUND]: { [Attribute.LIGHT]: 1 } },
    [UnitType.ORACLE]: { [WeaponTargetType.GROUND]: { base: 0 } },
    [UnitType.TEMPEST]: {
        [WeaponTargetType.GROUND]: { base: 4 },
        [WeaponTargetType.AIR]: { base: 3, [Attribute.MASSIVE]: 2 },
    },
    [UnitType.SCV]: { [WeaponTargetType.GROUND]: { base: 0 } },
    [UnitType.MARAUDER]: { [WeaponTargetType.GROUND]: { [Attribute.ARMORED]: 1 } },
    [UnitType.GHOST]: { [WeaponTargetType.ANY]: { [Attribute.LIGHT]: 1 } },
    [UnitType.HELLION]: { [WeaponTargetType.GROUND]: { [Attribute.LIGHT]: 1 } },
    [UnitType.HELLIONTANK]: { [WeaponTargetType.GROUND]: { base: 2, [Attribute.LIGHT]: 1 } },
    [UnitType.CYCLONE]: { [WeaponTargetType.ANY]: { base: 2 } },
    [UnitType.SIEGETANK]: { [WeaponTargetType.GROUND]: { base: 2, [Attribute.ARMORED]: 1 } },
    [UnitType.SIEGETANKSIEGED]: { [WeaponTargetType.GROUND]: { base: 4, [Attribute.ARMORED]: 1 } },
    [UnitType.THOR]: { [WeaponTargetType.GROUND]: { base: 3 }, [WeaponTargetType.AIR]: { [Attribute.LIGHT]: 1 } },
    [UnitType.THORAP]: {
        [WeaponTargetType.GROUND]: { base: 3 },
        [WeaponTargetType.AIR]: { base: 3, [Attribute.MASSIVE]: 1 },
    },
    [UnitType.VIKINGASSAULT]: { [WeaponTargetType.GROUND]: { [Attribute.MECHANICAL]: 1 } },
    [UnitType.LIBERATORAG]: { [WeaponTargetType.GROUND]: { base: 5 } },
    [UnitType.DRONE]: { [WeaponTargetType.GROUND]: { base: 0 } },
    [UnitType.BANELING]: { [WeaponTargetType.GROUND]: { base: 2, [Attribute.LIGHT]: 2, [Attribute.STRUCTURE]: 3 } },
    [UnitType.ROACH]: { [WeaponTargetType.GROUND]: { base: 2 } },
    [UnitType.RAVAGER]: { [WeaponTargetType.GROUND]: { base: 2 } },
    [UnitType.LURKERMPBURROWED]: { [WeaponTargetType.GROUND]: { base: 2, [Attribute.ARMORED]: 1 } },
    [UnitType.ULTRALISK]: { [WeaponTargetType.GROUND]: { base: 3 } },
    [UnitType.CORRUPTOR]: { [WeaponTargetType.AIR]: { [Attribute.MASSIVE]: 1 } },
    [UnitType.BROODLORD]: { [WeaponTargetType.GROUND]: { base: 2 } },
};
