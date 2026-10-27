import { describe, expect, it, spyOn } from 'bun:test';
import { Ability, UnitType } from '../constants/index.ts';
import { Alliance, Race } from '../constants/enums.ts';
import { GATHERING } from '../constants/unit-role.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import { rawUnit } from '../test/factories.ts';
import { Units } from './units-collection.ts';
import type { Point2D } from '../types.ts';

const BARRACKS_BUILDER = '4344512513';
const LATER = Math.ceil(896 + 70 * 22.4);
const BARRACKS = '4350541825';
const REFINERY = '4351590401';

type Edit = Partial<SC2APIProtocol.Unit> | null;

type Step = { edits?: Record<string, Edit>; extra?: SC2APIProtocol.Unit[]; dead?: string[] };

async function step(world: TestWorld, gameLoop: number, { edits = {}, extra = [], dead = [] }: Step = {}) {
    const next = structuredClone(world.client.fixture.observations[896]);
    next.observation!.gameLoop = gameLoop;
    const { rawData } = next.observation!;
    rawData!.units = rawData!.units!.flatMap((raw) => {
        const edit = edits[raw.tag!];
        if (edit === null || dead.includes(raw.tag!)) return [];
        return [edit ? { ...raw, ...edit } : raw];
    });
    rawData!.units.push(...extra);
    if (dead.length > 0) rawData!.event = { deadUnits: dead };

    const before = world.client.sent.actions.length;
    await stepTo(world, next);
    return world.client.sent.actions
        .slice(before)
        .flatMap((request) => request.actions!.map((action) => action.actionRaw!.unitCommand!))
        .map(({ abilityId, unitTags, targetWorldSpacePos, targetUnitTag }) => ({
            abilityId,
            tags: unitTags,
            ...(targetWorldSpacePos && { target: { x: targetWorldSpacePos.x, y: targetWorldSpacePos.y } }),
            ...(targetUnitTag && { targetUnitTag }),
        }));
}

const at = (pos: Point2D) => ({ pos: { x: pos.x, y: pos.y, z: 12 } });

const depot = (pos: Point2D, overrides: SC2APIProtocol.Unit = {}) =>
    rawUnit({
        unitType: UnitType.SUPPLYDEPOT,
        ...at(pos),
        buildProgress: 0.5,
        health: 200,
        healthMax: 400,
        ...overrides,
    });

