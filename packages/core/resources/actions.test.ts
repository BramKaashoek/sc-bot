import { describe, expect, it, spyOn } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { Ability, UnitType, WarpUnitAbility } from '../constants/index.ts';
import { ActionManagerError, GatherError } from '../engine/errors.ts';
import { createTestWorld, loadFixture, stepTo } from '../test/create-test-world.ts';
import { rawUnit, toyFixture } from '../test/factories.ts';
import type { TestWorld } from '../test/create-test-world.ts';

const CHAT_BROADCAST = 1 as SC2APIProtocol.ActionChat_Channel;
const CHAT_TEAM = 2 as SC2APIProtocol.ActionChat_Channel;

const unitCommand = (command: SC2APIProtocol.ActionRawUnitCommand): SC2APIProtocol.RequestAction => ({
    actions: [{ actionRaw: { unitCommand: command } }],
});

describe('ActionManager', () => {
    it('sends stop, hold position, repair, return cargo, generic ability and attack-move commands, ignoring non-object targets and empty unit lists, rejecting attacks without a target and raw commands without units', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { actions, map, units } = world.resources.get();
        const [marine, scv] = units.getByTag(['4354211841', '4344512513']);
        const depot = units.getByTag('4351328257')!;

        await actions.stop([marine]);
        await actions.holdPosition([marine], true);
        await actions.repair([scv], depot, true);
        await actions.returnResource([scv]);
        await marine.useAbility(Ability.EFFECT_STIM, { queue: true });
        await scv.useAbility(Ability.MOVE, { target: { x: 20, y: 20 } });
        await actions.do(Ability.ATTACK_ATTACK, marine.tag!, { target: depot, queue: true });
        await actions.move([marine], { x: 0, y: 7 });
        await actions.smart([scv], { x: 0, y: 0 });
        await actions.do(Ability.MOVE, marine.tag!, { target: depot.tag as never });
        await actions.build(UnitType.SUPPLYDEPOT, { x: 0, y: 7 }, scv);

        await actions.flushQueuedActions();

        expect(world.client.sent.actions.at(-1)!.actions!.map((action) => action.actionRaw!.unitCommand)).toEqual([
            { abilityId: Ability.STOP, unitTags: [marine.tag!], queueCommand: false },
            { abilityId: Ability.HOLDPOSITION, unitTags: [marine.tag!], queueCommand: true },
            {
                abilityId: Ability.EFFECT_REPAIR,
                unitTags: [scv.tag!],
                targetUnitTag: depot.tag,
                queueCommand: true,
            },
            { abilityId: Ability.HARVEST_RETURN, unitTags: [scv.tag!], queueCommand: false },
            { abilityId: Ability.EFFECT_STIM, unitTags: [marine.tag!], queueCommand: true },
            {
                abilityId: Ability.MOVE,
                unitTags: [scv.tag!],
                targetWorldSpacePos: { x: 20, y: 20 },
                queueCommand: false,
            },
            {
                abilityId: Ability.ATTACK_ATTACK,
                unitTags: [marine.tag!],
                targetUnitTag: depot.tag,
                queueCommand: true,
            },
            {
                abilityId: Ability.MOVE,
                unitTags: [marine.tag!],
                queueCommand: false,
                targetWorldSpacePos: { x: 0, y: 7 },
            },
            {
                abilityId: Ability.SMART,
                unitTags: [scv.tag!],
                queueCommand: false,
                targetWorldSpacePos: { x: 0, y: 0 },
            },
            { abilityId: Ability.MOVE, unitTags: [marine.tag!], queueCommand: false },
            {
                abilityId: Ability.BUILD_SUPPLYDEPOT,
                unitTags: [scv.tag!],
                queueCommand: false,
                targetWorldSpacePos: { x: 0, y: 7 },
            },
        ]);

        const sentBefore = world.client.sent.actions.length;
        await actions.do(Ability.STOP, []);
        await actions.attackMove([], { x: 10, y: 10 });
        await expect(actions.attack([marine])).rejects.toBeInstanceOf(ActionManagerError);
        expect(() => actions.queueAction({ abilityId: Ability.STOP })).toThrow(ActionManagerError);
        map.setLocations({ enemy: [] });
        await expect(actions.attackMove([marine])).rejects.toBeInstanceOf(ActionManagerError);
        await actions.flushQueuedActions();
        expect(world.client.sent.actions.length).toBe(sentBefore);
    });

    it('rejects gather without a mineral field when no own base is complete', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const withoutBase = structuredClone(world.client.fixture.observations[896]);
        withoutBase.observation!.gameLoop = 900;
        withoutBase.observation!.rawData!.units!.find(
            (unit) => unit.unitType === UnitType.COMMANDCENTER,
        )!.buildProgress = 0.5;
        await stepTo(world, withoutBase);
        const { actions, units } = world.resources.get();

        await expect(actions.gather(units.getByTag('4344512513')!)).rejects.toBeInstanceOf(GatherError);
    });

    it('warps in from each warp gate at a distinct free point of a power field, rejecting when no point is free', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const warpGates = [30.5, 33.5].map((x) =>
            rawUnit({
                unitType: UnitType.WARPGATE,
                pos: { x, y: 30.5, z: 12 },
                health: 500,
                healthMax: 500,
            }),
        );
        const withWarpGates = structuredClone(world.client.fixture.observations[896]);
        withWarpGates.observation!.gameLoop = 900;
        withWarpGates.observation!.rawData!.units!.push(...warpGates);
        await stepTo(world, withWarpGates);
        const { actions, units } = world.resources.get();
        const canWarpZealots = () =>
            warpGates.forEach((warpGate) => {
                units.getByTag(warpGate.tag!)!._availableAbilities = [WarpUnitAbility[UnitType.ZEALOT]];
            });
        canWarpZealots();
        const sentBefore = world.client.sent.actions.length;

        await expect(actions.warpIn(UnitType.ZEALOT, { nearPosition: { x: 30, y: 30 } })).rejects.toBeInstanceOf(
            ActionManagerError,
        );
        expect(world.client.sent.actions.length).toBe(sentBefore);

        const powered = structuredClone(withWarpGates);
        powered.observation!.rawData!.player!.powerSources = [{ pos: { x: 26, y: 26, z: 12 }, radius: 2, tag: '1' }];
        await stepTo(world, powered);
        canWarpZealots();
        const random = spyOn(Math, 'random').mockReturnValue(0);
        try {
            await actions.warpIn(UnitType.ZEALOT, { nearPosition: { x: 26, y: 26 }, maxQty: 2 });
        } finally {
            random.mockRestore();
        }
        await actions.flushQueuedActions();

        expect(world.client.sent.actions.slice(sentBefore)).toEqual([
            {
                actions: [
                    { unitTags: [warpGates[0].tag!], targetWorldSpacePos: { x: 25, y: 26 } },
                    { unitTags: [warpGates[1].tag!], targetWorldSpacePos: { x: 26, y: 25 } },
                ].map((command) => ({
                    actionRaw: { unitCommand: { abilityId: Ability.TRAINWARP_ZEALOT, ...command } },
                })),
            },
        ]);
    });

    it('swapBuildings sends nothing itself and leaves the lifts to the flying resource on the next dispatch', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { actions, units, flying } = world.resources.get();
        const [barracks, commandCenter] = units.getByTag(['4350541825', '4342677505']);
        const sentBefore = world.client.sent.actions.length;

        await expect(actions.swapBuildings(barracks, commandCenter)).resolves.toBeUndefined();
        expect(world.client.sent.actions.length).toBe(sentBefore);
        expect(flying.getPlans().map((plan) => [plan.tag, plan.destination])).toEqual([
            [barracks.tag, { x: commandCenter.pos.x, y: commandCenter.pos.y }],
            [commandCenter.tag, { x: barracks.pos.x, y: barracks.pos.y }],
        ]);

        const next = structuredClone(world.client.fixture.observations[896]);
        next.observation!.gameLoop = 900;
        await stepTo(world, next);
        expect(world.client.sent.actions.slice(sentBefore)).toEqual([
            unitCommand({
                abilityId: Ability.LIFT,
                unitTags: [barracks.tag!, commandCenter.tag!],
                queueCommand: false,
            }),
        ]);
    });

    it('batches queued commands into one request after the step, dropping repeats of current orders, and the whole batch if its request fails, forgetting ordered units on a new observation of the same loop', async () => {
        const mineral = '4332453889';
        const [first, second, mover] = ['4343988225', '4344250369', '4344512513'];
        const moving = { x: 25, y: 25 };
        const fixture = loadFixture('blueshift');
        fixture.observations[0].observation!.rawData!.units!.find((unit) => unit.tag === mover)!.orders = [
            { abilityId: Ability.GENERAL_MOVE, targetWorldSpacePos: moving },
        ];
        const moveTogether = {
            abilityId: Ability.MOVE,
            unitTags: [mover, second],
            targetWorldSpacePos: moving,
            queueCommand: false,
        };
        const moveBeside = {
            abilityId: Ability.MOVE,
            unitTags: [mover],
            targetWorldSpacePos: { x: 25, y: 26 },
            queueCommand: false,
        };
        const gatherAgain = {
            abilityId: Ability.HARVEST_GATHER,
            unitTags: [first],
            targetUnitTag: mineral,
            queueCommand: false,
        };
        const gatherQueued = { ...gatherAgain, queueCommand: true };
        const gatherElsewhere = {
            abilityId: Ability.HARVEST_GATHER,
            unitTags: [second],
            targetUnitTag: '4313317377',
            queueCommand: false,
        };
        const moveAway = {
            abilityId: Ability.MOVE,
            unitTags: [second],
            targetWorldSpacePos: { x: 20, y: 20 },
            queueCommand: false,
        };
        let world: TestWorld | undefined;
        let queueing = true;
        let sentDuringStep = -1;
        const agent = createAgent({
            async onStep() {
                if (!world || !queueing) return;
                const { actions } = world.resources.get();
                actions.queueAction(gatherAgain);
                actions.queueAction([gatherQueued, gatherElsewhere]);
                actions.queueAction(moveAway);
                actions.queueAction([moveTogether, moveBeside]);
                sentDuringStep = world.client.sent.actions.length;
            },
        });
        world = await createTestWorld(fixture, { loop: 0, agent });
        const { client } = world;
        const sentBefore = client.sent.actions.length;

        await stepTo(world, 0);

        expect(sentDuringStep).toBe(sentBefore);
        expect(client.sent.actions.slice(sentBefore)).toEqual([
            {
                actions: [
                    gatherQueued,
                    gatherElsewhere,
                    moveAway,
                    { ...moveTogether, unitTags: [second] },
                    moveBeside,
                ].map((command) => ({ actionRaw: { unitCommand: command } })),
            },
        ]);

        const send = client.action;
        client.action = async () => {
            throw new Error('rejected by the engine');
        };
        await expect(stepTo(world, 0)).resolves.toBeUndefined();
        client.action = send;
        queueing = false;
        const sentAfterFailure = client.sent.actions.length;
        await stepTo(world, 0);

        expect(client.sent.actions.length).toBe(sentAfterFailure);
        const { actions } = world.resources.get();
        expect(actions.unitTagsReceivedAction()).toEqual(new Set([first, second, mover]));
        await stepTo(world, structuredClone(fixture.observations[0]));
        expect(actions.unitTagsReceivedAction()).toEqual(new Set());
    });

    it('sends chat, autocast toggles and surrender outside of unit commands', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { actions, units } = world.resources.get();
        const marines = units.getById(UnitType.MARINE);

        await actions.chatSend('glhf');
        await actions.chatSend('rax first', true);
        await actions.toggleAutocast(marines, Ability.EFFECT_STIM);
        await actions.surrender();

        expect(world.client.sent.actions.slice(-3)).toEqual([
            { actions: [{ actionChat: { channel: CHAT_BROADCAST, message: 'glhf' } }] },
            { actions: [{ actionChat: { channel: CHAT_TEAM, message: 'rax first' } }] },
            {
                actions: [
                    {
                        actionRaw: {
                            toggleAutocast: {
                                abilityId: Ability.EFFECT_STIM,
                                unitTags: marines.map((marine) => marine.tag!),
                            },
                        },
                    },
                ],
            },
        ]);
        expect(world.client.sent.leaveGame).toEqual([{}]);
    });

    it('finds the nearest placement the engine accepts, requiring add-on room when asked, and by default a random spot on the first 2-cell ring within 20', async () => {
        const world = await createTestWorld('blueshift', { loop: 0 });
        const { actions } = world.resources.get();
        const options = { placementStep: 3, randomAlternative: false };

        expect(await actions.findPlacement(UnitType.BARRACKS, { x: 9.5, y: 12.5 }, options)).toEqual({
            x: 6.5,
            y: 12.5,
        });
        expect(
            await actions.findPlacement(UnitType.BARRACKS, { x: 9.5, y: 12.5 }, { ...options, addonPlace: true }),
        ).toEqual({ x: 6.5, y: 9.5 });
        expect(
            await actions.findPlacement(UnitType.BARRACKS, { x: 21.5, y: 15.5 }, { ...options, addonPlace: true }),
        ).toEqual({ x: 21.5, y: 15.5 });

        const toyWorld = await createTestWorld(toyFixture(), {
            onQuery: (query) =>
                query.placements?.length
                    ? {
                          placements: query.placements.map(({ targetPos }) => ({
                              result: targetPos!.y === 18 ? 1 : 44,
                          })),
                      }
                    : undefined,
        });
        const depotAt = (x: number, y: number) => ({ abilityId: Ability.BUILD_SUPPLYDEPOT, targetPos: { x, y } });
        const randomSpy = spyOn(Math, 'random').mockReturnValue(0);
        try {
            expect(
                await toyWorld.resources.get().actions.findPlacement(UnitType.SUPPLYDEPOT, { x: 16, y: 16 }),
            ).toEqual({ x: 14, y: 18 });
            expect(await toyWorld.resources.get().actions.findPlacement(UnitType.SUPPLYDEPOT, { x: 16, y: 40 })).toBe(
                false,
            );
        } finally {
            randomSpy.mockRestore();
        }
        const [nearQuery, firstRing, ...fartherQueries] = toyWorld.client.sent.queries.filter(
            (query) => query.placements?.length,
        );
        expect([nearQuery, firstRing]).toEqual([
            { placements: [depotAt(16, 16)] },
            {
                placements: [
                    depotAt(14, 14),
                    depotAt(14, 18),
                    depotAt(14, 14),
                    depotAt(18, 14),
                    depotAt(16, 14),
                    depotAt(16, 18),
                    depotAt(14, 16),
                    depotAt(18, 16),
                    depotAt(18, 14),
                    depotAt(18, 18),
                    depotAt(14, 18),
                    depotAt(18, 18),
                ],
            },
        ]);
        expect(fartherQueries.map(({ placements }) => placements![0].targetPos)).toEqual([
            { x: 16, y: 40 },
            ...[2, 4, 6, 8, 10, 12, 14, 16, 18].map((ring) => ({ x: 16 - ring, y: 40 - ring })),
        ]);
    });
});
