import { abilityCooldown } from '../constants/dicts/ability-cooldown.ts';
import type { AbilityTracker, ResourceDefinition, Unit } from '../types.ts';

type State = {
    readyAtByKey: Map<string, number>;
    cooldownOverrides: Map<number, number>;
};

const stateByTracker = new WeakMap<AbilityTracker, State>();

const keyOf = (unit: Unit | string, abilityId: number) => `${typeof unit === 'string' ? unit : unit.tag}:${abilityId}`;

export const abilityTrackerResource: ResourceDefinition<'abilityTracker'> = {
    name: 'abilityTracker',
    create(world) {
        const state: State = { readyAtByKey: new Map(), cooldownOverrides: new Map() };
        const tracker: AbilityTracker = {
            used(unit, abilityId) {
                const cooldown = state.cooldownOverrides.get(abilityId) ?? abilityCooldown[abilityId];
                if (cooldown === undefined) return;
                const loop = world.resources.get().frame.getGameLoop();
                state.readyAtByKey.set(keyOf(unit, abilityId), loop + cooldown);
            },
            ready(unit, abilityId) {
                const readyAt = state.readyAtByKey.get(keyOf(unit, abilityId));
                return readyAt === undefined || world.resources.get().frame.getGameLoop() >= readyAt;
            },
            readyAt(unit, abilityId) {
                return state.readyAtByKey.get(keyOf(unit, abilityId));
            },
            setCooldown(abilityId, loops) {
                state.cooldownOverrides.set(abilityId, loops);
            },
        };
        stateByTracker.set(tracker, state);
        return tracker;
    },
    reset(tracker) {
        const state = stateByTracker.get(tracker)!;
        state.readyAtByKey.clear();
        state.cooldownOverrides.clear();
    },
};
