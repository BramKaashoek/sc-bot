import { Race } from '../../constants/enums.ts';
import {
    CYBERNETICSCORE,
    DARKSHRINE,
    FLEETBEACON,
    FORGE,
    GATEWAY,
    NEXUS,
    PHOTONCANNON,
    PYLON,
    ROBOTICSBAY,
    ROBOTICSFACILITY,
    SHIELDBATTERY,
    STARGATE,
    TEMPLARARCHIVE,
    TWILIGHTCOUNCIL,
    WARPGATE,
} from '../../constants/unit-type.ts';
import { distanceSquared } from '../../utils/geometry/point.ts';
import { notStarted } from './helpers.ts';
import { techUp } from './tech.ts';
import type { Behavior, PlacementFlag, Point2D, World } from '../../types.ts';

export type ProtossStaticDefenceOptions = {
    pylonsPerBase?: number;
    photonCannonsPerBase?: number;
    shieldBatteriesPerBase?: number;
    excludeBaseLocations?: Point2D[];
    maxOnRoute?: number;
    techBaseLocation?: Point2D;
};

// ares passes pylon_build_progress=1e-16 to the power matrix, so unfinished pylons count
const ANY_STARTED_PYLON = 1e-16;
const NEXUS_BASE_DISTANCE_SQUARED = 5.5 ** 2;
const SLOT_RADIUS_SQUARED = 1;
const TECH_PROGRESS_CHECK = 0.85;
const SAME_SPOT_SQUARED = 1;
const NEEDS_POWER = [
    PHOTONCANNON,
    SHIELDBATTERY,
    GATEWAY,
    WARPGATE,
    ROBOTICSFACILITY,
    ROBOTICSBAY,
    STARGATE,
    CYBERNETICSCORE,
    FORGE,
    TEMPLARARCHIVE,
    FLEETBEACON,
    TWILIGHTCOUNCIL,
    DARKSHRINE,
];

const isProtoss = ({ agent }: World) => agent.race === Race.PROTOSS;

const onRoute = (world: World, unitType: number) =>
    world.resources
        .get()
        .buildings.getTracked()
        .filter((build) => build.unitType === unitType && ['moving', 'ordered', 'constructing'].includes(build.status));

export function restorePower(): Behavior {
    return {
        name: 'restorePower',
        execute({ world }) {
            if (!isProtoss(world)) return false;
            const { units, buildings, placement, mining } = world.resources.get();
            const routed = onRoute(world, PYLON);
            const unpowered = units
                .getStructures()
                .filter(
                    (structure) =>
                        NEEDS_POWER.includes(structure.unitType!) &&
                        !placement.isPowered(structure.pos, { pylonBuildProgress: ANY_STARTED_PYLON }),
                );

            for (const structure of unpowered) {
                if (routed.some((build) => placement.wouldPower(build.target, structure.pos))) continue;

                const slots = placement
                    .getPlacements({ size: '2x2', state: 'available' })
                    .filter(
                        (slot) => placement.wouldPower(slot.pos, structure.pos) && placement.canPlace(PYLON, slot.pos),
                    );
                if (slots.length === 0) continue;
                const worker = mining.selectWorker(slots[0].pos, { forceClose: true });
                if (worker && buildings.build(PYLON, { at: slots[0].pos, worker })) return true;
            }
            return false;
        },
    };
}

export function protossStaticDefence({
    pylonsPerBase = 1,
    photonCannonsPerBase = 1,
    shieldBatteriesPerBase = 1,
    excludeBaseLocations = [],
    maxOnRoute = 1,
    techBaseLocation,
}: ProtossStaticDefenceOptions = {}): Behavior {
    const steps: Array<[number, number, PlacementFlag[] | undefined]> = [
        [PYLON, pylonsPerBase, undefined],
        [PHOTONCANNON, photonCannonsPerBase, ['staticDefence']],
        [SHIELDBATTERY, shieldBatteriesPerBase, ['staticDefence']],
    ];

    return {
        name: 'protossStaticDefence',
        async execute(ctx) {
            const { world } = ctx;
            if (!isProtoss(world)) return false;
            const { units, buildings, placement, map } = world.resources.get();
            const solved = placement.getPlacements();
            const solvedBases = solved
                .map((slot) => slot.base)
                .filter(
                    (base, index, all) =>
                        all.findIndex((other) => other.x === base.x && other.y === base.y) === index &&
                        !excludeBaseLocations.some((pos) => distanceSquared(pos, base) < SAME_SPOT_SQUARED),
                );
            if (solvedBases.length === 0) return false;

            for (const [type, perBase] of steps.slice(1)) {
                if (perBase > 0 && world.agent.techRequirementProgress(type) < 1) {
                    if (
                        await techUp({
                            desired: { unit: type },
                            base: techBaseLocation ?? map.getMain()!.townhallPosition,
                        }).execute(ctx)
                    )
                        return true;
                    break;
                }
            }

            const bases: Point2D[] = [];
            for (const nexus of units.getById(NEXUS)) {
                const closest = solvedBases.reduce((best, base) =>
                    distanceSquared(base, nexus.pos) < distanceSquared(best, nexus.pos) ? base : best,
                );
                if (distanceSquared(closest, nexus.pos) <= NEXUS_BASE_DISTANCE_SQUARED && !bases.includes(closest)) {
                    bases.push(closest);
                }
            }

            const defended = (type: number, base: Point2D) => {
                const structures = units.getById(type);
                return placement
                    .getPlacements({ base, size: '2x2' })
                    .filter(
                        (slot) =>
                            slot.state !== 'available' &&
                            structures.some((unit) => distanceSquared(unit.pos, slot.pos) < SLOT_RADIUS_SQUARED),
                    ).length;
            };

            for (const base of bases) {
                for (const [type, perBase, flags] of steps) {
                    if (perBase <= 0 || defended(type, base) >= perBase) continue;
                    if (notStarted(world, type) >= maxOnRoute) continue;
                    if (world.agent.techRequirementProgress(type) < TECH_PROGRESS_CHECK) continue;
                    const built = buildings.build(type, {
                        placement: { base, flags, powered: type !== PYLON, findAlternative: false },
                    });
                    if (built) return true;
                }
            }
            return false;
        },
    };
}
