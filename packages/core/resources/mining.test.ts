import { describe, expect, it } from 'bun:test';
import { BUILD_SUPPLYDEPOT, HARVEST_GATHER } from '../constants/ability.ts';
import { DisplayType } from '../constants/enums.ts';
import { BUILDING, GATHERING } from '../constants/unit-role.ts';
import { COMMANDCENTER, REFINERY } from '../constants/unit-type.ts';
import createAgent from '../agent/create-agent.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import { rawUnit } from '../test/factories.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { CommandResult } from '../types.ts';

const CLOSE_PATCHES = ['4302045185', '4318560257', '4305715201', '4324851713'];
const FAR_PATCHES = ['4304928769', '4313317377', '4333240321', '4332453889'];
const PATCHES = [...CLOSE_PATCHES, ...FAR_PATCHES];
const MINING = 'role:GATHERING';
const LOOPS_PER_STEP = 12;

type Edit = (units: SC2APIProtocol.Unit[]) => SC2APIProtocol.Unit[];

function observation(world: TestWorld, gameLoop: number, edit: Edit = (units) => units) {
    const responseObservation = structuredClone(world.client.fixture.observations[0]);
    const raw = responseObservation.observation!;
    raw.gameLoop = gameLoop;
    raw.rawData!.units = edit(raw.rawData!.units!);
    return responseObservation;
}

async function miningWorld(agent = createAgent()) {
    const world = await createTestWorld('blueshift', { loop: 0, agent });
    const { mining, events } = world.resources.get();
    mining.configure({ enabled: true });
    const reader = events.createReader();
    let loop = 0;
    const step = async (edit?: Edit) => {
        loop += LOOPS_PER_STEP;
        await stepTo(world, observation(world, loop, edit));
        return events
            .read(reader)
            .filter(({ name }) => name === 'commandResults')
            .flatMap(({ data }) => data as CommandResult[]);
    };
    return { world, step };
}

const counts = (world: TestWorld, tags: string[]) =>
    tags.map((tag) => world.resources.get().mining.getWorkersOn(tag).length);

const commandedTags = (results: CommandResult[]) =>
    results.filter(({ owner }) => owner === MINING).flatMap(({ tags }) => tags);

const extraWorkers = (count: number) => Array.from({ length: count }, () => rawUnit({ pos: { x: 14, y: 12, z: 12 } }));

const withRefinery: Edit = (units) => [
    ...units,
    rawUnit({ tag: 'refinery', unitType: REFINERY, pos: { x: 19.5, y: 8.5, z: 12 }, vespeneContents: 2250 }),
];

