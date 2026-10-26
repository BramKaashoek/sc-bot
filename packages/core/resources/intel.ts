import { Alliance } from '../constants/enums.ts';
import { gasMineTypes, townhallTypes, workerTypes } from '../constants/groups.ts';
import * as UnitType from '../constants/unit-type.ts';
import { distance } from '../utils/geometry/point.ts';
import { Units } from './units-collection.ts';
import type {
    BaseThreat,
    IntelFlag,
    IntelResource,
    IntelSettings,
    Point2D,
    ResourceDefinition,
    Unit,
    World,
} from '../types.ts';

const DEFAULT_SETTINGS: IntelSettings = {
    groundNearBase: 15,
    airNearBase: 20,
    groundLeavingBase: 24,
    airLeavingBase: 22,
    greedyTwoBaseBefore: 65,
    greedyThreeHatchBefore: 90,
};

const LOOPS_PER_SECOND = 22.4;
const CREEP_TUMORS = [UnitType.CREEPTUMOR, UnitType.CREEPTUMORBURROWED, UnitType.CREEPTUMORQUEEN];
const HATCHERIES = [UnitType.HATCHERY, UnitType.LAIR, UnitType.HIVE];

type Kind = 'ground' | 'air';

type IntelState = {
    settings: IntelSettings;
    threats: Map<string, Record<Kind, Set<string>>>;
    detected: Map<IntelFlag, number>;
    townhallStarts: Map<string, number>;
};

const stateByIntel = new WeakMap<IntelResource, IntelState>();

type Places = { ownStart: Point2D; ownNatural?: Point2D; enemyStart?: Point2D; enemyNatural?: Point2D };

function places(world: World): Places {
    const { map } = world.resources.get();
    return {
        ownStart: map.getMain().townhallPosition,
        ownNatural: map.getNatural()?.townhallPosition,
        enemyStart: map.getLocations().enemy?.[0],
        enemyNatural: map.getEnemyNatural()?.townhallPosition,
    };
}

const within = (unit: Unit, point: Point2D | undefined, range: number) =>
    point !== undefined && distance(unit.pos, point) <= range;
const beyond = (unit: Unit, point: Point2D | undefined, range: number) =>
    point !== undefined && distance(unit.pos, point) > range;

function proxiesOf(enemies: Unit[], { ownStart, enemyStart }: Places): Unit[] {
    return enemies.filter(
        (unit) =>
            unit.isStructure() &&
            !CREEP_TUMORS.includes(unit.unitType) &&
            !gasMineTypes.includes(unit.unitType) &&
            within(unit, ownStart, 100) &&
            beyond(unit, enemyStart, 60),
    );
}

function evaluateFlags(world: World, state: IntelState): IntelFlag[] {
    const { frame, memory } = world.resources.get();
    const t = frame.time();
    const enemies = [...memory.getEnemies()];
    const at = places(world);
    const { ownStart, ownNatural, enemyStart, enemyNatural } = at;

    const ofType = (...types: number[]) => enemies.filter((unit) => types.includes(unit.unitType));
    const lings = ofType(UnitType.ZERGLING);
    const roaches = ofType(UnitType.ROACH);
    const marines = ofType(UnitType.MARINE);
    const marauders = ofType(UnitType.MARAUDER);
    const barracks = ofType(UnitType.BARRACKS);
    const gateways = ofType(UnitType.GATEWAY);
    const townhalls = enemies.filter((unit) => townhallTypes.includes(unit.unitType));

    townhalls.forEach((townhall) => {
        if (state.townhallStarts.has(townhall.tag!)) return;
        const buildSeconds = (world.data.getUnitTypeData(townhall.unitType)?.buildTime ?? 0) / LOOPS_PER_SECOND;
        state.townhallStarts.set(townhall.tag!, t - (townhall.buildProgress ?? 1) * buildSeconds);
    });
    const startedBefore = (group: Unit[], seconds: number) =>
        group.filter((townhall) => state.townhallStarts.get(townhall.tag!)! < seconds).length;

    const has = (flag: IntelFlag) => state.detected.has(flag) || flags[flag];
    const flags = {} as Record<IntelFlag, boolean>;

    flags.lingRush =
        (t < 150 && lings.filter((ling) => within(ling, ownStart, 50)).length > 2) ||
        (t < 180 && lings.length > 7) ||
        (t < 90 && lings.length > 4);
    flags.roachRush =
        (t < 240 && roaches.filter((roach) => within(roach, ownStart, 50)).length >= 6) ||
        (t < 180 && roaches.length >= 3);
    flags.ravagerRush = t < 240 && ofType(UnitType.RAVAGER).length >= 1;
    flags.marineRush =
        t <= 210 &&
        townhalls.length < 2 &&
        ofType(UnitType.FACTORY).length === 0 &&
        ((t < 180 && barracks.length >= 3) ||
            (t < 300 &&
                marines.filter((marine) => beyond(marine, enemyStart, 60)).length >= Math.max(3, Math.floor(t / 45))));
    flags.marauderRush =
        t <= 240 &&
        (ofType(UnitType.BARRACKSTECHLAB).some((techlab) => within(techlab, ownNatural, 55)) ||
            (t < 210 && marauders.length >= 2) ||
            (t < 160 && marauders.length >= 1));
    flags.fourGate = t <= 210 && townhalls.length < 2 && t < 200 && gateways.length >= 3;
    flags.proxyZealot =
        t <= 240 &&
        (gateways.filter((gateway) => within(gateway, ownStart, 100) && beyond(gateway, enemyStart, 60)).length >= 2 ||
            (t < 150 && ofType(UnitType.ZEALOT).some((zealot) => within(zealot, ownStart, 65))));
    const workers = enemies.filter((unit) => workerTypes.includes(unit.unitType));
    flags.workerRush =
        t < 180 &&
        (workers.filter((worker) => within(worker, ownStart, 15)).length > 6 ||
            workers.filter((worker) => within(worker, ownNatural, 16)).length > 6);
    flags.reaper = ofType(UnitType.REAPER).length > 0;
    flags.expanded = townhalls.some((townhall) => beyond(townhall, enemyStart, 6));
    flags.baseOutsideNatural = townhalls.some(
        (townhall) => beyond(townhall, enemyStart, 6) && beyond(townhall, enemyNatural, 6),
    );
    flags.proxy = t < 240 && proxiesOf(enemies, at).length > 0;
    flags.greedy =
        startedBefore(
            townhalls.filter((townhall) => !HATCHERIES.includes(townhall.unitType)),
            state.settings.greedyTwoBaseBefore,
        ) >= 2 ||
        startedBefore(
            townhalls.filter((townhall) => HATCHERIES.includes(townhall.unitType)),
            state.settings.greedyThreeHatchBefore,
        ) >= 3;
    flags.rushed =
        has('lingRush') ||
        has('workerRush') ||
        (has('marauderRush') && !has('expanded')) ||
        has('proxyZealot') ||
        has('ravagerRush') ||
        (has('marineRush') && !enemies.some((unit) => unit.isStructure() && within(unit, ownNatural, 15))) ||
        has('fourGate') ||
        has('roachRush') ||
        (t < 240 && roaches.length >= 3) ||
        (t < 105 && lings.length >= 1) ||
        (t < 120 && barracks.length >= 2);

    return (Object.keys(flags) as IntelFlag[]).filter((flag) => flags[flag]);
}

