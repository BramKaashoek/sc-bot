import { describe, expect, it, spyOn } from 'bun:test';
import { ATTACK_ATTACK } from '../../constants/ability.ts';
import { Alliance, BuildOrder } from '../../constants/enums.ts';
import { BUILDING, GAS_STEAL_PREVENTER, GATHERING } from '../../constants/unit-role.ts';
import { UnitType } from '../../constants/index.ts';
import { createTestWorld, stepTo } from '../../test/create-test-world.ts';
import type { TestWorld } from '../../test/create-test-world.ts';
import { rawUnit } from '../../test/factories.ts';
import { createGasStealState, handleGasSteal, releaseGuards } from './gas-steal.ts';
import type { GasStealState } from './gas-steal.ts';

const GEYSER_TAG = '4319346689';
const GEYSER = { x: 19.5, y: 8.5, z: 10 };
type Step = { type: string; id: number; status: number };
const gasStep: Step = { type: 'build', id: UnitType.REFINERY, status: BuildOrder.NOT_STARTED };

const enemyWorker = (pos = { x: 12, y: 15, z: 10 }) =>
    rawUnit({ unitType: UnitType.SCV, alliance: Alliance.ENEMY, owner: 2, pos });

async function observe(
    world: TestWorld,
    edits: Record<string, SC2APIProtocol.Unit> = {},
    added: SC2APIProtocol.Unit[] = [],
) {
    const next = structuredClone(world.client.fixture.observations[896]);
    next.observation!.gameLoop = 900;
    next.observation!.rawData!.units = [
        ...next.observation!.rawData!.units!.map((raw) => ({ ...raw, ...edits[raw.tag!] })),
        ...added,
    ];
    await stepTo(world, next);
}

async function setup(added: SC2APIProtocol.Unit[] = [], guardedEdits: SC2APIProtocol.Unit = {}) {
    const world = await createTestWorld('blueshift', { loop: 896 });
    const { actions, units } = world.resources.get();
    const [worker] = units.getMineralWorkers();
    await observe(world, { [worker.tag!]: { pos: GEYSER, ...guardedEdits } }, added);
    const queued = spyOn(actions, 'queueAction');
    const state: GasStealState = createGasStealState();
    state.guards.set(GEYSER_TAG, { worker: worker.tag!, pos: GEYSER });
    world.resources.get().roles.assign(worker.tag!, GAS_STEAL_PREVENTER);
    const commands = () =>
        queued.mock.calls
            .flatMap(([command]) => [command].flat())
            .map(({ abilityId, targetUnitTag }) => [abilityId, targetUnitTag]);
    return { world, state, worker, commands };
}

