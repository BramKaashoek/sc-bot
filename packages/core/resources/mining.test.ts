import { describe, expect, it, spyOn } from 'bun:test';
import { ATTACK, BUILD_SUPPLYDEPOT, HARVEST_GATHER, HARVEST_RETURN, MOVE, SMART } from '../constants/ability.ts';
import { CARRYMINERALFIELDMINERALS } from '../constants/buff.ts';
import { Alliance, DisplayType } from '../constants/enums.ts';
import { BUILDING, GATHERING } from '../constants/unit-role.ts';
import { COMMANDCENTER, REFINERY, ZERGLING } from '../constants/unit-type.ts';
import createAgent from '../agent/create-agent.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import { rawUnit } from '../test/factories.ts';
import { mineralTargets, townhallTarget } from '../utils/mining/targets.ts';
import { miningResource } from './mining.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { BaseThreat, CommandResult, Point2D, Unit } from '../types.ts';

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

type Sent = { abilityId?: number; target?: string; pos?: Point2D; queue?: boolean };

async function commandsFor(world: TestWorld, worker: Unit): Promise<Sent[]> {
    const { mining, actions } = world.resources.get();
    actions.clearQueuedActions();
    const before = world.client.sent.actions.length;
    miningResource.onStep!(mining, world);
    await actions.flushQueuedActions();
    return world.client.sent.actions
        .slice(before)
        .flatMap(({ actions: list }) => list ?? [])
        .map(({ actionRaw }) => actionRaw!.unitCommand!)
        .filter(({ unitTags }) => unitTags!.includes(worker.tag))
        .map(({ abilityId, targetUnitTag, targetWorldSpacePos, queueCommand }) => ({
            abilityId,
            ...(targetUnitTag && { target: targetUnitTag }),
            ...(targetWorldSpacePos && { pos: targetWorldSpacePos as Point2D }),
            ...(queueCommand && { queue: true }),
        }));
}

const mainThreat = (world: TestWorld, threat: boolean) =>
    spyOn(world.resources.get().intel, 'getMainThreat').mockReturnValue(
        threat ? ({ ground: [{}] } as unknown as BaseThreat) : undefined,
    );

