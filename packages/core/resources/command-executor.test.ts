import { describe, expect, it } from 'bun:test';
import Bluebird from 'bluebird';
import createAgent from '../agent/create-agent.ts';
import { Ability, UnitType } from '../constants/index.ts';
import createSystem from '../systems/create-system.ts';
import { createTestWorld, loadFixture, stepTo } from '../test/create-test-world.ts';
import type { CommandResult, World } from '../types.ts';

const SUCCESS = 1 as SC2APIProtocol.ActionResult;
const ACTION_ERROR = 3 as SC2APIProtocol.ActionResult;

const WORKER = '4345823233';
const OTHER_WORKER = '4343988225';
const THIRD_WORKER = '4343726081';
const GEYSER = '4327473153';
const FIRST = { x: 20, y: 20 };
const SECOND = { x: 30, y: 30 };

const moveTo = (tag: string | string[], target: { x: number; y: number }) => ({
    abilityId: Ability.MOVE,
    unitTags: Array.isArray(tag) ? tag : [tag],
    targetWorldSpacePos: target,
    queueCommand: false,
});

const unitCommands = (requests: SC2APIProtocol.RequestAction[]) =>
    requests.map((request) => request.actions!.map((action) => action.actionRaw!.unitCommand));

const byOwner = (results: CommandResult[]) => [...results].sort((a, b) => a.owner.localeCompare(b.owner));

type Act = (world: World) => Promise<unknown>;

async function setupScenario(
    commanders: { name: string; act: Act; commandPriority?: number }[],
    {
        agentAct,
        prepare,
    }: {
        agentAct?: Act;
        prepare?: (fixture: ReturnType<typeof loadFixture>) => void;
    } = {},
) {
    let armed = false;
    const results: CommandResult[] = [];
    const recorder = createSystem({
        name: 'Recorder',
        async onCommandResults(_world: World, batch: CommandResult[]) {
            results.push(...batch);
        },
    });
    const systems = commanders.map(({ name, act, commandPriority }) =>
        createSystem(
            {
                name,
                async onStep(world: World) {
                    if (armed) await act(world);
                },
            },
            { commandPriority },
        ),
    );
    const agent = createAgent({
        async onStep(world: World) {
            if (armed && agentAct) await agentAct(world);
        },
    });
    agent.use([recorder, ...systems]);

    const fixture = loadFixture('blueshift');
    prepare?.(fixture);
    const world = await createTestWorld(fixture, { loop: 896, agent });
    const step = (loop: number) =>
        stepTo(world, {
            ...fixture.observations[896],
            observation: {
                ...fixture.observations[896].observation!,
                gameLoop: loop,
            },
        });

    // systems run a step later than the flush that reports on them
    const play = async () => {
        const sentBefore = world.client.sent.actions.length;
        armed = true;
        await step(912);
        armed = false;
        const sent = world.client.sent.actions.slice(sentBefore);
        await step(928);
        return { sent, results };
    };

    return { world, play };
}

