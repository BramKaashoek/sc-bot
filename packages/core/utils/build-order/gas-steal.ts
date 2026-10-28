import { BuildOrder } from '../../constants/enums.ts';
import { ATTACK_ATTACK, MOVE } from '../../constants/ability.ts';
import { gasMineTypes } from '../../constants/groups.ts';
import { GasMineRace } from '../../constants/race-map.ts';
import { GAS_STEAL_PREVENTER, GATHERING } from '../../constants/unit-role.ts';
import { distance } from '../geometry/point.ts';
import type { Point2D, Unit, World } from '../../types.ts';

const MAIN_RADIUS = 12;
const GAS_RADIUS = 5;
const GUARD_ARRIVED = 1;
const MAX_MAIN_GAS = 2;

export type GasStealState = { guards: Map<string, { worker: string; pos: Point2D }> };

export const createGasStealState = (): GasStealState => ({ guards: new Map() });

type StepLike = { type: string; id?: number | number[]; status: number };

export function handleGasSteal<T extends StepLike>(
    world: World,
    state: GasStealState,
    current: T | undefined,
    startGas: (task: T, geyser: Unit, worker: Unit) => boolean,
) {
    const { actions, buildings, map, mining, roles, units } = world.resources.get();
    const main = map.getMain()?.townhallPosition;
    if (!main) return;

    const inMain = (unit: Unit) => distance(unit.pos!, main) <= MAIN_RADIUS;
    const enemyWorkers = units.getEnemyUnits().filter((unit) => unit.isWorker() && inMain(unit));
    const gasMines = units.getGasMines().filter(inMain);
    const gasBuiltAt = (pos: Point2D) => gasMines.some((mine) => distance(mine.pos!, pos) <= GAS_RADIUS);
    const command = (
        unit: Unit,
        abilityId: number,
        target: { targetUnitTag: string } | { targetWorldSpacePos: Point2D },
    ) => roles.as(GAS_STEAL_PREVENTER, () => actions.queueAction([{ abilityId, unitTags: [unit.tag!], ...target }]));

    const gasStep = current?.type === 'build' && typeof current.id === 'number' && gasMineTypes.includes(current.id);
    const gasStepStarted = gasStep && current.status !== BuildOrder.NOT_STARTED;
    const gasType = GasMineRace[world.agent.race as keyof typeof GasMineRace];
    const mayAssign = !gasStepStarted && gasMines.length < MAX_MAIN_GAS && buildings.pending(gasType) === 0;

    if (enemyWorkers.length > 0 && mayAssign) {
        const guarded = new Set(state.guards.keys());
        for (const geyser of units.getGasGeysers().filter(inMain)) {
            if (guarded.has(geyser.tag!) || gasBuiltAt(geyser.pos!)) continue;
            const worker = pickGuard(world, geyser.pos!);
            if (!worker) break;
            state.guards.set(geyser.tag!, { worker: worker.tag!, pos: geyser.pos! });
        }
    }

    for (const [geyserTag, { worker: workerTag, pos }] of [...state.guards]) {
        const worker = units.getByTag(workerTag);
        const geyser = units.getByTag(geyserTag);
        // buildings.build re-roles its worker to BUILDING and returns it to GATHERING when done, so don't release it
        if (worker && roles.roleOf(worker) !== GAS_STEAL_PREVENTER) {
            state.guards.delete(geyserTag);
            continue;
        }
        if (!worker || !geyser || enemyWorkers.length === 0 || gasBuiltAt(pos)) {
            state.guards.delete(geyserTag);
            if (worker) {
                if (mining.isEnabled()) mining.release(worker);
                else roles.assign(worker, GATHERING);
            }
            continue;
        }

        const target = enemyWorkers.find((enemy) => worker.targetInRange(enemy));
        if (target && worker.weaponReady()) {
            command(worker, ATTACK_ATTACK, { targetUnitTag: target.tag! });
        } else if (gasStep && current.status === BuildOrder.NOT_STARTED && startGas(current, geyser, worker)) {
            state.guards.delete(geyserTag);
        } else if (worker.distanceTo(pos) > GUARD_ARRIVED) {
            command(worker, MOVE, { targetWorldSpacePos: pos });
        }
    }
}

export function releaseGuards(world: World, state: GasStealState) {
    if (state.guards.size === 0) return;
    const { mining, roles, units } = world.resources.get();
    for (const { worker: workerTag } of state.guards.values()) {
        const worker = units.getByTag(workerTag);
        if (!worker || roles.roleOf(worker) !== GAS_STEAL_PREVENTER) continue;
        if (mining.isEnabled()) mining.release(worker);
        else roles.assign(worker, GATHERING);
    }
    state.guards.clear();
}

function pickGuard(world: World, near: Point2D) {
    const { mining, roles, units } = world.resources.get();
    if (mining.isEnabled()) return mining.selectWorker(near, { forceClose: true, role: GAS_STEAL_PREVENTER });
    const [worker] = units
        .getMineralWorkers()
        .filter((unit) => roles.roleOf(unit) === GATHERING)
        .closestNUnits(near, 1);
    if (worker) roles.assign(worker, GAS_STEAL_PREVENTER);
    return worker;
}
