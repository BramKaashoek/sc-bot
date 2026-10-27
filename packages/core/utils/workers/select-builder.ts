import { GATHERING } from '../../constants/unit-role.ts';
import { distance } from '../geometry/point.ts';
import type { Point2D, Unit, World } from '../../types.ts';

const REUSE_RANGE = 20;

type BuilderOptions = {
    exclude?: ReadonlySet<string>;
    reuseConstructing?: boolean;
};

export function selectBuilder(
    world: World,
    near: Point2D,
    { exclude, reuseConstructing = false }: BuilderOptions = {},
): Unit | undefined {
    const { units, roles, actions } = world.resources.get();
    const available = (worker: Unit) => {
        const role = roles.roleOf(worker);
        return (role === undefined || role === GATHERING) && !worker.labels.has('stuck') && !exclude?.has(worker.tag!);
    };

    if (reuseConstructing) {
        const constructing = units.getConstructingWorkers().filter(available);
        const reused = constructing.length > 0 ? constructing.closestTo(near) : undefined;
        if (reused && distance(reused.pos, near) < REUSE_RANGE) return reused;
    }

    const received = actions.unitTagsReceivedAction();
    const free = units
        .getWorkers()
        .filter((worker) => available(worker) && !worker.isConstructing() && !received.has(worker.tag!));
    const ready = free.filter((worker) => worker.isIdle() || (worker.orders!.length === 1 && worker.isGathering()));
    const pool = ready.length > 0 ? ready : free;
    return pool.length > 0 ? pool.closestTo(near) : undefined;
}
