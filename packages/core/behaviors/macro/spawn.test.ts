import { describe, expect, it, spyOn } from 'bun:test';
import createAgent from '../../agent/create-agent.ts';
import { Race } from '../../constants/enums.ts';
import { Ability, UnitType } from '../../constants/index.ts';
import { NodeSC2Error } from '../../engine/errors.ts';
import { createTestWorld, loadFixture } from '../../test/create-test-world.ts';
import { observation, rawUnit } from '../../test/factories.ts';
import { structurePending } from './helpers.ts';
import { buildWorkers, spawnController } from './spawn.ts';
import type { Behavior } from '../../types.ts';

type Units = SC2APIProtocol.Unit[];

async function setup(units: Units, { minerals = 1000, vespene = 1000, foodWorkers = 12 } = {}) {
    const fixture = loadFixture('blueshift');
    fixture.observations = {
        0: observation({
            mapSize: fixture.gameInfo.startRaw!.mapSize,
            playerCommon: { minerals, vespene, foodCap: 200, foodUsed: 0, foodWorkers },
            units,
        }),
    };
    return createTestWorld(fixture);
}

const plainRax = (tag: string) => rawUnit({ tag, unitType: UnitType.BARRACKS });
const techlabRax = () => [
    rawUnit({ tag: 'techlabRax', unitType: UnitType.BARRACKS, addOnTag: 'techlab' }),
    rawUnit({ tag: 'techlab', unitType: UnitType.BARRACKSTECHLAB }),
];
const marines = (count: number) =>
    Array.from({ length: count }, (_, index) => rawUnit({ tag: `marine${index}`, unitType: UnitType.MARINE }));

async function run(world: Awaited<ReturnType<typeof setup>>, behavior: Behavior) {
    const sentBefore = world.client.sent.actions.length;
    const result = await world.resources.get().behaviors.run(behavior);
    await world.resources.get().actions.flushQueuedActions();
    const commands = world.client.sent.actions
        .slice(sentBefore)
        .flatMap((request) => request.actions ?? [])
        .flatMap((action) => (action.actionRaw?.unitCommand ? [action.actionRaw.unitCommand] : []))
        .flatMap(({ unitTags, abilityId, queueCommand }) =>
            unitTags!.map((tag) => ({ tag, abilityId, queued: Boolean(queueCommand) })),
        );
    return { result, commands };
}

const composition = {
    [UnitType.MARAUDER]: { proportion: 0.5, priority: 0 },
    [UnitType.MARINE]: { proportion: 0.5, priority: 1 },
};

