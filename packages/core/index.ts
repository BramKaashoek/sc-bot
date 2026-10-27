/// <reference path="./vendor.d.ts" />

import { PlayerType } from './constants/enums.ts';
import createAgent from './agent/index.ts';
import createEngine from './engine/index.ts';
import createSystem from './systems/index.ts';
import { taskFunctions } from './systems/builder-plugin.ts';
import type { Agent } from './types.ts';

export type * from './types.ts';

function createPlayer(
    settings: Omit<SC2APIProtocol.PlayerSetup, 'race' | 'type'> & { race: SC2APIProtocol.Race },
    entity?: Agent,
) {
    const type = entity ? PlayerType.PARTICIPANT : PlayerType.COMPUTER;
    return {
        ...settings,
        type,
        agent: entity,
    };
}

export { createAgent, createEngine, createSystem, createPlayer, taskFunctions };
export { Units } from './resources/units-collection.ts';
export { Ramp } from './utils/map/ramp.ts';
export { PixelMap } from './utils/pixel-map.ts';
export { canWinFight, simulateFight } from './utils/combat/combat-sim.ts';
export { avgPoints, closestPoint, distance, distanceSquared, towards } from './utils/geometry/point.ts';
export { parseBuildOrder } from './utils/build-order/parse.ts';
export {
    DEFAULT_EFFECT_COSTS,
    EFFECT_INFLUENCE,
    INFLUENCE_DEFAULTS,
    STATIC_DEFENSE,
    UNIT_AVOIDANCE,
    WEIGHT_COSTS,
} from './constants/influence.ts';
export type { EffectInfluence, InfluenceSource, StaticDefenseSource, WeightCost } from './constants/influence.ts';
export {
    ActionManagerError,
    BuildError,
    ConnectionClosedError,
    GameEndedError,
    GatherError,
    MapDecompositionError,
    NodeSC2Error,
    TrainError,
} from './engine/errors.ts';