describe('mining', () => {
    it('does nothing until enabled', async () => {
        const world = await createTestWorld('blueshift', { loop: 0 });
        const { events, roles } = world.resources.get();
        const reader = events.createReader();
        const before = roles.getTags(GATHERING).size;

        await stepTo(world, observation(world, 4));

        expect(events.read(reader).filter(({ name }) => name === 'commandResults')).toHaveLength(0);
        expect([roles.getTags(GATHERING).size, roles.getTags(BUILDING).size]).toEqual([before, 0]);
        expect(world.resources.get().mining.isEnabled()).toBe(false);
    });

    it('splits 2 onto the 4 closest patches and 1 onto the rest, then caps every patch at 2', async () => {
        const { world, step } = await miningWorld();

        const results = await step();
        expect([counts(world, CLOSE_PATCHES), counts(world, FAR_PATCHES)]).toEqual([
            [2, 2, 2, 2],
            [1, 1, 1, 1],
        ]);
        const targets = results
            .filter(({ owner, command }) => owner === MINING && command.abilityId === SMART)
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

    it('selects builders out of the bookkeeping, preferring unassigned gatherers unless forceClose, skipping excluded tags', async () => {
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
        expect(
            mining.selectWorker({ x: 9, y: 16 }, { role: GATHERING, exclude: new Set([builder.tag]) })!.tag,
        ).not.toBe(builder.tag);
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

    it('speed mines with MOVE + queued SMART inside the 0.75-2 window and the plain command outside it', async () => {
        const { world, step } = await miningWorld();
        await step();
        const { mining, units, map, pathing } = world.resources.get();
        const minerals = units.getMineralFields();
        const expected = mineralTargets(
            minerals.map(({ tag, pos }) => ({ tag, pos })),
            map.getExpansions().map(({ townhallPosition }) => townhallPosition),
        );
        expect(minerals.map(({ tag }) => mining.getMineralTarget(tag))).toEqual(
            minerals.map(({ tag }) => expected.get(tag)),
        );

        const patch = CLOSE_PATCHES[0];
        const mineral = units.getByTag(patch)!;
        const worker = units.getByTag(mining.getWorkersOn(patch)[0])!;
        const townhall = units.getByTag(mining.getAssignment(worker)!.townhallTag)!;
        const target = mining.getMineralTarget(patch)!;
        const gathering = { abilityId: HARVEST_GATHER, targetUnitTag: patch };
        const off = (from: Point2D, dx: number) => ({ x: from.x + dx, y: from.y });
        const at = (pos: Point2D, orders: SC2APIProtocol.UnitOrder[], carrying = false) => {
            worker.pos = { ...pos, z: worker.pos.z };
            worker.orders = orders;
            worker.buffIds = carrying ? [CARRYMINERALFIELDMINERALS] : [];
            return commandsFor(world, worker);
        };
        const returning = off(townhall.pos, 2.75 * 1.08 + 1.9);
        const far = off(mineral.pos, 8);

        expect(await at(off(target, 1.9), [gathering])).toEqual([
            { abilityId: MOVE, pos: target },
            { abilityId: SMART, target: patch, queue: true },
        ]);
        expect(await at(off(target, 0.7), [gathering])).toEqual([]);
        expect(await at(off(target, 2.1), [gathering])).toEqual([{ abilityId: MOVE, pos: target }]);
        expect(await at(off(target, 2.1), [gathering, gathering])).toEqual([]);
        expect(await at(off(target, 2.1), [{ abilityId: MOVE, targetWorldSpacePos: target }, gathering])).toEqual([]);
        expect(await at(off(target, 2.1), [{ abilityId: MOVE, targetWorldSpacePos: far }])).toEqual([]);
        expect(await at(off(target, 2.1), [{ abilityId: MOVE, targetUnitTag: townhall.tag }])).toEqual([
            { abilityId: SMART, target: patch },
        ]);
        expect(await at(off(target, 2.1), [{ abilityId: HARVEST_GATHER, targetUnitTag: CLOSE_PATCHES[1] }])).toEqual([
            { abilityId: SMART, target: patch },
        ]);
        expect(await at(returning, [{ abilityId: HARVEST_RETURN, targetUnitTag: townhall.tag }], true)).toEqual([
            { abilityId: MOVE, pos: townhallTarget(townhall.pos, returning) },
            { abilityId: SMART, target: townhall.tag, queue: true },
        ]);
        expect(await at(off(townhall.pos, 7), [], true)).toEqual([{ abilityId: SMART, target: townhall.tag }]);
        expect(
            await at(off(townhall.pos, 7), [{ abilityId: HARVEST_RETURN, targetUnitTag: townhall.tag }], true),
        ).toEqual([]);
        expect(await at(far, [])).toEqual([
            { abilityId: MOVE, pos: pathing.nextPoint(far, mineral.pos, { layer: 'ground' }) },
        ]);

        mining.configure({ speedMining: false });
        expect(await at(off(target, 1.9), [])).toEqual([{ abilityId: HARVEST_GATHER, target: patch }]);
    });

    it('flees on avoidance, on low health in danger, or above weightSafetyLimit', async () => {
        const { world, step } = await miningWorld();
        const { mining, units, influence, pathing } = world.resources.get();
        const flees = async (layer: 'ground' | 'groundAvoidance', weight: number, health = 45) => {
            await step();
            const worker = units.getByTag(mining.getWorkersOn(CLOSE_PATCHES[0])[0])!;
            worker.health = health;
            influence.addCost(layer, worker.pos, 1, weight);
            const spot = pathing.closestSafeSpot(worker.pos, { layer: 'ground' });
            return Bun.deepEquals(await commandsFor(world, worker), [{ abilityId: MOVE, pos: spot }]);
        };

        expect([
            await flees('groundAvoidance', 50),
            await flees('ground', 5),
            await flees('ground', 5, 20),
            await flees('ground', 20),
        ]).toEqual([true, false, true, true]);
    });

    it('self-defends only against a main ground threat, hitting the lowest-health enemy in range', async () => {
        const { world, step } = await miningWorld();
        await step();
        const { mining, units } = world.resources.get();
        const tag = mining.getWorkersOn(CLOSE_PATCHES[0])[0];
        const { x, y, z } = units.getByTag(tag)!.pos;
        const lings = [35, 10].map((health, i) =>
            rawUnit({
                alliance: Alliance.ENEMY,
                owner: 2,
                unitType: ZERGLING,
                pos: { x: x + (i ? 0.5 : -0.5), y, z },
                health,
                healthMax: 35,
            }),
        );
        const attacks = async (threat: boolean, weaponCooldown = 0) => {
            await step((all) => [...all, ...lings]);
            const worker = units.getByTag(tag)!;
            worker.orders = [];
            worker.weaponCooldown = weaponCooldown;
            mainThreat(world, threat);
            return (await commandsFor(world, worker)).filter(({ abilityId }) => abilityId === ATTACK);
        };

        expect(await attacks(true)).toEqual([{ abilityId: ATTACK, target: lings[1].tag }]);
        expect(await attacks(true, 5)).toEqual([]);
        expect(await attacks(false)).toEqual([]);
    });

    it('long-distance mines the safe unassigned field closest to the natural when local patches are full', async () => {
        const { world, step } = await miningWorld();
        const extra = extraWorkers(6);
        await step((all) => [...all, ...extra]);
        await step((all) => [...all, ...extra]);
        const { mining, units, map, influence, frame } = world.resources.get();
        const [spare] = extra.map(({ tag }) => units.getByTag(tag)!).filter((worker) => !mining.getAssignment(worker));
        const natural = map.getNatural().townhallPosition;
        const fields = units.getMineralFields().filter((mineral) => mining.getWorkersOn(mineral).length === 0);
        const costly = fields.closestTo(natural);
        influence.addCost('ground', mining.getMineralTarget(costly)!, 1, 50);
        const next = fields.filter((mineral) => mineral !== costly).closestTo(natural);
        const gathers = async (collectionRateMinerals: number) => {
            frame.getObservation().score = { scoreDetails: { collectionRateMinerals } };
            return commandsFor(world, spare);
        };

        expect([await gathers(299), await gathers(300)]).toEqual([
            [{ abilityId: HARVEST_GATHER, target: costly.tag }],
            [{ abilityId: HARVEST_GATHER, target: next.tag }],
        ]);
    });

    it('assigns new workers near the start before 300 s while intel reports a main ground threat', async () => {
        const world = await createTestWorld('blueshift', { loop: 0 });
        const { mining, map } = world.resources.get();
        mining.configure({ enabled: true });
        const natural = map.getNatural();
        const naturalPatches = natural.cluster.mineralFields.map(({ tag }) => tag);
        const atNatural = { ...natural.townhallPosition, z: 12 };
        await stepTo(world, observation(world, 4480));
        const added = [rawUnit({ unitType: COMMANDCENTER, pos: atNatural })];
        const assignedAt = async (loop: number, threat: boolean) => {
            const worker = rawUnit({ pos: atNatural });
            added.push(worker);
            mainThreat(world, threat);
            await stepTo(
                world,
                observation(world, loop, (all) => [
                    ...all.map((unit) =>
                        naturalPatches.includes(unit.tag!) ? { ...unit, displayType: DisplayType.VISIBLE } : unit,
                    ),
                    ...added,
                ]),
            );
            return naturalPatches.includes(mining.getAssignment(worker.tag)!.resourceTag) ? 'natural' : 'main';
        };

        expect([await assignedAt(4492, true), await assignedAt(4504, false), await assignedAt(6720, true)]).toEqual([
            'main',
            'natural',
            'natural',
        ]);
    });
});
