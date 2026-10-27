import type { World } from '../../types.ts';

export function ownUnitCount(world: World, unitType: number): number {
    return world.resources.get().units.getById(unitType).length + world.agent.alreadyPending(unitType);
}

export function structurePending(world: World, unitType: number): number {
    const { buildings, units } = world.resources.get();
    const tracked = new Set(buildings.getTracked().flatMap(({ structureTag }) => (structureTag ? [structureTag] : [])));
    const untracked = units
        .getById(unitType)
        .filter((structure) => structure.buildProgress! < 1 && !tracked.has(structure.tag));
    return buildings.pending(unitType) + untracked.length;
}
