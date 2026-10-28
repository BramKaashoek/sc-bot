import {
    ARMY_VALUE_OVERRIDES,
    DEFAULT_EFFECT_COSTS,
    DELAYED_EFFECT_LAYERS,
    DELAYED_EFFECTS,
    EFFECT_INFLUENCE,
    INFLUENCE_DEFAULTS,
    KD8_LAYERS,
    PARASITIC_BOMB_LAYERS,
    SHADE_PRUNE_AFTER_LOOPS,
    SHADE_VISIBLE_AFTER_LOOPS,
    STATIC_DEFENSE,
    TACTICAL_STRUCTURES,
    TACTICAL_STRUCTURE_STAMPS,
    UNIT_AVOIDANCE,
    WEIGHT_COSTS,
} from '../constants/influence.ts';
import * as Effect from '../constants/effect.ts';
import { Alliance, Race } from '../constants/enums.ts';
import * as Buff from '../constants/buff.ts';
import * as UnitType from '../constants/unit-type.ts';
import { CHANGELINGS } from '../utils/combat/changelings.ts';
import { asArray } from '../utils/collections.ts';
import { addCircle } from '../utils/grid/stamp.ts';
import { footprintData, getFootprint, pathingCells } from '../utils/geometry/units.ts';
import { computeClimberMask } from '../utils/map/climber.ts';
import type { InfluenceSource } from '../constants/influence.ts';
import type {
    InfluenceGrid,
    InfluenceLayer,
    InfluenceResource,
    InfluenceSettings,
    Point2D,
    ResourceDefinition,
    Unit,
    World,
} from '../types.ts';
import { GAME_LOOPS_PER_SECOND } from '../constants/time.ts';

const LAYERS: InfluenceLayer[] = [
    'ground',
    'air',
    'groundAvoidance',
    'airAvoidance',
    'climber',
    'airVsGround',
    'groundToAir',
    'priorityGroundAvoidance',
    'tacticalGround',
];

const AIR_LAYERS = new Set<InfluenceLayer>(['air', 'airAvoidance']);
const DERIVED_LAYERS = new Set<InfluenceLayer>([
    'climber',
    'airVsGround',
    'groundToAir',
    'priorityGroundAvoidance',
    'tacticalGround',
]);

const LIBERATOR_ZONES = new Set([Effect.LIBERATORTARGETMORPHDELAYPERSISTENT, Effect.LIBERATORTARGETMORPHPERSISTENT]);

type Grids = Record<InfluenceLayer, InfluenceGrid>;

type BlockerCells = { unitType: number; x: number; y: number; cells: number[] };

type DelayedKind = keyof typeof DELAYED_EFFECTS;

type State = {
    settings: InfluenceSettings;
    grids?: Grids;
    builtLoop: number;
    climberMask?: Uint8Array;
    blockerCells: Map<string, BlockerCells>;
    firstSeen: Record<DelayedKind, Map<string, { center: Point2D; loop: number }>>;
    forcefields: Point2D[];
    shadeFirstSeen: Map<string, number>;
};

const TACTICAL_BASE_COST = 200;
const TACTICAL_UNIT_RADIUS = 1.5;
const TACTICAL_LOW_HEALTH = 100;
const TACTICAL_LOW_HEALTH_FACTOR = 1.5;

export const stateByInfluence = new WeakMap<InfluenceResource, State>();

const freshState = (settings: InfluenceSettings): State => ({
    settings,
    builtLoop: -1,
    blockerCells: new Map(),
    firstSeen: { bile: new Map(), nuke: new Map() },
    forcefields: [],
    shadeFirstSeen: new Map(),
});

function createGrid(layer: InfluenceLayer, width: number, height: number): InfluenceGrid {
    const data = new Float32Array(width * height);
    return {
        layer,
        width,
        height,
        data,
        get(point) {
            const x = Math.floor(point.x);
            const y = Math.floor(point.y);
            if (x < 0 || y < 0 || x >= width || y >= height) return Infinity;
            return data[y * width + x];
        },
    };
}

