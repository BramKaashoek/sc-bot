import type { World } from '../types.ts';

// systems are shared module objects, so per-game state hangs off the world they're handed
function perWorld<T>(create: (world: World) => T) {
    const states = new WeakMap<World, T>();
    return {
        get(world: World): T {
            if (!states.has(world)) states.set(world, create(world));
            return states.get(world)!;
        },
        clear(world: World) {
            states.delete(world);
        },
    };
}

export { perWorld };