describe('building tracker', () => {
    it('returns undefined without a placement or a worker, releasing the spot it reserved', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, placement, units, mining } = world.resources.get();
        const spot = { x: 30, y: 30 };
        const request = spyOn(placement, 'request').mockReturnValue(spot);
        const release = spyOn(placement, 'release');
        spyOn(mining, 'selectWorker').mockReturnValue(undefined);
        spyOn(mining, 'isEnabled').mockReturnValue(true);
        expect(buildings.build(UnitType.SUPPLYDEPOT)).toBeUndefined();
        release.mockClear();
        spyOn(mining, 'isEnabled').mockReturnValue(false);
        expect(buildings.build(UnitType.SUPPLYDEPOT)).toBeDefined();
        release.mockClear();
        request.mockReturnValueOnce(undefined);
        spyOn(units, 'getMineralWorkers').mockReturnValue(new Units());
        spyOn(units, 'getWorkers').mockReturnValue(new Units());

        expect([buildings.build(UnitType.SUPPLYDEPOT), buildings.build(UnitType.SUPPLYDEPOT)]).toEqual([
            undefined,
            undefined,
        ]);
        expect(release.mock.calls).toEqual([[spot]]);
    });

    it('moves a far worker, orders BUILD in range, then tracks construction to done and releases the worker', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, roles, units, actions } = world.resources.get();
        const build = buildings.build(UnitType.SUPPLYDEPOT)!;
        const { workerTag, target } = build;
        const worker = workerTag!;

        const moved = await step(world, 900);
        expect(moved).toEqual([expect.objectContaining({ abilityId: Ability.MOVE, tags: [worker] })]);
        expect([build.status, buildings.pending(UnitType.SUPPLYDEPOT)]).toEqual(['moving', 1]);

        const queueAction = actions.queueAction.bind(actions);
        let mineralsAtBuild: number | undefined;
        spyOn(actions, 'queueAction').mockImplementation((commands, opts) => {
            if (!Array.isArray(commands) && commands.abilityId === Ability.BUILD_SUPPLYDEPOT)
                mineralsAtBuild = world.agent.minerals;
            queueAction(commands, opts);
        });
        const ordered = await step(world, 904, { edits: { [worker]: { ...at(target), orders: [] } } });
        expect(ordered).toEqual([{ abilityId: Ability.BUILD_SUPPLYDEPOT, tags: [worker], target }]);
        expect([build.status, units.getByTag(worker)!.labels.has('command'), mineralsAtBuild]).toEqual([
            'ordered',
            true,
            4815 - 100,
        ]);

        const building = [{ abilityId: Ability.BUILD_SUPPLYDEPOT, targetWorldSpacePos: target }];
        await step(world, 908, { edits: { [worker]: { ...at(target), orders: building } } });
        expect(build.status).toBe('ordered');

        const structure = depot(target);
        await step(world, 912, { edits: { [worker]: { ...at(target), orders: building } }, extra: [structure] });
        expect(build.status).toBe('constructing');

        await step(world, 916, { edits: { [worker]: { orders: [] } }, extra: [{ ...structure, buildProgress: 1 }] });
        expect([build.status, build.structureTag, roles.roleOf(worker), buildings.pending()]).toEqual([
            'done',
            structure.tag,
            GATHERING,
            0,
        ]);
        expect(buildings.getTracked()).toEqual([build]);
        await step(world, 920, { extra: [{ ...structure, buildProgress: 1 }] });
        expect(buildings.getTracked()).toEqual([]);
    });

    it('keeps an earmark and the reserved spot while waiting on money or tech and through rejected or outranked BUILDs, settling it on send', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, actions, units, placement } = world.resources.get();
        buildings.configure({ maxAttempts: 2 });
        world.data.addEarmark({ name: 'depot', minerals: 100, vespene: 0 });
        world.data.addEarmark({ name: 'saving', minerals: 4800, vespene: 0 });
        const placementRequest = { flags: ['supplyDepot' as const] };
        const build = buildings.build(UnitType.SUPPLYDEPOT, { earmark: 'depot', placement: placementRequest })!;
        const worker = build.workerTag!;
        const first = build.target;
        const inRange = () => ({ edits: { [worker]: { ...at(build.target), orders: [] } } });
        const earmarked = () =>
            world.data.get('earmarks').some((earmark: { name: string }) => earmark.name === 'depot');
        const reject = () =>
            spyOn(world.client, 'action').mockImplementationOnce(async (request) => {
                world.client.sent.actions.push(request);
                return { result: (request.actions ?? []).map(() => 2 as SC2APIProtocol.ActionResult) };
            });

        const reserved = () =>
            placement.getPlacements({ state: 'reserved' }).some(({ pos }) => pos.x === first.x && pos.y === first.y);
        expect(await step(world, 900, inRange())).toEqual([]);
        expect([await step(world, LATER, inRange()), reserved()]).toEqual([[], true]);
        world.data.settleEarmark('saving');
        const tech = spyOn(world.agent, 'techRequirementProgress').mockReturnValueOnce(0.5);
        expect([await step(world, LATER + 2, inRange()), earmarked()]).toEqual([[], true]);
        tech.mockRestore();

        actions.as({ owner: 'bot', priority: 50 }, () =>
            actions.queueAction({ abilityId: Ability.STOP, unitTags: [worker] }),
        );
        await step(world, LATER + 4, inRange());
        expect([build.status, build.attempts, units.getByTag(worker)!.labels.has('command'), earmarked()]).toEqual([
            'moving',
            1,
            false,
            true,
        ]);

        reject();
        const request = spyOn(placement, 'request');
        expect(await step(world, LATER + 8, inRange())).toEqual([
            { abilityId: Ability.BUILD_SUPPLYDEPOT, tags: [worker], target: first },
        ]);
        expect([build.attempts, build.target === first, earmarked(), request.mock.calls]).toEqual([
            0,
            false,
            true,
            [[UnitType.SUPPLYDEPOT, placementRequest]],
        ]);

        await step(world, LATER + 12, inRange());
        expect([build.status, earmarked()]).toEqual(['ordered', false]);
    });

    it('never moves a build pinned with `at`: a blocked spot or maxAttempts rejected BUILDs fail it blocked', async () => {
        for (const cause of ['unplaceable', 'rejected'] as const) {
            const world = await createTestWorld('blueshift', { loop: 896 });
            const { buildings, placement } = world.resources.get();
            buildings.configure({ maxAttempts: 1 });
            const spot = placement.request(UnitType.SUPPLYDEPOT, { flags: ['supplyDepot'] })!;
            placement.release(spot);
            const build = buildings.build(UnitType.SUPPLYDEPOT, { at: spot })!;
            const worker = build.workerTag!;
            const request = spyOn(placement, 'request');
            const inRange = { edits: { [worker]: { ...at(spot), orders: [] } } };

            if (cause === 'unplaceable') {
                spyOn(placement, 'canPlace').mockReturnValue(false);
            } else {
                spyOn(world.client, 'action').mockImplementationOnce(async (req) => {
                    world.client.sent.actions.push(req);
                    return { result: (req.actions ?? []).map(() => 2 as SC2APIProtocol.ActionResult) };
                });
                await step(world, 900, inRange);
            }
            await step(world, LATER, inRange);

            expect([
                build.status,
                build.failure,
                build.target,
                request.mock.calls,
                placement.getPlacements({ state: 'reserved' }),
            ]).toEqual(['failed', 'blocked', spot, [], []]);
        }
    });

    it('replaces a dead worker and fails noWorker when nobody is left', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, units } = world.resources.get();
        const build = buildings.build(UnitType.SUPPLYDEPOT)!;
        const first = build.workerTag!;

        await step(world, 900, { dead: [first] });
        const second = build.workerTag!;
        expect([second !== first, build.status]).toEqual([true, 'moving']);

        spyOn(units, 'getMineralWorkers').mockReturnValue(new Units());
        spyOn(units, 'getWorkers').mockReturnValue(new Units());
        await step(world, 904, { dead: [first, second] });
        expect([build.status, build.failure]).toEqual(['failed', 'noWorker']);
    });

    it('resumes an unfinished Terran structure without a builder, untracked ones only once the bot uses the tracker', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings } = world.resources.get();
        const untouched = await step(world, 898, { edits: { [BARRACKS_BUILDER]: { orders: [] } } });
        expect(untouched.filter((command) => command.abilityId === Ability.SMART)).toEqual([]);

        const build = buildings.build(UnitType.SUPPLYDEPOT)!;
        const worker = build.workerTag!;
        const tracked = depot(build.target);

        const resumed = await step(world, 900, {
            edits: { [worker]: { orders: [] }, [BARRACKS_BUILDER]: { orders: [] } },
            extra: [tracked],
        });

        expect(resumed).toEqual(
            expect.arrayContaining([
                { abilityId: Ability.SMART, tags: [worker], targetUnitTag: tracked.tag },
                expect.objectContaining({ abilityId: Ability.SMART, targetUnitTag: '4352638978' }),
            ]),
        );
        expect(buildings.pending()).toBe(1);
    });

    it('retargets a blocked townhall to a free expansion, else fails blocked; counts a tracked refinery once; times out gas builds', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, units, map } = world.resources.get();
        const occupied = units.getByTag(BARRACKS)!.pos;
        const townhall = buildings.build(UnitType.COMMANDCENTER, { at: occupied })!;
        const gas = buildings.buildGas()!;
        expect(buildings.buildGas()).toBeUndefined();

        await step(world, 900, {
            extra: [rawUnit({ unitType: UnitType.REFINERY, ...at(gas.target), buildProgress: 0.2 })],
            dead: [REFINERY],
        });
        expect([gas.status, buildings.buildGas({ max: 2 })]).toEqual(['constructing', expect.anything()]);
        expect(map.getAvailableExpansions().map((expansion) => expansion.townhallPosition)).toContainEqual(
            townhall.target,
        );

        spyOn(map, 'getAvailableExpansions').mockReturnValue([]);
        const blocked = buildings.build(UnitType.COMMANDCENTER, { at: occupied })!;
        await step(world, 904);
        expect([blocked.status, blocked.failure]).toEqual(['failed', 'blocked']);

        await step(world, 896 + 121 * 22.4);
        expect([gas.status, gas.failure]).toEqual(['failed', 'timeout']);
    });

    it('retargets gas away from an enemy gas building on the target geyser', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings } = world.resources.get();
        const gas = buildings.buildGas()!;
        const [geyser, target] = [gas.geyserTag, gas.target];
        const enemyRefinery = rawUnit({
            alliance: Alliance.ENEMY,
            owner: 2,
            unitType: UnitType.REFINERY,
            ...at(target),
        });

        await step(world, 900, {
            edits: { [gas.workerTag!]: { ...at(target), orders: [] } },
            extra: [enemyRefinery],
            dead: [REFINERY],
        });

        expect([gas.status, gas.geyserTag !== geyser]).toEqual(['moving', true]);
    });

    it('cancels a damaged unfinished structure below max(50, 9%) per cancelLowHp, never a creep tumour', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings } = world.resources.get();
        const build = buildings.build(UnitType.SUPPLYDEPOT)!;
        const tracked = depot(build.target, { health: 100 });
        const untracked = depot({ x: 40, y: 40 }, { health: 100 });
        const tumour = rawUnit({
            unitType: UnitType.CREEPTUMORBURROWED,
            ...at({ x: 44, y: 44 }),
            buildProgress: 0.5,
            health: 40,
            healthMax: 50,
        });
        const extra = (health: number) =>
            [tracked, untracked, tumour].map((unit) => ({ ...unit, health: unit === tumour ? 10 : health }));
        const cancels = (commands: { abilityId?: number; tags?: string[] }[]) =>
            commands
                .filter((command) => command.abilityId === Ability.CANCEL_BUILDINPROGRESS)
                .flatMap((command) => command.tags);

        await step(world, 900, { extra: [tracked, untracked, { ...tumour, health: 40 }] });
        expect(cancels(await step(world, 904, { extra: extra(40) }))).toEqual([tracked.tag]);
        expect([build.status, build.failure]).toEqual(['failed', 'cancelled']);

        buildings.configure({ cancelLowHp: 'all' });
        const fresh = depot({ x: 50, y: 40 }, { health: 30 });
        expect(cancels(await step(world, 908, { extra: [...extra(100), fresh] }))).toEqual([]);
        expect(cancels(await step(world, 912, { extra: extra(40) }))).toEqual([tracked.tag, untracked.tag]);

        buildings.configure({ cancelLowHp: 'off' });
        await step(world, 916, { extra: extra(100) });
        expect(cancels(await step(world, 920, { extra: extra(40) }))).toEqual([]);
    });

    it('keeps a consumed Protoss/Zerg builder, marks the build done at first progress, still cancels them on low HP, and times them out', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, roles, units } = world.resources.get();
        world.agent.race = Race.PROTOSS;
        const [first, second] = units.getByTag(['4345823233', '4343463937']);
        const pylon = buildings.build(UnitType.PYLON, { at: { x: 30, y: 30 }, worker: first })!;
        const gateway = buildings.build(UnitType.GATEWAY, { at: { x: 40.5, y: 40.5 }, worker: second })!;
        const structure = rawUnit({
            unitType: UnitType.PYLON,
            ...at(pylon.target),
            buildProgress: 0.05,
            health: 200,
            healthMax: 200,
        });

        await step(world, 900, { extra: [{ ...structure, buildProgress: 0 }], dead: [first.tag!] });
        expect([pylon.status, pylon.workerTag]).toEqual(['constructing', first.tag]);

        await step(world, 902, { extra: [structure] });
        expect([pylon.status, pylon.structureTag]).toEqual(['done', structure.tag]);

        const cancelled = await step(world, 904, { extra: [{ ...structure, health: 40 }] });
        expect(cancelled).toContainEqual({ abilityId: Ability.CANCEL_BUILDINPROGRESS, tags: [structure.tag] });

        await step(world, Math.ceil(896 + 121 * 22.4), { extra: [{ ...structure, health: 40 }] });
        expect([gateway.status, gateway.failure, roles.roleOf(gateway.workerTag!)]).toEqual([
            'failed',
            'timeout',
            GATHERING,
        ]);
    });
});
