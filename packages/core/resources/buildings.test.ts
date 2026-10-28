import { describe, expect, it, spyOn } from 'bun:test';
import { Ability, UnitType } from '../constants/index.ts';
import { Alliance, Race } from '../constants/enums.ts';
import { SCANNERSWEEP } from '../constants/effect.ts';
import { BASE_DEFENDER, BUILDING, GATHERING, PERSISTENT_BUILDER } from '../constants/unit-role.ts';
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

type Step = {
    edits?: Record<string, Edit>;
    extra?: SC2APIProtocol.Unit[];
    dead?: string[];
    errors?: SC2APIProtocol.ActionError[];
    effects?: SC2APIProtocol.Effect[];
};

async function step(
    world: TestWorld,
    gameLoop: number,
    { edits = {}, extra = [], dead = [], errors = [], effects = [] }: Step = {},
) {
    const next = structuredClone(world.client.fixture.observations[896]);
    next.observation!.gameLoop = gameLoop;
    next.actionErrors = errors;
    const { rawData } = next.observation!;
    rawData!.units = rawData!.units!.flatMap((raw) => {
        const edit = edits[raw.tag!];
        if (edit === null || dead.includes(raw.tag!)) return [];
        return [edit ? { ...raw, ...edit } : raw];
    });
    rawData!.units.push(...extra);
    rawData!.effects = effects;
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
    it('returns undefined without a placement or a worker, releasing the spot it reserved; with mining off picks the closest worker no other role owns', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, placement, units, mining, roles } = world.resources.get();
        const spot = { x: 30, y: 30 };
        const request = spyOn(placement, 'request').mockReturnValue(spot);
        const release = spyOn(placement, 'release');
        spyOn(mining, 'selectWorker').mockReturnValue(undefined);
        spyOn(mining, 'isEnabled').mockReturnValue(true);
        expect(buildings.build(UnitType.SUPPLYDEPOT)).toBeUndefined();
        release.mockClear();
        spyOn(mining, 'isEnabled').mockReturnValue(false);
        const [persistent, defender, gatherer] = units
            .getWorkers()
            .filter((worker) => worker.tag !== BARRACKS_BUILDER)
            .closestNUnits(spot, 3);
        roles.assign(persistent, PERSISTENT_BUILDER);
        roles.assign(defender, BASE_DEFENDER);
        expect(buildings.build(UnitType.SUPPLYDEPOT)?.workerTag).toBe(gatherer.tag);
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
        const pending = () => [build.status, world.agent.alreadyPending(UnitType.SUPPLYDEPOT)];

        const moved = await step(world, 900);
        expect(moved).toEqual([expect.objectContaining({ abilityId: Ability.MOVE, tags: [worker] })]);
        expect([pending(), buildings.pending(UnitType.SUPPLYDEPOT)]).toEqual([['moving', 1], 1]);

        const queueAction = actions.queueAction.bind(actions);
        let mineralsAtBuild: number | undefined;
        spyOn(actions, 'queueAction').mockImplementation((commands, opts) => {
            if (!Array.isArray(commands) && commands.abilityId === Ability.BUILD_SUPPLYDEPOT)
                mineralsAtBuild = world.agent.minerals;
            queueAction(commands, opts);
        });
        const ordered = await step(world, 904, { edits: { [worker]: { ...at(target), orders: [] } } });
        expect(ordered).toEqual([{ abilityId: Ability.BUILD_SUPPLYDEPOT, tags: [worker], target }]);
        expect([pending(), units.getByTag(worker)!.labels.has('command'), mineralsAtBuild]).toEqual([
            ['ordered', 1],
            true,
            4815 - 100,
        ]);

        const building = [{ abilityId: Ability.BUILD_SUPPLYDEPOT, targetWorldSpacePos: target }];
        await step(world, 908, { edits: { [worker]: { ...at(target), orders: building } } });
        expect(pending()).toEqual(['ordered', 1]);

        const structure = depot(target);
        await step(world, 912, { edits: { [worker]: { ...at(target), orders: building } }, extra: [structure] });
        expect(pending()).toEqual(['constructing', 1]);

        await step(world, 916, { edits: { [worker]: { orders: [] } }, extra: [{ ...structure, buildProgress: 1 }] });
        expect([pending(), build.structureTag, roles.roleOf(worker), buildings.pending()]).toEqual([
            ['done', 0],
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

    it('never moves a build pinned with `at`: a blocked spot, maxAttempts rejected BUILDs or a stalled worker fail it blocked', async () => {
        for (const cause of ['unplaceable', 'rejected', 'stalled'] as const) {
            const world = await createTestWorld('blueshift', { loop: 896 });
            const { buildings, placement } = world.resources.get();
            buildings.configure({ maxAttempts: 1 });
            const spot = placement.request(UnitType.SUPPLYDEPOT, { flags: ['supplyDepot'] })!;
            placement.release(spot);
            const build = buildings.build(UnitType.SUPPLYDEPOT, { at: spot })!;
            const worker = build.workerTag!;
            const request = spyOn(placement, 'request');
            const stand = cause === 'stalled' ? {} : { edits: { [worker]: { ...at(spot), orders: [] } } };

            if (cause === 'unplaceable') {
                spyOn(placement, 'canPlace').mockReturnValue(false);
            } else if (cause === 'stalled') {
                await step(world, 900);
            } else {
                spyOn(world.client, 'action').mockImplementationOnce(async (req) => {
                    world.client.sent.actions.push(req);
                    return { result: (req.actions ?? []).map(() => 2 as SC2APIProtocol.ActionResult) };
                });
                await step(world, 900, stand);
            }
            await step(world, LATER, stand);

            expect([
                build.status,
                build.failure,
                build.target,
                request.mock.calls,
                placement.getPlacements({ state: 'reserved' }),
            ]).toEqual(['failed', 'blocked', spot, [], []]);
        }
    });

    it('replans a build whose moving worker stands still for 10 s with a new worker, then fails it blocked, keeping stalled workers off tracked and actions.build builds of that type for 60 s, mining on or off; a walking worker never stalls', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { actions, buildings, placement, units, mining, roles } = world.resources.get();
        const build = buildings.build(UnitType.SUPPLYDEPOT)!;
        const worker = build.workerTag!;
        const first = build.target;
        const { x, y } = units.getByTag(worker)!.pos;
        const standAt = (dx: number) => ({ edits: { [worker]: { pos: { x: x + dx, y, z: 12 }, orders: [] } } });
        const state = () => [build.status, build.failure, build.target === first];
        const reserved = () => placement.getPlacements({ state: 'reserved' }).map(({ pos }) => pos);

        await step(world, 900, standAt(0));
        await step(world, 1100, standAt(2));
        await step(world, 1300, standAt(4));
        expect(state()).toEqual(['moving', undefined, true]);

        await step(world, 1525, standAt(4));
        expect([...state(), reserved(), build.workerTag !== worker, roles.roleOf(worker)]).toEqual([
            'moving',
            undefined,
            false,
            [build.target],
            true,
            GATHERING,
        ]);
        const replacement = build.workerTag!;

        await step(world, 1530, standAt(4));
        await step(world, 1755, standAt(4));
        expect([...state(), reserved()]).toEqual(['failed', 'blocked', false, []]);

        const there = { at: { x: x + 4, y } };
        const builders = () => [UnitType.SUPPLYDEPOT, UnitType.BARRACKS].map((type) => buildings.build(type, there)!);
        const [depot, barracks] = builders();
        expect([depot.workerTag !== worker, barracks.workerTag]).toEqual([true, worker]);
        [depot, barracks].forEach((pinned) => buildings.cancel(pinned));
        spyOn(mining, 'isEnabled').mockReturnValue(true);
        const select = spyOn(mining, 'selectWorker').mockReturnValue(undefined);
        buildings.build(UnitType.SUPPLYDEPOT, there);
        const sentBefore = world.client.sent.actions.length;
        await actions.build(UnitType.SUPPLYDEPOT, there.at);
        await actions.flushQueuedActions();
        const built = world.client.sent.actions
            .slice(sentBefore)
            .flatMap((request) => request.actions!.map((action) => action.actionRaw!.unitCommand!))
            .find(({ abilityId }) => abilityId === Ability.BUILD_SUPPLYDEPOT)!.unitTags!;
        expect([
            select.mock.calls.map(([, opts]) => [worker, replacement].every((tag) => opts!.exclude!.has(tag))),
            built.includes(worker),
        ]).toEqual([[true, true], false]);
        select.mockRestore();
        spyOn(mining, 'isEnabled').mockReturnValue(false);
        await step(world, 1755 + 60 * 22.4, standAt(4));
        expect(buildings.build(UnitType.SUPPLYDEPOT, there)!.workerTag).toBe(worker);
    });

    it('keeps a caller-supplied worker through a stall replan and fails the build blocked on the second stall', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, roles, units } = world.resources.get();
        const supplied = units
            .getWorkers()
            .find((worker) => worker.tag !== BARRACKS_BUILDER && !worker.isCarryingResource())!;
        const build = buildings.build(UnitType.SUPPLYDEPOT, { worker: supplied })!;
        const first = build.target;
        const stand = { edits: { [supplied.tag]: { orders: [] } } };

        await step(world, 900, stand);
        await step(world, 1125, stand);
        const replanned = [build.status, build.target !== first, build.workerTag, roles.roleOf(supplied)];
        await step(world, 1130, stand);
        await step(world, 1355, stand);

        expect([replanned, [build.status, build.failure, build.workerTag]]).toEqual([
            ['moving', true, supplied.tag, BUILDING],
            ['failed', 'blocked', supplied.tag],
        ]);
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
        expect([buildings.pending(), world.agent.alreadyPending(UnitType.BARRACKS)]).toEqual([1, 1]);
    });

    it('retargets an unplaceable townhall to the next safe expansion, else fails blocked; counts a tracked refinery once; times out gas builds', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, units, map, pathing, placement } = world.resources.get();
        const [first, second, third] = map.getAvailableExpansions().map((expansion) => expansion.townhallPosition);
        spyOn(pathing, 'isPositionSafe').mockImplementation((point) => point !== first);
        const occupied = units.getByTag(BARRACKS)!.pos;
        const townhall = buildings.build(UnitType.COMMANDCENTER, { at: occupied })!;
        const gas = buildings.buildGas()!;
        expect(buildings.buildGas()).toBeUndefined();

        await step(world, 900, {
            extra: [rawUnit({ unitType: UnitType.REFINERY, ...at(gas.target), buildProgress: 0.2 })],
            dead: [REFINERY],
        });
        expect([gas.status, buildings.buildGas({ max: 2 })]).toEqual(['constructing', expect.anything()]);
        expect(townhall.target).toEqual(second);

        const canPlace = spyOn(placement, 'canPlace').mockImplementation(
            (_type, pos) => ![first, second].includes(pos),
        );
        await step(world, 902);
        expect(townhall.target).toEqual(third);
        canPlace.mockRestore();

        spyOn(map, 'getAvailableExpansions').mockReturnValue([]);
        const blocked = buildings.build(UnitType.COMMANDCENTER, { at: occupied })!;
        await step(world, 904);
        expect([blocked.status, blocked.failure]).toEqual(['failed', 'blocked']);

        await step(world, 896 + 121 * 22.4);
        expect([gas.status, gas.failure]).toEqual(['failed', 'timeout']);
    });

    it('picks the first expansion that is unblocked and safe, skipping enemies (not auto-turrets), own townhalls, destructibles and watchtowers within 5.5; checkSafe false skips only safety; a passing enemy neither blocks for good nor moves a build', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, map, pathing } = world.resources.get();
        const expansions = map.getAvailableExpansions();
        const [first, second, third, fourth, fifth, sixth] = expansions.map((expansion) => expansion.townhallPosition);
        expect(buildings.getNextExpansion()).toEqual(first);

        spyOn(pathing, 'isPositionSafe').mockImplementation((point) => point !== first);
        expect([buildings.getNextExpansion(), buildings.getNextExpansion({ checkSafe: false })]).toEqual([
            second,
            first,
        ]);

        const build = buildings.build(UnitType.COMMANDCENTER, { at: second })!;
        const near = (pos: Point2D) => ({ ...at({ x: pos.x + 3, y: pos.y }) });
        const neutral = (tag: string, unitType: number, pos: Point2D) =>
            rawUnit({ tag, unitType, alliance: Alliance.NEUTRAL, owner: 16, ...near(pos) });
        const zergling = rawUnit({
            tag: '9002',
            unitType: UnitType.ZERGLING,
            alliance: Alliance.ENEMY,
            ...near(second),
        });
        const others = [
            rawUnit({ tag: '9001', unitType: UnitType.AUTOTURRET, alliance: Alliance.ENEMY, ...near(sixth) }),
            rawUnit({ tag: '9003', unitType: UnitType.COMMANDCENTER, alliance: Alliance.SELF, ...near(third) }),
            neutral('9004', UnitType.DESTRUCTIBLEROCK6X6, fourth),
            neutral('9005', UnitType.XELNAGATOWER, fifth),
        ];
        spyOn(map, 'getAvailableExpansions').mockReturnValue(expansions);
        await step(world, 900, { extra: [zergling, ...others] });
        expect([
            [first, second, third, fourth, fifth].map((pos) => buildings.isExpansionBlocked(pos)),
            buildings.getNextExpansion(),
            buildings.getNextExpansion({ checkSafe: false }),
            build.target,
        ]).toEqual([[false, true, true, true, true], sixth, first, second]);

        await step(world, 904, { extra: others, dead: ['9002'] });
        expect([buildings.isExpansionBlocked(second), buildings.getNextExpansion(), build.target]).toEqual([
            false,
            sixth,
            second,
        ]);
        buildings.cancel(build);
        expect(buildings.getNextExpansion()).toEqual(second);
    });

    it('skips expansions with no ground path from the main', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, map } = world.resources.get();
        const expansions = map.getAvailableExpansions();
        const [first, second] = expansions.map((expansion) => expansion.townhallPosition);
        const island = Object.assign([], { length: 999 });
        spyOn(map, 'getAvailableExpansions').mockReturnValue([
            { ...expansions[0], pathFromMain: island },
            ...expansions.slice(1),
        ]);

        expect([buildings.getNextExpansion(), buildings.getNextExpansion({ checkSafe: false })]).toEqual([
            second,
            second,
        ]);
        expect(first).not.toEqual(second);
    });

    it('skips spots another active tracked townhall build targets, including when retargeting', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, map, placement } = world.resources.get();
        const [first, second, third] = map.getAvailableExpansions().map((expansion) => expansion.townhallPosition);

        const offset = buildings.build(UnitType.COMMANDCENTER, { at: { x: first.x + 2, y: first.y + 1 } })!;
        expect(buildings.getNextExpansion()).toEqual(second);
        buildings.cancel(offset);
        expect(buildings.getNextExpansion()).toEqual(first);

        const cancelled = buildings.build(UnitType.COMMANDCENTER, { at: buildings.getNextExpansion() })!;
        expect([cancelled.target, buildings.getNextExpansion()]).toEqual([first, second]);
        buildings.cancel(cancelled);
        expect(buildings.getNextExpansion()).toEqual(first);
        const moving = buildings.build(UnitType.COMMANDCENTER, { at: buildings.getNextExpansion() })!;

        const other = buildings.build(UnitType.COMMANDCENTER, { at: buildings.getNextExpansion() })!;
        expect([other.target, buildings.getNextExpansion()]).toEqual([second, third]);

        spyOn(placement, 'canPlace').mockImplementation((_type, pos) => pos.x !== first.x || pos.y !== first.y);
        await step(world, 900);
        expect([moving.target, other.target]).toEqual([third, second]);
    });

    it('blocks a townhall target when its worker gets CantBuildLocationInvalid and retargets, failing blocked with no spot left; a detector with no enemy near clears it, and a new game resets', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, map } = world.resources.get();
        const [first, second, third] = map.getAvailableExpansions().map((expansion) => expansion.townhallPosition);
        const build = buildings.build(UnitType.COMMANDCENTER, { at: first })!;
        const rejected = [{ unitTag: build.workerTag, result: 44 as SC2APIProtocol.ActionResult }];

        const ignored = [
            { unitTag: BARRACKS_BUILDER, result: 44 as SC2APIProtocol.ActionResult },
            { unitTag: build.workerTag, result: 3 as SC2APIProtocol.ActionResult },
        ];
        expect(build.workerTag).not.toBe(BARRACKS_BUILDER);
        await step(world, 898, { errors: ignored });
        expect([build.target, buildings.isExpansionBlocked(first)]).toEqual([first, false]);

        await step(world, 900, { errors: rejected });
        expect([build.target, buildings.isExpansionBlocked(first), buildings.getNextExpansion()]).toEqual([
            second,
            true,
            third,
        ]);

        const marine = rawUnit({
            tag: '9103',
            unitType: UnitType.MARINE,
            alliance: Alliance.SELF,
            ...at({ x: first.x + 5, y: first.y }),
        });
        await step(world, 902, { extra: [marine] });
        expect(buildings.isExpansionBlocked(first)).toBe(true);

        const scout = rawUnit({
            tag: '9101',
            unitType: UnitType.ZERGLING,
            alliance: Alliance.ENEMY,
            ...at({ x: first.x + 8, y: first.y }),
        });
        const raven = rawUnit({
            tag: '9102',
            unitType: UnitType.RAVEN,
            alliance: Alliance.SELF,
            ...at({ x: first.x + 5, y: first.y }),
        });
        const late = buildings.build(UnitType.COMMANDCENTER, { at: first })!;
        await step(world, 904, { extra: [scout, raven] });
        expect([buildings.isExpansionBlocked(first), late.target]).toEqual([true, third]);
        await step(world, 908, { extra: [raven], dead: ['9101'] });
        expect(buildings.isExpansionBlocked(first)).toBe(false);

        await step(world, 912, { extra: [raven], errors: rejected });
        expect(buildings.isExpansionBlocked(second)).toBe(true);
        spyOn(map, 'getAvailableExpansions').mockReturnValue([]);
        await step(world, 916, { errors: rejected });
        expect([build.status, build.failure]).toEqual(['failed', 'blocked']);

        const again = buildings.build(UnitType.COMMANDCENTER, { at: first })!;
        await step(world, 920, { errors: [{ ...rejected[0], unitTag: again.workerTag }] });
        expect(buildings.isExpansionBlocked(first)).toBe(true);

        const sweep = { effectId: SCANNERSWEEP, alliance: Alliance.SELF, pos: [{ x: first.x + 3, y: first.y }] };
        const enemySweep = { ...sweep, alliance: Alliance.ENEMY, pos: [{ x: first.x - 3, y: first.y }] };
        await step(world, 922, { effects: [enemySweep] });
        expect(buildings.isExpansionBlocked(first)).toBe(true);
        await step(world, 924, { effects: [sweep] });
        expect([first, second].map((pos) => buildings.isExpansionBlocked(pos))).toEqual([false, true]);

        world.resources.reset(world);
        expect(buildings.isExpansionBlocked(second)).toBe(false);
    });

    it('blocks a townhall target when SC2 rejects its BUILD command with CantBuildLocationInvalid, then retargets', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, map } = world.resources.get();
        const [first, second] = map.getAvailableExpansions().map((expansion) => expansion.townhallPosition);
        const build = buildings.build(UnitType.COMMANDCENTER, { at: first })!;
        const worker = build.workerTag!;
        const ACTION_ERROR = 44 as SC2APIProtocol.ActionResult;
        world.client.action = async (request) => ({ result: (request.actions ?? []).map(() => ACTION_ERROR) });

        await step(world, 900, { edits: { [worker]: { ...at(first), orders: [] } } });
        expect(buildings.isExpansionBlocked(first)).toBe(true);
        await step(world, 904);
        expect([build.target, buildings.isExpansionBlocked(first)]).toEqual([second, true]);
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

    it('fails a refinery blocked once SC2 rejects it maxAttempts times and keeps its geyser off buildGas and the enemy-gas retarget for 60 s, unless buildGas gets that geyser explicitly', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { buildings, units } = world.resources.get();
        const [nearest, other] = ['4327473153', '4319346689'];
        const freed = { [REFINERY]: null };
        await step(world, 897, { edits: freed });
        const gas = buildings.buildGas()!;
        expect(gas.geyserTag).toBe(nearest);
        const ACTION_ERROR = 3 as SC2APIProtocol.ActionResult;
        const action = world.client.action;
        world.client.action = async (request) => ({ result: (request.actions ?? []).map(() => ACTION_ERROR) });

        for (let loop = 900; loop < 900 + 4 * 12; loop += 4) {
            await step(world, loop, { edits: { ...freed, [gas.workerTag!]: { ...at(gas.target), orders: [] } } });
        }
        world.client.action = action;
        expect([gas.status, gas.failure]).toEqual(['failed', 'blocked']);

        const next = buildings.buildGas()!;
        expect(next.geyserTag).toBe(other);
        const enemyRefinery = rawUnit({
            alliance: Alliance.ENEMY,
            owner: 2,
            unitType: UnitType.REFINERY,
            ...at(next.target),
        });
        const enemyStep = {
            edits: { ...freed, [next.workerTag!]: { ...at(next.target), orders: [] } },
            extra: [enemyRefinery],
        };
        await step(world, 1000, enemyStep);
        expect([next.status, next.failure]).toEqual(['failed', 'blocked']);

        expect(buildings.buildGas({ max: 2 })).toBeUndefined();
        const explicit = buildings.buildGas({ geyser: units.getByTag(nearest)! })!;
        expect(explicit.geyserTag).toBe(nearest);
        buildings.cancel(explicit);

        await step(world, 900 + 60 * 22.4 + 100, { ...enemyStep, edits: freed });
        expect(buildings.buildGas()!.geyserTag).toBe(nearest);
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
