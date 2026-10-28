import { toTag } from '../utils/collections.ts';
import { currentCommander } from './command-context.ts';
import type { BehaviorContext, BehaviorsResource, Point2D, ResourceDefinition, Unit, World } from '../types.ts';

function createBehaviors(world: World): BehaviorsResource {
    let loop = -1;
    const orderedByOwner = new Map<string, Set<string>>();

    const orderedThisLoop = () => {
        const now = world.resources.get().frame.getGameLoop();
        if (now !== loop) {
            orderedByOwner.clear();
            loop = now;
        }
        const { owner } = currentCommander();
        let ordered = orderedByOwner.get(owner);
        if (!ordered) {
            ordered = new Set();
            orderedByOwner.set(owner, ordered);
        }
        return ordered;
    };

    const ctx: BehaviorContext = {
        world,
        order(units, abilityId, target, { queue = false } = {}) {
            const ordered = orderedThisLoop();
            const unitTags = [units]
                .flat()
                .map((unit) => unit.tag)
                .filter((tag) => queue || !ordered.has(tag));
            if (unitTags.length === 0) return false;

            const targeting =
                target === undefined
                    ? {}
                    : 'tag' in target
                      ? { targetUnitTag: (target as Unit).tag }
                      : { targetWorldSpacePos: { x: (target as Point2D).x, y: (target as Point2D).y } };
            world.resources.get().actions.queueAction({ abilityId, unitTags, queueCommand: queue, ...targeting });
            unitTags.forEach((tag) => ordered.add(tag));
            return true;
        },
        hasOrdered(unit) {
            return orderedThisLoop().has(toTag(unit));
        },
    };

    return {
        run(behavior, { role, priority } = {}) {
            const execute = async () => behavior.execute(ctx);
            const { roles, actions } = world.resources.get();
            if (role) return roles.as(role, execute, { priority });
            if (priority !== undefined) return actions.as({ priority }, execute);
            return execute();
        },
    };
}

export const behaviorsResource: ResourceDefinition<'behaviors'> = {
    name: 'behaviors',
    create: (world) => createBehaviors(world),
};
