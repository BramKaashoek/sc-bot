import type { AAShape, Footprint, Point2D, UnitTypeId } from '../../types.ts';
import * as UnitType from '../../constants/unit-type.ts';
import { structureTypes, flyingStructureTypes, townhallTypes, mineralFieldTypes } from '../../constants/groups.ts';

function MineralField(pos: Point2D): AAShape {
    return {
        pos,
        w: 2,
        h: 1,
    };
}

function VespeneGeyser(pos: Point2D): AAShape {
    return {
        pos,
        w: 3,
        h: 3,
    };
}

function Townhall(pos: Point2D): AAShape {
    return {
        pos,
        w: 5,
        h: 5,
    };
}

const figureTheseOut = [
    UnitType.BUNKER,
    UnitType.CREEPTUMOR,
    UnitType.CREEPTUMORBURROWED,
    UnitType.CREEPTUMORQUEEN,
    UnitType.GREATERSPIRE,
    UnitType.KD8CHARGE, // reaper grenade
    UnitType.MISSILETURRET,
    UnitType.ORACLESTASISTRAP,
    UnitType.POINTDEFENSEDRONE,
    UnitType.SPIRE,

    // how to handle uprooting and moving of these?
    UnitType.SPINECRAWLER,
    UnitType.SPINECRAWLERUPROOTED,
    UnitType.SPORECRAWLER,
    UnitType.SPORECRAWLERUPROOTED,

    // doesn't affect pathing but affects placement?
    UnitType.SUPPLYDEPOTLOWERED,

];

const twoByTwoUnits = [
    UnitType.AUTOTURRET,
    UnitType.BANELINGNEST,
    UnitType.BARRACKSREACTOR,
    UnitType.BARRACKSTECHLAB,
    UnitType.DARKSHRINE,
    UnitType.FACTORYREACTOR,
    UnitType.FACTORYTECHLAB,
    UnitType.PHOTONCANNON,
    UnitType.PYLON,
    UnitType.REACTOR,
    UnitType.SENSORTOWER,
    UnitType.SHIELDBATTERY,
    UnitType.SPAWNINGPOOL,
    UnitType.STARPORTREACTOR,
    UnitType.STARPORTTECHLAB,
    UnitType.SUPPLYDEPOT,
    UnitType.TECHLAB,
    UnitType.UNBUILDABLEBRICKSDESTRUCTIBLE,
    UnitType.UNBUILDABLEPLATESDESTRUCTIBLE,
];

function getFootprint(unitType: UnitTypeId): Footprint | undefined {
    if (flyingStructureTypes.includes(unitType)) {
        return {
            h: 0,
            w: 0,
        };
    } else if (townhallTypes.includes(unitType)) {
        return {
            w: 5,
            h: 5,
        };
    } else if (mineralFieldTypes.includes(unitType)) {
        return {
            w: 2,
            h: 1,
        };
    } else if (twoByTwoUnits.includes(unitType)) {
        return {
            w: 2,
            h: 2,
        };
    } else if (structureTypes.includes(unitType)) {
        // this currently isn't totally accurate, see `figureTheseOut` above
        return {
            w: 3,
            h: 3,
        };
    }
}

export { MineralField, Townhall, VespeneGeyser, getFootprint };
