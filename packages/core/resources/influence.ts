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
import * as UnitType from '../constants/unit-type.ts';
import { addCircle } from '../utils/grid/stamp.ts';
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

const LAYERS: InfluenceLayer[] = ['ground', 'air', 'groundAvoidance', 'airAvoidance'];
const GAME_LOOPS_PER_SECOND = 22.4;

const CHANGELINGS = new Set([
    UnitType.CHANGELING,
    UnitType.CHANGELINGMARINE,
    UnitType.CHANGELINGMARINESHIELD,
    UnitType.CHANGELINGZEALOT,
    UnitType.CHANGELINGZERGLING,
    UnitType.CHANGELINGZERGLINGWINGS,
]);

const LIBERATOR_ZONES = new Set([Effect.LIBERATORTARGETMORPHDELAYPERSISTENT, Effect.LIBERATORTARGETMORPHPERSISTENT]);

// proto typings omit Effect.alliance, but the bundled decoder fills it
type EffectWithAlliance = SC2APIProtocol.Effect & { alliance?: SC2APIProtocol.Alliance };

type Grids = Record<InfluenceLayer, InfluenceGrid>;

type State = { settings: InfluenceSettings; grids?: Grids; builtLoop: number };

const stateByResource = new WeakMap<InfluenceResource, State>();

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

    const pathing = map._grids.pathing ?? [];
    const { p0, p1 } = frame.getGameInfo().startRaw?.playableArea ?? {};
    const [x0, y0, x1, y1] = [p0?.x ?? 0, p0?.y ?? 0, p1?.x ?? width, p1?.y ?? height];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const ground = pathing[y]?.[x] === 0 ? 1 : Infinity;
            const air = x >= x0 && x < x1 && y >= y0 && y < y1 ? 1 : Infinity;
            grids.ground.data[i] = ground;
            grids.groundAvoidance.data[i] = ground;
            grids.air.data[i] = air;
            grids.airAvoidance.data[i] = air;
        }
    }

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

    for (const effect of map.getEffects() as EffectWithAlliance[]) {
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
        const state: State = {
            settings: { ...INFLUENCE_DEFAULTS, effects: {} },
            builtLoop: -1,
        };
        const current = (): Grids => {
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
            addCost(layers, center, radius, weight) {
                const grids = current();
                for (const layer of Array.isArray(layers) ? layers : [layers]) {
                    const { data, width, height } = grids[layer];
                    addCircle(data, width, height, center.x, center.y, radius, weight);
                    const reach = Math.floor(radius);
                    const firstRow = Math.max(0, Math.floor(center.y) - reach);
                    const lastRow = Math.min(height - 1, Math.floor(center.y) + reach);
                    if (lastRow >= firstRow) clampToOne(data, firstRow * width, (lastRow + 1) * width);
                }
            },
            configure(settings) {
                Object.assign(state.settings, settings, {
                    effects: { ...state.settings.effects, ...settings.effects },
                });
            },
            drawDebug(layer, { threshold = 1 } = {}) {
                const { debug } = world.resources.get();
                if (!debug) return;
                const { data, width } = current()[layer];
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
        stateByResource.set(resource, state);
        return resource;
    },
    reset(resource) {
        const state = stateByResource.get(resource)!;
        state.grids = undefined;
        state.builtLoop = -1;
    },
};
