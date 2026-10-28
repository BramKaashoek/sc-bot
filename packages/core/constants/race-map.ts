import { Race } from './enums.ts';
import * as UnitType from './unit-type.ts';
import * as Ability from './ability.ts';

const GasMineRace = {
    [Race.ZERG]: UnitType.EXTRACTOR,
    [Race.PROTOSS]: UnitType.ASSIMILATOR,
    [Race.TERRAN]: UnitType.REFINERY,
};

const SupplyUnitRace = {
    [Race.ZERG]: UnitType.OVERLORD,
    [Race.PROTOSS]: UnitType.PYLON,
    [Race.TERRAN]: UnitType.SUPPLYDEPOT,
};

const TownhallRace = {
    [Race.ZERG]: [UnitType.HATCHERY, UnitType.LAIR, UnitType.HIVE],
    [Race.PROTOSS]: [UnitType.NEXUS],
    [Race.TERRAN]: [UnitType.COMMANDCENTER, UnitType.ORBITALCOMMAND, UnitType.PLANETARYFORTRESS],
};

const FlyingTownhallRace: Record<number, number[]> = {
    [Race.TERRAN]: [UnitType.COMMANDCENTERFLYING, UnitType.ORBITALCOMMANDFLYING],
};

const TownhallWithFlyingRace: Record<number, number[]> = Object.fromEntries(
    Object.entries(TownhallRace).map(([race, types]) => [
        race,
        [...types, ...(FlyingTownhallRace[Number(race)] ?? [])],
    ]),
);

const WorkerRace = {
    [Race.ZERG]: UnitType.DRONE,
    [Race.PROTOSS]: UnitType.PROBE,
    [Race.TERRAN]: UnitType.SCV,
};

const HarvestGatheringRace = {
    [Race.ZERG]: Ability.HARVEST_GATHER_DRONE,
    [Race.PROTOSS]: Ability.HARVEST_GATHER_PROBE,
    [Race.TERRAN]: Ability.HARVEST_GATHER_SCV,
};

export {
    FlyingTownhallRace,
    GasMineRace,
    SupplyUnitRace,
    TownhallRace,
    TownhallWithFlyingRace,
    WorkerRace,
    HarvestGatheringRace,
};
