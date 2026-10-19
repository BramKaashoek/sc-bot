// Ported from python-sc2 RESEARCH_INFO (sc2/dicts/unit_research_abilities.py); the API data has no research requirements
import * as Ability from '../ability.ts';
import * as UnitType from '../unit-type.ts';
import * as Upgrade from '../upgrade.ts';

export type ResearchRequirement = { requiredBuilding?: number; requiredUpgrade?: number; ability?: number };

// ability: 4.10 data points these upgrades at unavailable ArmoryResearchSwarm abilities, the armory offers the ArmoryResearch ones
export const researchRequirements: Record<number, ResearchRequirement> = {
    [Upgrade.TERRANSHIPWEAPONSLEVEL2]: { requiredUpgrade: Upgrade.TERRANSHIPWEAPONSLEVEL1 },
    [Upgrade.TERRANSHIPWEAPONSLEVEL3]: { requiredUpgrade: Upgrade.TERRANSHIPWEAPONSLEVEL2 },
    [Upgrade.TERRANVEHICLEANDSHIPARMORSLEVEL1]: { ability: Ability.RESEARCH_TERRANVEHICLEANDSHIPPLATINGLEVEL1 },
    [Upgrade.TERRANVEHICLEANDSHIPARMORSLEVEL2]: {
        requiredUpgrade: Upgrade.TERRANVEHICLEANDSHIPARMORSLEVEL1,
        ability: Ability.RESEARCH_TERRANVEHICLEANDSHIPPLATINGLEVEL2,
    },
    [Upgrade.TERRANVEHICLEANDSHIPARMORSLEVEL3]: {
        requiredUpgrade: Upgrade.TERRANVEHICLEANDSHIPARMORSLEVEL2,
        ability: Ability.RESEARCH_TERRANVEHICLEANDSHIPPLATINGLEVEL3,
    },
    [Upgrade.TERRANVEHICLEWEAPONSLEVEL2]: { requiredUpgrade: Upgrade.TERRANVEHICLEWEAPONSLEVEL1 },
    [Upgrade.TERRANVEHICLEWEAPONSLEVEL3]: { requiredUpgrade: Upgrade.TERRANVEHICLEWEAPONSLEVEL2 },
    [Upgrade.CENTRIFICALHOOKS]: { requiredBuilding: UnitType.LAIR },
    [Upgrade.PROTOSSAIRARMORSLEVEL2]: {
        requiredBuilding: UnitType.FLEETBEACON,
        requiredUpgrade: Upgrade.PROTOSSAIRARMORSLEVEL1,
    },
    [Upgrade.PROTOSSAIRARMORSLEVEL3]: {
        requiredBuilding: UnitType.FLEETBEACON,
        requiredUpgrade: Upgrade.PROTOSSAIRARMORSLEVEL2,
    },
    [Upgrade.PROTOSSAIRWEAPONSLEVEL2]: {
        requiredBuilding: UnitType.FLEETBEACON,
        requiredUpgrade: Upgrade.PROTOSSAIRWEAPONSLEVEL1,
    },
    [Upgrade.PROTOSSAIRWEAPONSLEVEL3]: {
        requiredBuilding: UnitType.FLEETBEACON,
        requiredUpgrade: Upgrade.PROTOSSAIRWEAPONSLEVEL2,
    },
    [Upgrade.TERRANINFANTRYARMORSLEVEL2]: {
        requiredBuilding: UnitType.ARMORY,
        requiredUpgrade: Upgrade.TERRANINFANTRYARMORSLEVEL1,
    },
    [Upgrade.TERRANINFANTRYARMORSLEVEL3]: {
        requiredBuilding: UnitType.ARMORY,
        requiredUpgrade: Upgrade.TERRANINFANTRYARMORSLEVEL2,
    },
    [Upgrade.TERRANINFANTRYWEAPONSLEVEL2]: {
        requiredBuilding: UnitType.ARMORY,
        requiredUpgrade: Upgrade.TERRANINFANTRYWEAPONSLEVEL1,
    },
    [Upgrade.TERRANINFANTRYWEAPONSLEVEL3]: {
        requiredBuilding: UnitType.ARMORY,
        requiredUpgrade: Upgrade.TERRANINFANTRYWEAPONSLEVEL2,
    },
    [Upgrade.ZERGGROUNDARMORSLEVEL2]: {
        requiredBuilding: UnitType.LAIR,
        requiredUpgrade: Upgrade.ZERGGROUNDARMORSLEVEL1,
    },
    [Upgrade.ZERGGROUNDARMORSLEVEL3]: {
        requiredBuilding: UnitType.HIVE,
        requiredUpgrade: Upgrade.ZERGGROUNDARMORSLEVEL2,
    },
    [Upgrade.ZERGMELEEWEAPONSLEVEL2]: {
        requiredBuilding: UnitType.LAIR,
        requiredUpgrade: Upgrade.ZERGMELEEWEAPONSLEVEL1,
    },
    [Upgrade.ZERGMELEEWEAPONSLEVEL3]: {
        requiredBuilding: UnitType.HIVE,
        requiredUpgrade: Upgrade.ZERGMELEEWEAPONSLEVEL2,
    },
    [Upgrade.ZERGMISSILEWEAPONSLEVEL2]: {
        requiredBuilding: UnitType.LAIR,
        requiredUpgrade: Upgrade.ZERGMISSILEWEAPONSLEVEL1,
    },
    [Upgrade.ZERGMISSILEWEAPONSLEVEL3]: {
        requiredBuilding: UnitType.HIVE,
        requiredUpgrade: Upgrade.ZERGMISSILEWEAPONSLEVEL2,
    },
    [Upgrade.DRILLCLAWS]: { requiredBuilding: UnitType.ARMORY },
    [Upgrade.SMARTSERVOS]: { requiredBuilding: UnitType.ARMORY },
    [Upgrade.PROTOSSGROUNDARMORSLEVEL2]: {
        requiredBuilding: UnitType.TWILIGHTCOUNCIL,
        requiredUpgrade: Upgrade.PROTOSSGROUNDARMORSLEVEL1,
    },
    [Upgrade.PROTOSSGROUNDARMORSLEVEL3]: {
        requiredBuilding: UnitType.TWILIGHTCOUNCIL,
        requiredUpgrade: Upgrade.PROTOSSGROUNDARMORSLEVEL2,
    },
    [Upgrade.PROTOSSGROUNDWEAPONSLEVEL2]: {
        requiredBuilding: UnitType.TWILIGHTCOUNCIL,
        requiredUpgrade: Upgrade.PROTOSSGROUNDWEAPONSLEVEL1,
    },
    [Upgrade.PROTOSSGROUNDWEAPONSLEVEL3]: {
        requiredBuilding: UnitType.TWILIGHTCOUNCIL,
        requiredUpgrade: Upgrade.PROTOSSGROUNDWEAPONSLEVEL2,
    },
    [Upgrade.PROTOSSSHIELDSLEVEL2]: {
        requiredBuilding: UnitType.TWILIGHTCOUNCIL,
        requiredUpgrade: Upgrade.PROTOSSSHIELDSLEVEL1,
    },
    [Upgrade.PROTOSSSHIELDSLEVEL3]: {
        requiredBuilding: UnitType.TWILIGHTCOUNCIL,
        requiredUpgrade: Upgrade.PROTOSSSHIELDSLEVEL2,
    },
    [Upgrade.ZERGFLYERARMORSLEVEL2]: {
        requiredBuilding: UnitType.LAIR,
        requiredUpgrade: Upgrade.ZERGFLYERARMORSLEVEL1,
    },
    [Upgrade.ZERGFLYERARMORSLEVEL3]: {
        requiredBuilding: UnitType.HIVE,
        requiredUpgrade: Upgrade.ZERGFLYERARMORSLEVEL2,
    },
    [Upgrade.ZERGFLYERWEAPONSLEVEL2]: {
        requiredBuilding: UnitType.LAIR,
        requiredUpgrade: Upgrade.ZERGFLYERWEAPONSLEVEL1,
    },
    [Upgrade.ZERGFLYERWEAPONSLEVEL3]: {
        requiredBuilding: UnitType.HIVE,
        requiredUpgrade: Upgrade.ZERGFLYERWEAPONSLEVEL2,
    },
    [Upgrade.DIGGINGCLAWS]: { requiredBuilding: UnitType.HIVE },
    [Upgrade.LURKERRANGE]: { requiredBuilding: UnitType.HIVE },
    [Upgrade.GLIALRECONSTITUTION]: { requiredBuilding: UnitType.LAIR },
    [Upgrade.TUNNELINGCLAWS]: { requiredBuilding: UnitType.LAIR },
    [Upgrade.ZERGLINGATTACKSPEED]: { requiredBuilding: UnitType.HIVE },
};
