import {
    DEFAULT_EFFECT_COSTS,
    EFFECT_INFLUENCE,
    INFLUENCE_DEFAULTS,
    STATIC_DEFENSE,
    UNIT_AVOIDANCE,
    WEIGHT_COSTS,
} from '../constants/influence.ts';
import * as Effect from '../constants/effect.ts';
import { Alliance } from '../constants/enums.ts';
import { NodeSC2Error } from '../engine/errors.ts';
import * as UnitType from '../constants/unit-type.ts';
import { CHANGELINGS } from '../utils/combat/changelings.ts';
import { asArray } from '../utils/collections.ts';
import { addCircle } from '../utils/grid/stamp.ts';
import type { InfluenceSource } from '../constants/influence.ts';
import type {
    InfluenceGrid,
    InfluenceLayer,
    InfluenceResource,
    InfluenceSettings,
    OwnedEffect,
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

const AIR_LAYERS = new Set<InfluenceLayer>(['air', 'airAvoidance', 'airVsGround', 'groundToAir', 'tacticalGround']);

const LIBERATOR_ZONES = new Set([Effect.LIBERATORTARGETMORPHDELAYPERSISTENT, Effect.LIBERATORTARGETMORPHPERSISTENT]);

type Grids = Record<InfluenceLayer, InfluenceGrid>;

type State = { settings: InfluenceSettings; grids?: Grids; builtLoop: number };

export const stateByInfluence = new WeakMap<InfluenceResource, State>();

const freshState = (settings: InfluenceSettings): State => ({ settings, builtLoop: -1 });

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

function build(world: World, state: State): Grids {
    const { frame, map, memory } = world.resources.get();
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
    // placeholder bases until R2-T10 builds the real ones
    grids.climber.data.set(grids.ground.data);
    grids.priorityGroundAvoidance.data.set(grids.ground.data);
    grids.airVsGround.data.set(grids.air.data);
    grids.groundToAir.data.set(grids.air.data);
    grids.tacticalGround.data.set(grids.air.data);

    const stamp = (layers: readonly InfluenceLayer[], center: Point2D, radius: number, weight: number) => {
        for (const layer of layers)
            addCircle(grids[layer].data, width, height, center.x, center.y, radius, weight * settings.costMultiplier);
    };
    const stampSource = (unit: Unit, source: InfluenceSource, range = source.range) =>
        stamp(source.layers, unit.pos, range + (source.buffer ? settings[source.buffer] : 0), source.weight);

    const gameSeconds = frame.getGameLoop() / GAME_LOOPS_PER_SECOND;
    for (const enemy of memory.getEnemies()) {
        const unitType = enemy.unitType!;
        if (CHANGELINGS.has(unitType) || !enemy.isFinished()) continue;

        const table = WEIGHT_COSTS[unitType];
        const staticDefense = STATIC_DEFENSE[unitType];
        const avoidance = UNIT_AVOIDANCE[unitType];
        if (table) {
            if (table.airRange > 0) stamp(['air'], enemy.pos, table.airRange + settings.rangeBuffer, table.airCost);
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
            if (airDps > 0) stamp(['air'], enemy.pos, enemy.airRange() + settings.rangeBuffer, airDps);
        }
        if (avoidance) stampSource(enemy, avoidance);
    }

    for (const effect of map.getEffects() as OwnedEffect[]) {
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

    for (const layer of LAYERS) clampToOne(grids[layer].data);
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
                const grid = createGrid(layer, width, height);
                const isAir = AIR_LAYERS.has(layer);
                if (isAir) fillBase(world, width, height, undefined, grid.data);
                else fillBase(world, width, height, grid.data);
                return grid;
            },
            getForcefieldPositions() {
                throw new NodeSC2Error('not implemented: getForcefieldPositions');
            },
            addCost(target, center, radius, weight) {
                const targets = asArray(target);
                for (const entry of targets) {
                    const { data, width, height } = typeof entry === 'string' ? current()[entry] : entry;
                    addCircle(data, width, height, center.x, center.y, radius, weight);
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