describe('spawnController', () => {
    it('trains in priority order and skips a type that is over its target proportion', async () => {
        const empty = await setup([plainRax('rax'), ...techlabRax()]);
        expect((await run(empty, spawnController({ composition }))).commands).toEqual([
            { tag: 'techlabRax', abilityId: Ability.TRAIN_MARAUDER, queued: false },
            { tag: 'rax', abilityId: Ability.TRAIN_MARINE, queued: false },
        ]);

        const marineHeavy = await setup([plainRax('rax'), ...techlabRax(), ...marines(3)]);
        expect((await run(marineHeavy, spawnController({ composition }))).commands).toEqual([
            { tag: 'techlabRax', abilityId: Ability.TRAIN_MARAUDER, queued: false },
        ]);
    });

    it('stops at an unaffordable top priority unless freeflow', async () => {
        const units = [plainRax('rax'), ...techlabRax()];
        const stopped = await setup(units, { vespene: 0 });
        expect(await run(stopped, spawnController({ composition }))).toEqual({ result: false, commands: [] });

        const freeflow = await setup(units, { vespene: 0 });
        expect((await run(freeflow, spawnController({ composition, freeflow: true }))).commands).toEqual([
            { tag: 'rax', abilityId: Ability.TRAIN_MARINE, queued: false },
            { tag: 'techlabRax', abilityId: Ability.TRAIN_MARINE, queued: false },
        ]);
    });

    it('skips a type with no idle producer so a lower priority still trains', async () => {
        const world = await setup(
            [
                rawUnit({
                    tag: 'busyTechlabRax',
                    unitType: UnitType.BARRACKS,
                    addOnTag: 'techlab',
                    orders: [{ abilityId: Ability.TRAIN_MARAUDER, progress: 0.5 }],
                }),
                techlabRax()[1],
                plainRax('rax'),
            ],
            { vespene: 0 },
        );
        expect((await run(world, spawnController({ composition }))).commands).toEqual([
            { tag: 'rax', abilityId: Ability.TRAIN_MARINE, queued: false },
        ]);

        const [techlabHost, techlab] = techlabRax();
        const unfinished = await setup([plainRax('rax'), techlabHost, { ...techlab, buildProgress: 0.5 }]);
        expect((await run(unfinished, spawnController({ composition }))).commands).toEqual([
            { tag: 'rax', abilityId: Ability.TRAIN_MARINE, queued: false },
            { tag: 'techlabRax', abilityId: Ability.TRAIN_MARINE, queued: false },
        ]);

        const protossFixture = loadFixture('blueshift-protoss');
        protossFixture.observations = {
            0: observation({
                mapSize: protossFixture.gameInfo.startRaw!.mapSize,
                playerCommon: { minerals: 50, vespene: 0, foodCap: 200, foodUsed: 0 },
                units: [
                    rawUnit({ tag: 'unpoweredGateway', unitType: UnitType.GATEWAY, isPowered: false }),
                    rawUnit({ tag: 'nexus', unitType: UnitType.NEXUS, isPowered: false }),
                ],
            }),
        };
        const protoss = await createTestWorld(protossFixture, {
            agent: createAgent({ settings: { race: Race.PROTOSS } }),
        });
        const unpowered = {
            [UnitType.ZEALOT]: { proportion: 0.5, priority: 0 },
            [UnitType.PROBE]: { proportion: 0.5, priority: 1 },
        };
        expect((await run(protoss, spawnController({ composition: unpowered }))).commands).toEqual([
            { tag: 'nexus', abilityId: Ability.TRAIN_PROBE, queued: false },
        ]);
    });

    it('trains 2 from a reactor barracks', async () => {
        const world = await setup([
            rawUnit({ tag: 'reactorRax', unitType: UnitType.BARRACKS, addOnTag: 'reactor' }),
            rawUnit({ tag: 'reactor', unitType: UnitType.BARRACKSREACTOR }),
        ]);
        const { commands } = await run(
            world,
            spawnController({ composition: { [UnitType.MARINE]: { proportion: 1, priority: 0 } } }),
        );
        expect(commands).toEqual([
            { tag: 'reactorRax', abilityId: Ability.TRAIN_MARINE, queued: false },
            { tag: 'reactorRax', abilityId: Ability.TRAIN_MARINE, queued: true },
        ]);
    });

    it('tops up the only tech-ready type to maximum when over-producing on low tech', async () => {
        const units = [plainRax('a'), plainRax('b'), plainRax('c'), ...marines(5)];
        const lowTech = {
            [UnitType.MARINE]: { proportion: 0.5, priority: 0 },
            [UnitType.GHOST]: { proportion: 0.5, priority: 1 },
        };
        const topped = await setup(units);
        expect((await run(topped, spawnController({ composition: lowTech }))).commands).toHaveLength(3);

        const off = await setup(units);
        const { result } = await run(off, spawnController({ composition: lowTech, overProduceOnLowTech: false }));
        expect(result).toBe(false);
    });

    it('rejects a bad composition at creation unless freeflow', () => {
        const create = (comp: Record<number, { proportion: number; priority: number }>, freeflow = false) =>
            spawnController({ composition: comp, freeflow });
        const marine = (proportion: number, priority: number) => ({ [UnitType.MARINE]: { proportion, priority } });

        expect(() => create(marine(0.9, 0))).toThrow(NodeSC2Error);
        expect(() => create(marine(1, 11))).toThrow(NodeSC2Error);
        expect(() => create(marine(1, 0.5))).toThrow(NodeSC2Error);
        expect(() => create(marine(1 + 1e-7, 10))).not.toThrow();
        expect(() => create(marine(0.9, 11), true)).not.toThrow();
    });
});

describe('buildWorkers', () => {
    it('trains toward toCount and stops at it', async () => {
        const world = await setup([rawUnit({ tag: 'cc', unitType: UnitType.COMMANDCENTER })], { foodWorkers: 12 });
        expect((await run(world, buildWorkers({ toCount: 12 }))).result).toBe(false);
        expect((await run(world, buildWorkers({ toCount: 13 }))).commands).toEqual([
            { tag: 'cc', abilityId: Ability.TRAIN_SCV, queued: false },
        ]);
    });
});

describe('structurePending', () => {
    it('counts tracked builds plus untracked in-progress structures without double counting', async () => {
        const world = await setup([
            rawUnit({ tag: 'tracked', unitType: UnitType.SUPPLYDEPOT, buildProgress: 0.5 }),
            rawUnit({ tag: 'untracked', unitType: UnitType.SUPPLYDEPOT, buildProgress: 0.5 }),
            rawUnit({ tag: 'done', unitType: UnitType.SUPPLYDEPOT }),
        ]);
        const { buildings } = world.resources.get();
        spyOn(buildings, 'pending').mockReturnValue(1);
        spyOn(buildings, 'getTracked').mockReturnValue([{ structureTag: 'tracked' }] as never);
        expect(structurePending(world, UnitType.SUPPLYDEPOT)).toBe(2);
    });
});