function clampToOne(data: Float32Array, start = 0, end = data.length) {
    for (let i = start; i < end; i++) if (data[i] < 1) data[i] = 1;
}

function fillBase(world: World, width: number, height: number, ground?: Float32Array, air?: Float32Array) {
    const { frame, map } = world.resources.get();
    const pathing = map.getGrids().pathing ?? [];
    const { p0, p1 } = frame.getGameInfo().startRaw?.playableArea ?? {};
    const [x0, y0, x1, y1] = [p0?.x ?? 0, p0?.y ?? 0, p1?.x ?? width, p1?.y ?? height];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            if (ground) ground[i] = pathing[y]?.[x] === 0 ? 1 : Infinity;
            if (air) air[i] = x >= x0 && x < x1 && y >= y0 && y < y1 ? 1 : Infinity;
        }
    }
}

function climberMask(world: World, state: State, width: number, height: number): Uint8Array | undefined {
    if (state.climberMask) return state.climberMask;
    const { frame, map } = world.resources.get();
    const { pathing, height: terrainHeight } = map.getGrids();
    if (!pathing || !terrainHeight) return undefined;
    const { p0, p1 } = frame.getGameInfo().startRaw?.playableArea ?? {};
    state.climberMask = computeClimberMask({
        width,
        height,
        pathing,
        terrainHeight,
        playable: { x0: p0?.x ?? 0, y0: p0?.y ?? 0, x1: p1?.x ?? width, y1: p1?.y ?? height },
    });
    return state.climberMask;
}

// pathingCells and the footprint lookup dominate the per-loop cost, and a blocker only moves when it lands elsewhere or morphs
function blockerCells(world: World, state: State, blocker: Unit, width: number): number[] {
    const { unitType, pos } = blocker;
    const cached = state.blockerCells.get(blocker.tag!);
    if (cached?.unitType === unitType && cached.x === pos.x && cached.y === pos.y) return cached.cells;
    const cells = getFootprint(unitType!, footprintData(world))
        ? pathingCells(world, unitType!, pos).map((cell) => cell.y * width + cell.x)
        : [];
    state.blockerCells.set(blocker.tag!, { unitType: unitType!, x: pos.x, y: pos.y, cells });
    return cells;
}

function fillExtraBases(world: World, state: State, grids: Grids, width: number, height: number) {
    const { ground, air } = grids;
    const { airVsGroundDefault } = state.settings;
    grids.climber.data.set(ground.data);
    grids.priorityGroundAvoidance.data.set(ground.data);
    grids.groundToAir.data.set(air.data);
    for (let i = 0; i < air.data.length; i++) {
        const inPlayable = air.data[i] !== Infinity;
        grids.airVsGround.data[i] = !inPlayable ? Infinity : ground.data[i] === Infinity ? 1 : airVsGroundDefault;
        grids.tacticalGround.data[i] = !inPlayable || ground.data[i] === Infinity ? Infinity : TACTICAL_BASE_COST;
    }

    const mask = climberMask(world, state, width, height);
    if (!mask) return;
    const climber = grids.climber.data;
    for (let i = 0; i < mask.length; i++) if (mask[i]) climber[i] = 1;

    // the mask comes from the grid at first build, so rocks and structures that were there then are in it
    const { units } = world.resources.get();
    for (const blocker of [
        ...units.getStructures(),
        ...units.getEnemyStructures(),
        ...units.getMineralFields(),
        ...units.getGasGeysers(),
        ...units.getDestructables(),
        ...units.getWatchtowers(),
    ]) {
        if (blocker.isFlying) continue;
        for (const i of blockerCells(world, state, blocker, width)) if (mask[i]) climber[i] = grids.ground.data[i];
    }
}