describe('mining', () => {
    it('does nothing until enabled', async () => {
        const world = await createTestWorld('blueshift', { loop: 0 });
        const { events, roles } = world.resources.get();
        const reader = events.createReader();
        const before = roles.getTags(GATHERING).size;

        await stepTo(world, observation(world, 4));

        expect(events.read(reader).filter(({ name }) => name === 'commandResults')).toHaveLength(0);
        expect([roles.getTags(GATHERING).size, roles.getTags(BUILDING).size]).toEqual([before, 0]);
    });

    it('splits 2 onto the 4 closest patches and 1 onto the rest, then caps every patch at 2', async () => {
        const { world, step } = await miningWorld();

        const results = await step();
        expect([counts(world, CLOSE_PATCHES), counts(world, FAR_PATCHES)]).toEqual([
            [2, 2, 2, 2],
            [1, 1, 1, 1],
        ]);
        const targets = results
            .filter(({ owner, command }) => owner === MINING && command.abilityId === HARVEST_GATHER)
            .map(({ command }) => command.targetUnitTag!);
        expect(targets.length).toBeGreaterThan(0);
        expect(targets.filter((tag) => !PATCHES.includes(tag))).toEqual([]);

        const extra = extraWorkers(6);
        await step((units) => [...units, ...extra]);
        expect(counts(world, PATCHES)).toEqual(Array(8).fill(2));
    });

    it('only mines visible minerals at townhalls past 85% built', async () => {
        const { world, step } = await miningWorld();
        const natural = world.resources.get().map.getNatural()!;
        const naturalPatches = natural.cluster.mineralFields.map(({ tag }) => tag);
        const added = [
            rawUnit({ unitType: COMMANDCENTER, pos: { ...natural.townhallPosition, z: 12 }, buildProgress: 0.85 }),
            ...extraWorkers(6),
        ];
        const edit: Edit = (units) => [
            ...units.map((unit) =>
                unit.tag === FAR_PATCHES[0] ? { ...unit, displayType: DisplayType.SNAPSHOT } : unit,
            ),
            ...added,
        ];

        await step(edit);
        await step(edit);

        expect(counts(world, [FAR_PATCHES[0], ...naturalPatches]).filter((count) => count > 0)).toEqual([]);
        expect(counts(world, FAR_PATCHES.slice(1))).toEqual([2, 2, 2]);
    });

    it('fills gas one worker per pass up to workersPerGas and drains one per pass when lowered', async () => {
        const { world, step } = await miningWorld();
        const { mining } = world.resources.get();
        const onGas = async () => {
            await step(withRefinery);
            return mining.getWorkersOn('refinery').length;
        };

        await step(withRefinery);
        expect([await onGas(), await onGas(), await onGas(), await onGas()]).toEqual([1, 2, 3, 3]);

        mining.configure({ workersPerGas: 1 });
        [4, -1, 1.5].forEach((workersPerGas) =>
            expect(() => mining.configure({ workersPerGas, enabled: false })).toThrow(RangeError),
        );
        expect([await onGas(), await onGas(), await onGas()]).toEqual([2, 1, 1]);

        mining.configure({ workersPerGas: 0 });
        expect(await onGas()).toBe(0);
        expect(counts(world, PATCHES).reduce((sum, count) => sum + count, 0)).toBe(12);
    });

    it('frees workers of a mined-out patch or a dead townhall and reassigns them', async () => {
        const { world, step } = await miningWorld();
        const { mining } = world.resources.get();
        await step();
        const freed = mining.getWorkersOn(CLOSE_PATCHES[0]);

        await step((units) => units.filter(({ tag }) => tag !== CLOSE_PATCHES[0]));
        expect(freed.map((tag) => mining.getAssignment(tag)?.kind)).toEqual(['mineral', 'mineral']);
        expect(freed.map((tag) => mining.getAssignment(tag)!.resourceTag)).not.toContain(CLOSE_PATCHES[0]);

        await step((units) => units.filter(({ unitType }) => unitType !== COMMANDCENTER));
        expect(counts(world, PATCHES)).toEqual(Array(8).fill(0));
    });

    it('selects builders out of the bookkeeping, preferring unassigned gatherers unless forceClose', async () => {
        const { world, step } = await miningWorld();
        const { mining, roles } = world.resources.get();
        await step();
        const near = { x: 16, y: 9 };

        const builder = mining.selectWorker(near, { forceClose: true })!;
        expect([roles.roleOf(builder), mining.getAssignment(builder)]).toEqual([BUILDING, undefined]);
        await step();
        expect(mining.getAssignment(builder)).toBeUndefined();

        mining.release(builder);
        expect(roles.roleOf(builder)).toBe(GATHERING);
        expect(mining.selectWorker(near, { minHealth: 1.1 })).toBeUndefined();
        expect(mining.selectWorker({ x: 9, y: 16 }, { role: GATHERING })!.tag).toBe(builder.tag);
        expect(mining.selectWorker(near, { forceClose: true, role: GATHERING })!.tag).not.toBe(builder.tag);

        await step();
        expect(mining.getAssignment(builder)).toMatchObject({ kind: 'mineral' });
    });

    it('leaves a GATHERING builder alone while it builds or holds a command label, then reclaims it', async () => {
        const { world, step } = await miningWorld();
        const { mining, roles, units } = world.resources.get();
        await step();
        const builder = mining.selectWorker({ x: 16, y: 9 }, { forceClose: true, role: GATHERING })!;
        const [labelled] = mining.getWorkersOn(CLOSE_PATCHES[0]);
        units.getByTag(labelled)!.labels.set('command', LOOPS_PER_STEP);
        const depotOrder = [{ abilityId: BUILD_SUPPLYDEPOT, targetWorldSpacePos: { x: 20, y: 20 } }];
        const building: Edit = (all) =>
            all.map((unit) => (unit.tag === builder.tag ? { ...unit, orders: depotOrder } : unit));

        const busy = commandedTags([...(await step(building)), ...(await step(building))]);
        expect(roles.roleOf(builder)).toBe(GATHERING);
        expect(mining.getAssignment(builder)).toBeUndefined();
        expect(busy.length).toBeGreaterThan(0);
        expect(busy.filter((tag) => tag === builder.tag || tag === labelled)).toEqual([]);

        const idle = await step((all) =>
            all.map((unit) => (unit.tag === builder.tag ? { ...unit, orders: [] } : unit)),
        );
        expect(mining.getAssignment(builder)).toMatchObject({ kind: 'mineral' });
        expect(commandedTags(idle)).toContain(builder.tag);
    });

    it('loses to a bot command at priority 0 on the same worker', async () => {
        const agent = createAgent({
            async onStep(world) {
                const { actions, units } = world.resources.get();
                await actions.move(units.getWorkers(true), { x: 20, y: 20 });
            },
        });
        const { step } = await miningWorld(agent);

        const mining = (await step()).filter(({ owner }) => owner === MINING);

        expect(mining.length).toBeGreaterThan(0);
        expect(mining.map(({ outcome, reason, by }) => ({ outcome, reason, by }))).toEqual(
            Array(mining.length).fill({ outcome: 'dropped', reason: 'outranked', by: 'agent' }),
        );
    });

    it('keeps configured settings across a game reset but not the assignments', async () => {
        const { world, step } = await miningWorld();
        const { mining } = world.resources.get();
        mining.configure({ workersPerGas: 2 });
        await step(withRefinery);
        await step(withRefinery);
        expect(mining.getWorkersOn('refinery')).toHaveLength(1);

        await world.engine.setupGame();
        expect([
            mining.getWorkersOn('refinery').length,
            counts(world, CLOSE_PATCHES),
            counts(world, FAR_PATCHES),
        ]).toEqual([0, [2, 2, 2, 2], [1, 1, 1, 1]]);

        for (let pass = 0; pass < 3; pass += 1) await step(withRefinery);
        expect(mining.getWorkersOn('refinery')).toHaveLength(2);
    });
});
