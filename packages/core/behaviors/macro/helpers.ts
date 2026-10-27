import type { World } from '../../types.ts';

export function ownUnitCount(world: World, unitType: number): number {
    const ready = world.resources
        .get()
        .units.getById(unitType)
        .filter((unit) => unit.buildProgress === 1).length;
    return ready + world.agent.alreadyPending(unitType);
}

export function notStarted(world: World, unitType: number): number {
    return world.resources
        .get()
        .buildings.getTracked()
        .filter((build) => build.unitType === unitType && (build.status === 'moving' || build.status === 'ordered'))
        .length;
}