function build(world: World, state: State): Grids {
    const { frame, map, memory, units } = world.resources.get();
    const { x: width = 0, y: height = 0 } = map.getSize();
    if (!state.grids || state.grids.ground.width !== width || state.grids.ground.height !== height) {
        state.grids = Object.fromEntries(
            LAYERS.map((layer): [InfluenceLayer, InfluenceGrid] => [layer, createGrid(layer, width, height)]),
        ) as Grids;
    }
    const grids = state.grids;
    const { settings } = state;

    fillBase(world, width, height, grids.ground.data, grids.air.data);
    grids.groundAvoidance.data.set(grids.ground.data);
    grids.airAvoidance.data.set(grids.air.data);
    fillExtraBases(world, state, grids, width, height);

    const stamp = (layers: readonly InfluenceLayer[], center: Point2D, radius: number, weight: number) => {
        const routed = new Set(layers);
        if (routed.has('ground')) routed.add('climber');
        if (routed.has('air')) routed.add('airVsGround');
        for (const layer of routed)
            addCircle(grids[layer].data, width, height, center.x, center.y, radius, weight * settings.costMultiplier);
    };
    const stampTactical = (unit: Unit, sign: 1 | -1) => {
        const { mineralCost = 0, vespeneCost = 0, foodRequired = 0 } = unitData[unit.unitType!] ?? {};
        // raw unit cost would swamp the 200 base
        const armyValue =
            ARMY_VALUE_OVERRIDES[unit.unitType!] ?? ((mineralCost / 0.9 + vespeneCost) * foodRequired) / 50;
        const health = unit.health ?? 0;
        const value = armyValue * (health <= TACTICAL_LOW_HEALTH ? TACTICAL_LOW_HEALTH_FACTOR : 1);
        if (value === 0) return;
        const radius = (unit.radius ?? 0) + TACTICAL_UNIT_RADIUS;
        addCircle(grids.tacticalGround.data, width, height, unit.pos.x, unit.pos.y, radius, sign * value);
        const explicit = sign === 1 ? TACTICAL_STRUCTURE_STAMPS[unit.unitType!] : undefined;
        if (explicit)
            addCircle(
                grids.tacticalGround.data,
                width,
                height,
                unit.pos.x,
                unit.pos.y,
                radius,
                explicit.isWeak(health) ? explicit.weak : explicit.solid,
            );
    };
    const stampSource = (unit: Unit, source: InfluenceSource, range = source.range) =>
        stamp(
            source.layers.includes('air') ? [...source.layers, 'groundToAir'] : source.layers,
            unit.pos,
            range + (source.buffer ? settings[source.buffer] : 0),
            source.weight,
        );

    const unitData: SC2APIProtocol.UnitTypeData[] = world.data.get('units');
    const gameSeconds = frame.getGameLoop() / GAME_LOOPS_PER_SECOND;
    const loop = frame.getGameLoop();
    for (const [tag, firstSeen] of state.shadeFirstSeen)
        if (loop - firstSeen > SHADE_PRUNE_AFTER_LOOPS) state.shadeFirstSeen.delete(tag);
    for (const enemy of memory.getEnemies()) {
        const unitType = enemy.unitType!;
        if (CHANGELINGS.has(unitType) || !enemy.isFinished()) continue;
        if (unitType === UnitType.ADEPTPHASESHIFT) {
            const firstSeen = state.shadeFirstSeen.get(enemy.tag!) ?? loop;
            state.shadeFirstSeen.set(enemy.tag!, firstSeen);
            if (loop - firstSeen < SHADE_VISIBLE_AFTER_LOOPS) continue;
        }

        if (settings.tacticalGround && !enemy.isFlying && (!enemy.isStructure() || TACTICAL_STRUCTURES.has(unitType)))
            stampTactical(enemy, 1);

        const table = WEIGHT_COSTS[unitType];
        const staticDefense = STATIC_DEFENSE[unitType];
        const avoidance = UNIT_AVOIDANCE[unitType];
        if (table) {
            if (table.airRange > 0)
                stamp(
                    enemy.isFlying ? ['air'] : ['air', 'groundToAir'],
                    enemy.pos,
                    table.airRange + settings.rangeBuffer,
                    table.airCost,
                );
            if (table.groundRange > 0)
                stamp(['ground'], enemy.pos, table.groundRange + settings.rangeBuffer, table.groundCost);
        } else if (staticDefense) {
            if (staticDefense.requiresPower && !enemy.isPowered) continue;
            if (unitType === UnitType.AUTOTURRET && enemy.isSnapshot()) continue;
            const { upgradedRange } = staticDefense;
            stampSource(
                enemy,
                staticDefense,
                upgradedRange && gameSeconds > upgradedRange.afterSeconds ? upgradedRange.range : staticDefense.range,
            );
        } else if (!avoidance) {
            const groundDps = enemy.groundDps();
            if (groundDps > 0) {
                const groundRange = enemy.groundRange();
                const reach = groundRange < 2 ? settings.rangeBuffer : groundRange + settings.rangeBuffer;
                stamp(['ground'], enemy.pos, reach, groundDps);
            }
            const airDps = enemy.airDps();
            if (airDps > 0)
                stamp(
                    enemy.isFlying ? ['air'] : ['air', 'groundToAir'],
                    enemy.pos,
                    enemy.airRange() + settings.rangeBuffer,
                    airDps,
                );
        }
        if (avoidance) stampSource(enemy, avoidance);
    }

    if (settings.tacticalGround) {
        const zerg = world.agent.race === Race.ZERG;
        for (const own of units.getAlive(Alliance.SELF))
            if (!own.isFlying && own.unitType !== UnitType.DISRUPTOR && !(zerg && own.isStructure()))
                stampTactical(own, -1);
    }

    const seenNow: Record<DelayedKind, Map<string, Point2D>> = { bile: new Map(), nuke: new Map() };
    for (const effect of map.getEffects()) {
        const delayed = (Object.keys(DELAYED_EFFECTS) as DelayedKind[]).find(
            (kind) => DELAYED_EFFECTS[kind] === effect.effectId,
        );
        const effectPositions = (effect.pos ?? []) as Point2D[];
        if (delayed && effectPositions.length > 0) {
            const center = {
                x: effectPositions.reduce((sum, p) => sum + p.x, 0) / effectPositions.length,
                y: effectPositions.reduce((sum, p) => sum + p.y, 0) / effectPositions.length,
            };
            seenNow[delayed].set(`${center.x},${center.y}`, center);
            continue;
        }
        // deliberate ares deviation: our own liberator zones don't threaten our units
        if (LIBERATOR_ZONES.has(effect.effectId!) && effect.alliance === Alliance.SELF) continue;
        const influence = EFFECT_INFLUENCE[effect.effectId!];
        const cost = settings.effects[effect.effectId!] ?? DEFAULT_EFFECT_COSTS[effect.effectId!];
        const positions = (effect.pos ?? []) as Point2D[];
        if (!influence || !cost || positions.length === 0) continue;

        const radius = cost.range + settings.effectsRangeBuffer;
        const centers = influence.perPosition
            ? positions
            : [
                  {
                      x: positions.reduce((sum, p) => sum + p.x, 0) / positions.length,
                      y: positions.reduce((sum, p) => sum + p.y, 0) / positions.length,
                  },
              ];
        for (const center of centers) stamp(influence.layers, center, radius, cost.cost);
    }

    for (const kind of Object.keys(DELAYED_EFFECTS) as DelayedKind[]) {
        const tracked = state.firstSeen[kind];
        for (const [key, center] of seenNow[kind]) if (!tracked.has(key)) tracked.set(key, { center, loop });
        const { reactAfter, duration } = settings.delayedEffects[kind];
        const cost = settings.effects[DELAYED_EFFECTS[kind]] ?? DEFAULT_EFFECT_COSTS[DELAYED_EFFECTS[kind]];
        for (const [key, entry] of tracked) {
            const age = loop - entry.loop;
            if (age > duration) tracked.delete(key);
            else if (age >= reactAfter)
                stamp(DELAYED_EFFECT_LAYERS, entry.center, cost.range + settings.effectsRangeBuffer, cost.cost);
        }
    }

    state.forcefields = [];
    for (const unit of units.getAlive()) {
        if (unit.unitType === UnitType.KD8CHARGE)
            stamp(
                KD8_LAYERS,
                unit.pos,
                settings.kd8Charge.range + settings.effectsRangeBuffer,
                settings.kd8Charge.cost,
            );
        else if (unit.unitType === UnitType.FORCEFIELD) state.forcefields.push({ x: unit.pos.x, y: unit.pos.y });
        else if (
            (unit.unitType === UnitType.PARASITICBOMBDUMMY && unit.alliance === Alliance.ENEMY) ||
            (unit.alliance === Alliance.SELF && unit.hasBuff(Buff.PARASITICBOMB))
        )
            stamp(
                PARASITIC_BOMB_LAYERS,
                unit.pos,
                settings.parasiticBomb.range + settings.effectsRangeBuffer,
                settings.parasiticBomb.cost,
            );
    }

    for (const layer of LAYERS) if (layer !== 'tacticalGround') clampToOne(grids[layer].data);
    return grids;
}