describe('handleGasSteal', () => {
    it('attacks an enemy worker in range while the weapon is ready, else leaves it holding', async () => {
        const enemy = enemyWorker({ ...GEYSER, x: GEYSER.x + 0.5 });
        const ready = await setup([enemy]);
        const cooling = await setup([enemyWorker({ ...GEYSER, x: GEYSER.x + 0.5 })], { weaponCooldown: 10 });

        handleGasSteal(ready.world, ready.state, undefined, () => false);
        handleGasSteal(cooling.world, cooling.state, undefined, () => false);

        expect([ready.commands(), cooling.commands()]).toEqual([[[ATTACK_ATTACK, enemy.tag]], []]);
    });

    it('builds the gas with the guard when the current step is an unstarted gas step and startGas accepts, keeping the guard while it refuses', async () => {
        const { world, state, worker } = await setup([enemyWorker()]);
        const startGas = spyOn({ fn: (_task: Step, _geyser: unknown, _worker: unknown): boolean => false }, 'fn');
        const geyser = world.resources.get().units.getByTag(GEYSER_TAG);

        handleGasSteal(world, state, gasStep, startGas);
        const refused = state.guards.size;
        state.guards.set(GEYSER_TAG, { worker: worker.tag!, pos: GEYSER });
        handleGasSteal(world, state, { ...gasStep, status: BuildOrder.COMMAND_GIVEN }, startGas);
        const startedCalls = startGas.mock.calls.length;
        startGas.mockReturnValue(true);
        handleGasSteal(world, state, gasStep, startGas);

        expect([refused, startedCalls, state.guards.size, startGas.mock.calls.at(-1)]).toEqual([
            1,
            1,
            0,
            [gasStep, geyser, worker],
        ]);
    });

    it('releases the guard to gathering when the enemy workers leave, a gas building is within 5, or the geyser is gone', async () => {
        const leave = await setup();
        const built = await setup([enemyWorker(), rawUnit({ unitType: UnitType.REFINERY, pos: { ...GEYSER, x: 22 } })]);
        const gone = await setup([enemyWorker()]);
        spyOn(gone.world.resources.get().buildings, 'pending').mockReturnValue(1);
        gone.state.guards.set('missing', gone.state.guards.get(GEYSER_TAG)!);
        gone.state.guards.delete(GEYSER_TAG);

        for (const { world, state } of [leave, built, gone]) handleGasSteal(world, state, undefined, () => false);

        expect(
            [leave, built, gone].map(({ world, state, worker }) => [
                state.guards.size,
                world.resources.get().roles.roleOf(worker),
            ]),
        ).toEqual(Array(3).fill([0, GATHERING]));
    });

    it('leaves a guarded worker alone when something else gave it a role, while enemies are present', async () => {
        const { world, state, worker, commands } = await setup([enemyWorker()]);
        world.resources.get().roles.assign(worker.tag!, BUILDING);

        handleGasSteal(world, state, undefined, () => false);

        expect([state.guards.size, world.resources.get().roles.roleOf(worker), commands()]).toEqual([0, BUILDING, []]);
    });

    it('releaseGuards sends guards back to gathering, skips re-roled workers and clears the map', async () => {
        const guard = await setup([enemyWorker()]);
        const reroled = await setup([enemyWorker()]);
        reroled.world.resources.get().roles.assign(reroled.worker.tag!, BUILDING);

        releaseGuards(guard.world, guard.state);
        releaseGuards(reroled.world, reroled.state);

        expect([
            [guard, reroled].map(({ state }) => state.guards.size),
            guard.world.resources.get().roles.roleOf(guard.worker),
            reroled.world.resources.get().roles.roleOf(reroled.worker),
        ]).toEqual([[0, 0], GATHERING, BUILDING]);
    });

    it('assigns no guard when the gas step already started, a gas building is pending, or two gas buildings stand in the main, and assigns one otherwise', async () => {
        const assigned = async (current?: Step, pending = 0, extraGas: SC2APIProtocol.Unit[] = []) => {
            const world = await createTestWorld('blueshift', { loop: 896 });
            spyOn(world.resources.get().buildings, 'pending').mockReturnValue(pending);
            await observe(world, {}, [enemyWorker(), ...extraGas]);
            const state = createGasStealState();
            handleGasSteal(world, state, current, () => false);
            return state.guards.size;
        };
        const refinery = rawUnit({ unitType: UnitType.REFINERY, pos: { x: 22, y: 20, z: 10 } });

        expect([
            await assigned(),
            await assigned({ ...gasStep, status: BuildOrder.COMMAND_GIVEN }),
            await assigned(undefined, 1),
            await assigned(undefined, 0, [refinery]),
        ]).toEqual([1, 0, 0, 0]);

        const world = await createTestWorld('blueshift', { loop: 896 });
        const { mining } = world.resources.get();
        spyOn(mining, 'isEnabled').mockReturnValue(true);
        const select = spyOn(mining, 'selectWorker').mockReturnValue(undefined);
        await observe(world, {}, [enemyWorker()]);
        handleGasSteal(world, createGasStealState(), undefined, () => false);
        expect(select.mock.calls).toEqual([
            [expect.objectContaining({ x: GEYSER.x, y: GEYSER.y }), { forceClose: true, role: GAS_STEAL_PREVENTER }],
        ]);
    }, 30000);
});