function trackThreats(world: World, state: IntelState) {
    const { units, spatial } = world.resources.get();
    const { groundNearBase, airNearBase, groundLeavingBase, airLeavingBase } = state.settings;
    const bases = units.getBases(Alliance.SELF);
    const baseTags = new Set(bases.map((base) => base.tag!));
    state.threats.forEach((_sets, tag) => {
        if (!baseTags.has(tag)) state.threats.delete(tag);
    });

    bases.forEach((base) => {
        const sets = state.threats.get(base.tag!) ?? { ground: new Set<string>(), air: new Set<string>() };
        state.threats.set(base.tag!, sets);
        const kinds: [Kind, 'enemyGround' | 'enemyAir', number, number][] = [
            ['ground', 'enemyGround', groundNearBase, groundLeavingBase],
            ['air', 'enemyAir', airNearBase, airLeavingBase],
        ];
        kinds.forEach(([kind, spatialKind, near, leaving]) => {
            spatial
                .unitsInRange(base, near, spatialKind)
                .filter((enemy) => enemy.isCurrent())
                .forEach((enemy) => sets[kind].add(enemy.tag!));
            const closest = spatial.closest(base, spatialKind);
            if (!closest || distance(closest.pos, base.pos) > leaving || closest.isMemory()) sets[kind].clear();
        });
    });
}

export const intelResource: ResourceDefinition<'intel'> = {
    name: 'intel',
    create(world) {
        const state: IntelState = {
            settings: { ...DEFAULT_SETTINGS },
            threats: new Map(),
            detected: new Map(),
            townhallStarts: new Map(),
        };

        const resolve = (tags: Set<string>) =>
            Units.from(
                [...tags].flatMap((tag) => {
                    const unit = world.resources.get().units.getByTag(tag);
                    return unit?.isCurrent() ? [unit] : [];
                }),
            );
        const supplyOf = (group: Unit[]) =>
            group.reduce((sum, unit) => sum + (unit.isStructure() ? 0 : (unit.data().foodRequired ?? 0)), 0);

        const intel: IntelResource = {
            getBaseThreats() {
                const { units } = world.resources.get();
                return [...state.threats].flatMap(([tag, sets]): BaseThreat[] => {
                    const townhall = units.getByTag(tag);
                    if (!townhall || sets.ground.size + sets.air.size === 0) return [];
                    const ground = resolve(sets.ground);
                    const air = resolve(sets.air);
                    return [{ townhall, ground, air, groundSupply: supplyOf(ground), airSupply: supplyOf(air) }];
                });
            },
            getMainThreat(kind) {
                const supply = (threat: BaseThreat) => (kind === 'ground' ? threat.groundSupply : threat.airSupply);
                return intel
                    .getBaseThreats()
                    .filter((threat) => supply(threat) > 0)
                    .reduce<BaseThreat | undefined>(
                        (best, threat) => (best === undefined || supply(threat) > supply(best) ? threat : best),
                        undefined,
                    );
            },
            has(flag) {
                return state.detected.has(flag);
            },
            detectedAt(flag) {
                return state.detected.get(flag);
            },
            getProxies() {
                return Units.from(proxiesOf([...world.resources.get().memory.getEnemies()], places(world)));
            },
            configure(settings) {
                Object.assign(state.settings, settings);
            },
        };
        stateByIntel.set(intel, state);
        return intel;
    },
    reset(intel) {
        const state = stateByIntel.get(intel)!;
        state.threats.clear();
        state.detected.clear();
        state.townhallStarts.clear();
    },
    onStep(intel, world) {
        const state = stateByIntel.get(intel)!;
        trackThreats(world, state);

        const { frame, events } = world.resources.get();
        const gameLoop = frame.getGameLoop();
        evaluateFlags(world, state).forEach((flag) => {
            if (state.detected.has(flag)) return;
            state.detected.set(flag, gameLoop);
            events.write({ name: 'enemyStrategyDetected', data: { flag, gameLoop } });
        });
    },
};