export const influenceResource: ResourceDefinition<'influence'> = {
    name: 'influence',
    create(world) {
        const current = (): Grids => {
            const state = stateByInfluence.get(resource)!;
            const loop = world.resources.get().frame.getGameLoop();
            if (!state.grids || state.builtLoop !== loop) {
                build(world, state);
                state.builtLoop = loop;
            }
            return state.grids!;
        };

        const resource: InfluenceResource = {
            getGrid(layer) {
                return current()[layer];
            },
            getCleanGrid(layer) {
                const { x: width = 0, y: height = 0 } = world.resources.get().map.getSize();
                if (DERIVED_LAYERS.has(layer)) {
                    const scratch = Object.fromEntries(
                        LAYERS.map((name): [InfluenceLayer, InfluenceGrid] => [name, createGrid(name, width, height)]),
                    ) as Grids;
                    fillBase(world, width, height, scratch.ground.data, scratch.air.data);
                    fillExtraBases(world, stateByInfluence.get(resource)!, scratch, width, height);
                    return scratch[layer];
                }
                const grid = createGrid(layer, width, height);
                const isAir = AIR_LAYERS.has(layer);
                if (isAir) fillBase(world, width, height, undefined, grid.data);
                else fillBase(world, width, height, grid.data);
                return grid;
            },
            getForcefieldPositions() {
                current();
                return stateByInfluence.get(resource)!.forcefields.map((pos) => ({ ...pos }));
            },
            addCost(target, center, radius, weight) {
                const targets = asArray(target);
                for (const entry of targets) {
                    const { data, width, height, layer } = typeof entry === 'string' ? current()[entry] : entry;
                    addCircle(data, width, height, center.x, center.y, radius, weight);
                    if (layer === 'tacticalGround') continue;
                    const reach = Math.floor(radius);
                    const firstRow = Math.max(0, Math.floor(center.y) - reach);
                    const lastRow = Math.min(height - 1, Math.floor(center.y) + reach);
                    if (lastRow >= firstRow) clampToOne(data, firstRow * width, (lastRow + 1) * width);
                }
            },
            configure(settings) {
                const { settings: kept } = stateByInfluence.get(resource)!;
                Object.assign(kept, settings, { effects: { ...kept.effects, ...settings.effects } });
            },
            drawDebug(target, { threshold = 1 } = {}) {
                const { debug } = world.resources.get();
                if (!debug) return;
                const grid = typeof target === 'string' ? current()[target] : target;
                const { data, width, layer } = grid;
                const cells = [];
                for (let i = 0; i < data.length; i++) {
                    if (data[i] > threshold && Number.isFinite(data[i]))
                        cells.push({
                            pos: { x: (i % width) + 0.5, y: Math.floor(i / width) + 0.5 },
                            text: String(Math.round(data[i])),
                        });
                }
                debug.setDrawCells(`influence-${layer}`, cells);
            },
        };
        stateByInfluence.set(resource, freshState({ ...INFLUENCE_DEFAULTS, effects: {} }));
        return resource;
    },
    reset(resource) {
        stateByInfluence.set(resource, freshState(stateByInfluence.get(resource)!.settings));
    },
};
