import type { AAShape, Footprint, Point2D, UnitTypeId, World } from '../../types.ts';
import { cellsInFootprint } from './plane.ts';
import { createPoint2D } from './point.ts';
import * as UnitType from '../../constants/unit-type.ts';
import { Attribute } from '../../constants/enums.ts';
import {
    structureTypes,
    flyingStructureTypes,
    townhallTypes,
    mineralFieldTypes,
    addonTypes,
} from '../../constants/groups.ts';

export type FootprintData = Pick<SC2APIProtocol.ResponseData, 'units' | 'abilities'>;

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
    UnitType.UNBUILDABLEROCKSDESTRUCTIBLE,
    UnitType.XELNAGATOWER,
];

// destructibles have no build ability, but their names carry the footprint ("Ex1" is a variant prefix, not a size)
function footprintFromName(unitData: SC2APIProtocol.UnitTypeData): Footprint | undefined {
    if (!(unitData.attributes ?? []).includes(Attribute.STRUCTURE)) return undefined;

    const size = /(?<!Ex)(\d+)x(\d+)/.exec(unitData.name ?? '');
    if (!size) return undefined;

    const [first, second] = [Number(size[1]), Number(size[2])];
    return unitData.name!.includes('Horizontal')
        ? { w: Math.max(first, second), h: Math.min(first, second) }
        : { w: first, h: second };
}

// morphed structures (lair, warpgate, lowered depot...) have no build ability, so they inherit their alias' footprint
function footprintFromData(
    unitType: UnitTypeId,
    data: FootprintData,
    seen = new Set<UnitTypeId>(),
): Footprint | undefined {
    // add-on build abilities report the host's combined radius, not the add-on's
    if (addonTypes.includes(unitType) || seen.has(unitType)) return undefined;
    seen.add(unitType);

    const unitData = data.units?.[unitType];
    if (!unitData) return undefined;

    const radius = data.abilities?.[unitData.abilityId!]?.footprintRadius;
    if (radius) return { w: radius * 2, h: radius * 2 };

    const named = footprintFromName(unitData);
    if (named) return named;

    const aliases = [unitData.unitAlias, ...(unitData.techAlias ?? [])].filter((alias) => !!alias) as UnitTypeId[];
    return aliases.reduce<Footprint | undefined>(
        (found, alias) => found ?? footprintFromData(alias, data, seen),
        undefined,
    );
}

function getFootprint(unitType: UnitTypeId, data?: FootprintData): Footprint | undefined {
    if (flyingStructureTypes.includes(unitType)) {
        return {
            h: 0,
            w: 0,
        };
    }

    const fromData = data && footprintFromData(unitType, data);
    if (fromData) return fromData;

    if (townhallTypes.includes(unitType)) {
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
        return {
            w: 3,
            h: 3,
        };
    }
}

const footprintData = (world: World): FootprintData => ({
    units: world.data.get('units'),
    abilities: world.data.get('abilities'),
});

function footprintCells(world: World, unitType: UnitTypeId, pos: Point2D): Point2D[] {
    return cellsInFootprint(createPoint2D(pos), getFootprint(unitType, footprintData(world))!);
}

type PathingRule = (unitType: UnitTypeId, cells: Point2D[], pos: Point2D) => Point2D[] | undefined;

const cornerPathableTypes: UnitTypeId[] = [...townhallTypes, UnitType.NYDUSCANAL];

// SC2's pathing grid leaves a townhall's or nydus canal's four corner cells pathable, and mining workers walk through them
const footprintCorners: PathingRule = (unitType, cells, pos) => {
    if (!cornerPathableTypes.includes(unitType)) return undefined;

    const reach = (axis: 'x' | 'y') => Math.max(...cells.map((cell) => Math.abs(cell[axis] + 0.5 - pos[axis])));
    const [reachX, reachY] = [reach('x'), reach('y')];
    return cells.filter(({ x, y }) => Math.abs(x + 0.5 - pos.x) < reachX || Math.abs(y + 0.5 - pos.y) < reachY);
};

const loweredDepot: PathingRule = (unitType) => (unitType === UnitType.SUPPLYDEPOTLOWERED ? [] : undefined);

const burrowedCreepTumor: PathingRule = (unitType) => (unitType === UnitType.CREEPTUMORBURROWED ? [] : undefined);

const pathingRules: PathingRule[] = [footprintCorners, loweredDepot, burrowedCreepTumor];

function pathingCells(world: World, unitType: UnitTypeId, pos: Point2D): Point2D[] {
    const cells = footprintCells(world, unitType, pos);
    for (const rule of pathingRules) {
        const result = rule(unitType, cells, pos);
        if (result) return result;
    }
    return cells;
}

export { MineralField, Townhall, VespeneGeyser, getFootprint, footprintData, footprintCells, pathingCells };
