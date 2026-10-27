import { describe, expect, it, spyOn } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { Ability, Buff, UnitType, Upgrade, WarpUnitAbility } from '../constants/index.ts';
import { Race } from '../constants/enums.ts';
import { GATHERING, PERSISTENT_BUILDER } from '../constants/unit-role.ts';
import { ActionManagerError, GatherError, TrainError } from '../engine/errors.ts';
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

    it('builds with the worker mining selects only when mining is enabled, else the closest worker no other role owns, returning its cargo first', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { actions, mining, roles, units } = world.resources.get();
        const pos = { x: 30, y: 30 };
        const [reserved, closest] = units.getWorkers().closestNUnits(pos, 2);
        roles.assign(reserved, PERSISTENT_BUILDER);
        closest.buffIds = [Buff.CARRYMINERALFIELDMINERALS];
        const worker = units.getWorkers().find((scv) => scv.tag !== closest.tag)!;
        const select = spyOn(mining, 'selectWorker').mockReturnValue(worker);
        const sent = async () => {
            const before = world.client.sent.actions.length;
            await actions.build(UnitType.SUPPLYDEPOT, pos);
            await actions.flushQueuedActions();
            return world.client.sent.actions
                .slice(before)
                .flatMap((request) => request.actions!.map((action) => action.actionRaw!.unitCommand!))
                .map(({ abilityId, unitTags, queueCommand }) => ({ abilityId, unitTags, queueCommand }));
        };

        expect(await sent()).toEqual([
            { abilityId: Ability.HARVEST_RETURN, unitTags: [closest.tag], queueCommand: false },
            { abilityId: Ability.BUILD_SUPPLYDEPOT, unitTags: [closest.tag], queueCommand: true },
        ]);
        mining.configure({ enabled: true });
        expect(await sent()).toEqual([
            { abilityId: Ability.BUILD_SUPPLYDEPOT, unitTags: [worker.tag], queueCommand: false },
        ]);
        expect(select.mock.calls).toEqual([[pos, expect.objectContaining({ forceClose: true, role: GATHERING })]]);
    });

    it('queues a protoss build on the closest constructing probe within 20 that no other role owns', async () => {
        const fixture = loadFixture('blueshift-protoss');
        const raw = fixture.observations[896].observation!.rawData!.units!;
        const [first, second] = raw
            .filter((unit) => unit.unitType === UnitType.PROBE)
            .sort((a, b) => Math.hypot(a.pos!.x! - 30, a.pos!.y! - 30) - Math.hypot(b.pos!.x! - 30, b.pos!.y! - 30));
        [first, second].forEach((probe) => {
            probe.orders = [{ abilityId: Ability.BUILD_PYLON, targetWorldSpacePos: { x: 30, y: 30 } }];
        });
        const world = await createTestWorld(fixture, {
            loop: 896,
            agent: createAgent({ settings: { race: Race.PROTOSS } }),
        });
        const { actions, roles } = world.resources.get();
        const sentBefore = world.client.sent.actions.length;

        await actions.build(UnitType.PYLON, { x: 30, y: 30 });
        roles.assign(first.tag!, PERSISTENT_BUILDER);
        await actions.build(UnitType.PYLON, { x: 30, y: 30 });
        await actions.flushQueuedActions();

        expect(
            world.client.sent.actions
                .slice(sentBefore)
                .flatMap((request) => request.actions!.map((action) => action.actionRaw!.unitCommand!))
                .map(({ unitTags, queueCommand }) => ({ unitTags, queueCommand })),
        ).toEqual([{ unitTags: [first.tag!, second.tag!], queueCommand: true }]);
    });

    it('charges net cost like agent.train: 100 for a depot, 150 (not 550) for an orbital morph, 100/100 for an upgrade, rejecting an upgrade it cannot afford', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const withTech = structuredClone(world.client.fixture.observations[896]);
        withTech.observation!.gameLoop = 900;
        withTech.observation!.playerCommon!.minerals = 500;
        withTech.observation!.playerCommon!.vespene = 100;
        withTech.observation!.rawData!.units!.push(
            rawUnit({ tag: 'rax', unitType: UnitType.BARRACKS, pos: { x: 40, y: 40, z: 10 } }),
            rawUnit({ tag: 'cc1', unitType: UnitType.COMMANDCENTER, pos: { x: 60, y: 40, z: 10 } }),
            rawUnit({ tag: 'cc2', unitType: UnitType.COMMANDCENTER, pos: { x: 80, y: 40, z: 10 } }),
            rawUnit({ tag: 'ebay', unitType: UnitType.ENGINEERINGBAY, pos: { x: 40, y: 60, z: 10 } }),
        );
        await stepTo(world, withTech);
        const { actions, units } = world.resources.get();
        const [cc1, cc2, ebay] = units.getByTag(['cc1', 'cc2', 'ebay']);
        const charged: number[][] = [];
        const charge = async (spend: () => Promise<unknown>) => {
            const { minerals, vespene } = world.agent;
            await spend();
            charged.push([minerals! - world.agent.minerals!, vespene! - world.agent.vespene!]);
        };

        await charge(() => actions.build(UnitType.SUPPLYDEPOT, { x: 0, y: 7 }));
        await charge(() => actions.train(UnitType.ORBITALCOMMAND, cc1));
        await charge(() => world.agent.train(UnitType.ORBITALCOMMAND, 1, cc2.pos));
        await charge(() => actions.upgrade(Upgrade.TERRANINFANTRYWEAPONSLEVEL1, ebay));

        expect(charged).toEqual([
            [100, 0],
            [150, 0],
            [150, 0],
            [100, 100],
        ]);
        await expect(actions.upgrade(Upgrade.TERRANINFANTRYARMORSLEVEL1, ebay)).rejects.toBeInstanceOf(TrainError);
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

    it('trains and researches on the dict producer with the ability the game accepts: a Lurker from a hydralisk, zealots from an idle gateway first, then one per ready warp gate at distinct spots, charging each, vehicle plating at the armory', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const [hydralisk, lurkerDen, gateway, warpGate, otherWarpGate, coolingWarpGate, armory] = [
            UnitType.HYDRALISK,
            UnitType.LURKERDENMP,
            UnitType.GATEWAY,
            UnitType.WARPGATE,
            UnitType.WARPGATE,
            UnitType.WARPGATE,
            UnitType.ARMORY,
        ].map((unitType) => rawUnit({ unitType, pos: { x: 30.5, y: 30.5, z: 12 } }));
        const withProducers = structuredClone(world.client.fixture.observations[896]);
        withProducers.observation!.gameLoop = 900;
        withProducers.observation!.rawData!.units!.push(
            hydralisk,
            lurkerDen,
            gateway,
            warpGate,
            otherWarpGate,
            coolingWarpGate,
            armory,
        );
        withProducers.observation!.rawData!.player!.powerSources = [
            { pos: { x: 26, y: 26, z: 12 }, radius: 2, tag: '1' },
        ];
        await stepTo(world, withProducers);
        const { actions, units } = world.resources.get();
        units.getByTag([warpGate.tag, otherWarpGate.tag]).forEach((unit) => {
            unit._availableAbilities = [WarpUnitAbility[UnitType.ZEALOT]];
        });
        const sentBefore = world.client.sent.actions.length;

        await actions.train(UnitType.LURKERMP);
        await expect(actions.train(UnitType.ZEALOT, units.getByTag(coolingWarpGate.tag))).rejects.toBeInstanceOf(
            TrainError,
        );
        const mineralsBefore = world.agent.minerals!;
        const random = spyOn(Math, 'random').mockReturnValue(0);
        try {
            for (let zealot = 0; zealot < 3; zealot++) await actions.train(UnitType.ZEALOT);
        } finally {
            random.mockRestore();
        }
        const zealotsCharged = mineralsBefore - world.agent.minerals!;
        await expect(actions.train(UnitType.ZEALOT)).rejects.toBeInstanceOf(TrainError);
        await actions.upgrade(Upgrade.TERRANVEHICLEANDSHIPARMORSLEVEL1);
        await actions.flushQueuedActions();

        const commands = world.client.sent.actions
            .slice(sentBefore)
            .flatMap((request) => request.actions!.map((action) => action.actionRaw!.unitCommand!));
        const warpTargets = commands.flatMap((command) =>
            command.targetWorldSpacePos ? [`${command.targetWorldSpacePos.x},${command.targetWorldSpacePos.y}`] : [],
        );
        expect({ commands, zealotsCharged, distinctWarpTargets: new Set(warpTargets).size }).toEqual({
            commands: [
                { abilityId: Ability.MORPH_LURKER, unitTags: [hydralisk.tag] },
                { abilityId: Ability.TRAIN_ZEALOT, unitTags: [gateway.tag] },
                ...[warpGate, otherWarpGate].map((gate) => ({
                    abilityId: Ability.TRAINWARP_ZEALOT,
                    unitTags: [gate.tag],
                    targetWorldSpacePos: expect.any(Object),
                })),
                { abilityId: Ability.RESEARCH_TERRANVEHICLEANDSHIPPLATINGLEVEL1, unitTags: [armory.tag] },
            ],
            zealotsCharged: 300,
            distinctWarpTargets: 2,
        });
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