describe('command executor dispatch', () => {
    it('sends one command per unit from the earliest registered system and reports won and outranked results the next step', async () => {
        const { play } = await setupScenario([
            {
                name: 'Economy',
                act: ({ resources }) => resources.get().actions.move(resources.get().units.getByTag(WORKER)!, FIRST),
            },
            {
                name: 'Combat',
                act: ({ resources }) => resources.get().actions.move(resources.get().units.getByTag(WORKER)!, SECOND),
            },
        ]);

        const { sent, results } = await play();

        expect(unitCommands(sent)).toEqual([[{ ...moveTo(WORKER, FIRST) }]]);
        expect(byOwner(results)).toEqual([
            {
                owner: 'Combat',
                command: moveTo(WORKER, SECOND),
                tags: [WORKER],
                outcome: 'dropped',
                reason: 'outranked',
                by: 'Economy',
            },
            {
                owner: 'Economy',
                command: moveTo(WORKER, FIRST),
                tags: [WORKER],
                outcome: 'won',
                result: SUCCESS,
            },
        ]);
    });

    it('attributes commands to the right system when both resume inside Bluebird callbacks', async () => {
        const viaBluebird =
            (tag: string, target: { x: number; y: number }): Act =>
            ({ resources }) =>
                Bluebird.resolve()
                    .then(() => Bluebird.delay(1))
                    .then(() => resources.get().actions.move(resources.get().units.getByTag(tag)!, target));
        const { play } = await setupScenario([
            { name: 'Economy', act: viaBluebird(WORKER, FIRST) },
            { name: 'Combat', act: viaBluebird(OTHER_WORKER, SECOND) },
        ]);

        const { results } = await play();

        expect(byOwner(results).map(({ owner, tags }) => ({ owner, tags }))).toEqual([
            { owner: 'Combat', tags: [OTHER_WORKER] },
            { owner: 'Economy', tags: [WORKER] },
        ]);
    });

    it('lets a system commandPriority override registration order', async () => {
        const { play } = await setupScenario([
            {
                name: 'Economy',
                act: ({ resources }) => resources.get().actions.move(resources.get().units.getByTag(WORKER)!, FIRST),
            },
            {
                name: 'Combat',
                commandPriority: 5,
                act: ({ resources }) => resources.get().actions.move(resources.get().units.getByTag(WORKER)!, SECOND),
            },
        ]);

        const { sent, results } = await play();

        expect(unitCommands(sent)).toEqual([[moveTo(WORKER, SECOND)]]);
        expect(
            byOwner(results).map(({ owner, outcome, by }) => ({
                owner,
                outcome,
                by,
            })),
        ).toEqual([
            { owner: 'Combat', outcome: 'won', by: undefined },
            { owner: 'Economy', outcome: 'dropped', by: 'Combat' },
        ]);
    });

    it('lets an agent handler beat an agent system at equal priority', async () => {
        const { play } = await setupScenario(
            [
                {
                    name: 'Economy',
                    act: ({ resources }) =>
                        resources.get().actions.move(resources.get().units.getByTag(WORKER)!, FIRST),
                },
            ],
            {
                agentAct: ({ resources }) =>
                    resources.get().actions.move(resources.get().units.getByTag(WORKER)!, SECOND),
            },
        );

        const { sent, results } = await play();

        expect(unitCommands(sent)).toEqual([[moveTo(WORKER, SECOND)]]);
        expect(
            byOwner(results).map(({ owner, outcome, by }) => ({
                owner,
                outcome,
                by,
            })),
        ).toEqual([
            { owner: 'agent', outcome: 'won', by: undefined },
            { owner: 'Economy', outcome: 'dropped', by: 'agent' },
        ]);
    });

    it('does not re-command a unit that was raw-sent this step from an equal or lower commander', async () => {
        const { play } = await setupScenario([
            {
                name: 'Economy',
                act: ({ resources }) => resources.get().actions.sendAction(moveTo(WORKER, FIRST)),
            },
            {
                name: 'Combat',
                act: ({ resources }) => resources.get().actions.move(resources.get().units.getByTag(WORKER)!, SECOND),
            },
        ]);

        const { sent, results } = await play();

        expect(unitCommands(sent)).toEqual([[moveTo(WORKER, FIRST)]]);
        expect(results).toEqual([
            {
                owner: 'Combat',
                command: moveTo(WORKER, SECOND),
                tags: [WORKER],
                outcome: 'dropped',
                reason: 'outranked',
                by: 'Economy',
            },
        ]);
    });

    it('drops a repeat of the current order without sending it', async () => {
        const { play } = await setupScenario(
            [
                {
                    name: 'Economy',
                    act: ({ resources }) =>
                        resources.get().actions.move(resources.get().units.getByTag(WORKER)!, FIRST),
                },
            ],
            {
                prepare(fixture) {
                    fixture.observations[896].observation!.rawData!.units!.find((unit) => unit.tag === WORKER)!.orders =
                        [{ abilityId: Ability.GENERAL_MOVE, targetWorldSpacePos: FIRST }];
                },
            },
        );

        const { sent, results } = await play();

        expect(sent).toEqual([]);
        expect(results).toEqual([
            {
                owner: 'Economy',
                command: moveTo(WORKER, FIRST),
                tags: [WORKER],
                outcome: 'dropped',
                reason: 'repeat',
            },
        ]);
    });

    it('merges identical commands to several units into one send and reports it against every proposal', async () => {
        const { play } = await setupScenario([
            {
                name: 'Economy',
                async act({ resources }) {
                    const { actions, units } = resources.get();
                    await actions.move(units.getByTag(WORKER)!, FIRST);
                    await actions.move(units.getByTag(OTHER_WORKER)!, FIRST);
                },
            },
        ]);

        const { sent, results } = await play();

        expect(unitCommands(sent)).toEqual([[moveTo([WORKER, OTHER_WORKER], FIRST)]]);
        expect(results).toEqual([
            {
                owner: 'Economy',
                command: moveTo(WORKER, FIRST),
                tags: [WORKER],
                outcome: 'won',
                result: SUCCESS,
            },
            {
                owner: 'Economy',
                command: moveTo(OTHER_WORKER, FIRST),
                tags: [OTHER_WORKER],
                outcome: 'won',
                result: SUCCESS,
            },
        ]);
    });

    it('reports a proposal split across commands and partly outranked once per outcome, calling onNotSent once per group', async () => {
        const notSent: string[][] = [];
        const { world, play } = await setupScenario([
            {
                name: 'Economy',
                async act({ resources }) {
                    const { actions, units } = resources.get();
                    actions.queueAction(moveTo([WORKER, OTHER_WORKER, THIRD_WORKER], FIRST), {
                        onNotSent: (tags) => notSent.push(tags),
                    });
                    await actions.move(units.getByTag(WORKER)!, SECOND, true);
                },
            },
            {
                name: 'Combat',
                commandPriority: 5,
                act: ({ resources }) =>
                    resources.get().actions.move(resources.get().units.getByTag(THIRD_WORKER)!, SECOND),
            },
        ]);
        const sent: SC2APIProtocol.RequestAction[] = [];
        world.client.action = async (request) => {
            sent.push(request);
            return { result: (request.actions ?? []).map(() => ACTION_ERROR) };
        };

        const { results } = await play();

        expect(unitCommands(sent)[0]).toHaveLength(4);
        const split = results.filter(({ command }) => command.unitTags!.length === 3);
        expect(split.map(({ outcome, tags }) => ({ outcome, tags: [...tags].sort() }))).toEqual([
            { outcome: 'dropped', tags: [THIRD_WORKER] },
            { outcome: 'rejected', tags: [OTHER_WORKER, WORKER].sort() },
        ]);
        expect(notSent.map((tags) => [...tags].sort())).toEqual(split.map(({ tags }) => [...tags].sort()));
    });

    it('sends same-owner follow-ups in order: a gas build with its gather, and a patrol as a move plus a queued patrol', async () => {
        const { play } = await setupScenario([
            {
                name: 'Economy',
                async act({ resources }) {
                    const { actions, units } = resources.get();
                    await actions.build(UnitType.REFINERY, units.getByTag(GEYSER)!, units.getByTag(WORKER)!);
                    await actions.patrol(units.getByTag(OTHER_WORKER)!, [FIRST, SECOND]);
                },
            },
        ]);

        const { sent, results } = await play();

        const [commands] = unitCommands(sent);
        expect(commands).toHaveLength(4);
        expect(commands[0]).toEqual({
            abilityId: Ability.BUILD_REFINERY,
            unitTags: [WORKER],
            queueCommand: false,
            targetUnitTag: GEYSER,
        });
        expect(commands[1]).toMatchObject({
            abilityId: Ability.SMART,
            unitTags: [WORKER],
            queueCommand: true,
        });
        expect(commands.slice(2)).toEqual([
            moveTo(OTHER_WORKER, FIRST),
            { abilityId: Ability.PATROL, unitTags: [OTHER_WORKER], targetWorldSpacePos: SECOND, queueCommand: true },
        ]);
        expect(results.map(({ outcome }) => outcome)).toEqual(['won', 'won', 'won', 'won']);
    });

    it('frees a unit whose command SC2 rejected in a mid-step flush for a lower-ranked system', async () => {
        let flushed: () => void = () => {};
        const earlyFlushDone = new Promise<void>((resolve) => {
            flushed = resolve;
        });
        const { world, play } = await setupScenario([
            {
                name: 'Economy',
                async act({ resources }) {
                    const { actions, units } = resources.get();
                    await actions.move(units.getByTag(WORKER)!, FIRST);
                    await actions.flushQueuedActions();
                    flushed();
                },
            },
            {
                name: 'Combat',
                async act({ resources }) {
                    await earlyFlushDone;
                    await resources.get().actions.move(resources.get().units.getByTag(WORKER)!, SECOND);
                },
            },
        ]);
        const sent: SC2APIProtocol.RequestAction[] = [];
        world.client.action = async (request) => {
            sent.push(request);
            return { result: (request.actions ?? []).map(() => (sent.length === 1 ? ACTION_ERROR : SUCCESS)) };
        };

        await play();

        expect(unitCommands(sent)).toEqual([[moveTo(WORKER, FIRST)], [moveTo(WORKER, SECOND)]]);
    });

    it('reports a rejected build, clearing the builder command label, and a rejected send with its error', async () => {
        const build: Act = ({ resources }) => {
            const { actions, units } = resources.get();
            return actions.build(UnitType.REFINERY, units.getByTag(GEYSER)!, units.getByTag(WORKER)!);
        };
        const rejected = await setupScenario([{ name: 'Economy', act: build }]);
        rejected.world.client.action = async (request) => ({
            result: (request.actions ?? []).map(() => ACTION_ERROR),
        });

        const { results } = await rejected.play();

        expect(results[0]).toMatchObject({
            owner: 'Economy',
            outcome: 'rejected',
            result: ACTION_ERROR,
            tags: [WORKER],
        });
        expect(rejected.world.resources.get().units.getByTag(WORKER)!.hasLabel('command')).toBe(false);

        const thrown = await setupScenario([
            {
                name: 'Economy',
                act: ({ resources }) => resources.get().actions.move(resources.get().units.getByTag(WORKER)!, FIRST),
            },
            {
                name: 'Combat',
                act: ({ resources }) =>
                    resources.get().actions.move(resources.get().units.getByTag(OTHER_WORKER)!, SECOND),
            },
        ]);
        thrown.world.client.action = async () => {
            throw new Error('socket closed');
        };

        const { results: thrownResults } = await thrown.play();

        expect(byOwner(thrownResults)).toEqual([
            {
                owner: 'Combat',
                command: moveTo(OTHER_WORKER, SECOND),
                tags: [OTHER_WORKER],
                outcome: 'rejected',
                error: expect.stringContaining('socket closed'),
            },
            {
                owner: 'Economy',
                command: moveTo(WORKER, FIRST),
                tags: [WORKER],
                outcome: 'rejected',
                error: expect.stringContaining('socket closed'),
            },
        ]);
    });
});
