import { describe, expect, it, spyOn } from 'bun:test';
import createDebug from 'debug';
import { Alliance } from '../constants/enums.ts';
import { GameEndedError, NodeSC2Error } from './errors.ts';
import createAgent from '../agent/create-agent.ts';
import { createTestWorld, loadFixture, stepTo, stepWith } from '../test/create-test-world.ts';
import { resetGameState } from './create-world.ts';
import { GATHERING } from '../constants/unit-role.ts';
import * as UnitType from '../constants/unit-type.ts';
import { buildingsResource, stateByBuildings } from '../resources/buildings.ts';
import { flyingResource, stateByFlying } from '../resources/flying.ts';
import { influenceResource, stateByInfluence } from '../resources/influence.ts';
import { intelResource, stateByIntel } from '../resources/intel.ts';
import { mapAnalysisResource, stateByMapAnalysis } from '../resources/map-analysis.ts';
import { settingsByMemory } from '../resources/memory.ts';
import { miningResource, stateByMining } from '../resources/mining.ts';
import { openingsResource, stateByOpenings } from '../resources/openings.ts';
import { placementResource, stateByPlacement } from '../resources/placement.ts';
import { rolesResource, stateByRoles } from '../resources/roles.ts';
import { stateBySquads } from '../resources/squads.ts';
import { observation, toyFixture } from '../test/factories.ts';
import type { ResourceDefinition, World } from '@sc-bot/core/types';

declare module '@sc-bot/core/types' {
    interface ResourceContainer {
        testCounter?: { count: number };
        testTally?: { items: string[] };
        testStepLog?: object;
        testFatalStep?: object;
        testConfigurable?: { received: unknown[]; configure(settings: { level: number }): void };
    }
}

const counterResource: ResourceDefinition<'testCounter'> = {
    name: 'testCounter',
    create: () => ({ count: 0 }),
    reset: (counter) => {
        counter.count = 0;
    },
};

const tallyResource: ResourceDefinition<'testTally'> = {
    name: 'testTally',
    create: () => ({ items: [] }),
};

describe('resetGameState', () => {
    it('lets setupGame start a new game on another map without the previous unit store, enemy memory, combat rally, earmarks, events, debug drawings or registered resource state, keeping registered resource identity', async () => {
        const acropolis = loadFixture('acropolis');
        const acropolisEnemyTags = acropolis.observations[896]
            .observation!.rawData!.units!.filter((unit) => unit.alliance === Alliance.ENEMY)
            .map((unit) => unit.tag!)
            .sort();
        const acropolisRally = (await createTestWorld(acropolis, { loop: 896 })).resources.get().map.getCombatRally();

        const world = await createTestWorld('blueshift', { loop: 896 });
        const { units, map, events, debug } = world.resources.get();
        const blueshiftRally = map.getCombatRally();
        world.data.addEarmark({ name: 'leftover', minerals: 100, vespene: 0 });
        const staleReader = events.createReader();
        events.write({ name: 'stale', type: 'all' });
        debug!.setDrawTextScreen('stale', [{ text: 'leftover', pos: { x: 0, y: 0 } }]);
        const counter = world.resources.register(counterResource);
        const tally = world.resources.register(tallyResource);
        counter.count = 5;
        tally.items.push('stale');
        Object.assign(world.client.fixture, acropolis);
        world.client.setObservation(acropolis.observations[896]);

        await world.engine.setupGame();
        await stepTo(world, 896);
        await debug!.updateScreen();

        expect(blueshiftRally).not.toEqual(acropolisRally);
        expect(map.getCombatRally()).toEqual(acropolisRally);
        expect(
            units
                .getAll(Alliance.ENEMY)
                .map((unit) => unit.tag!)
                .sort(),
        ).toEqual(acropolisEnemyTags);
        expect(world.data.get('earmarks')).toEqual([]);
        expect(events.read(staleReader)).toEqual([]);
        expect(world.client.sent.debug.at(-1)).toEqual({ debug: [] });
        expect(world.resources.get().testCounter).toBe(counter);
        expect(world.resources.get().testTally).toBe(tally);
        expect(counter.count).toBe(0);
        expect(tally.items).toEqual([]);
    });

    it('re-seats every WeakMap resource with the state of a newly created one, keeping only its configured settings, and its methods read the new state', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const {
            roles,
            openings,
            mining,
            mapAnalysis,
            placement,
            flying,
            squads,
            memory,
            map,
            units,
            intel,
            influence,
            buildings,
        } = world.resources.get();
        roles.configure({ exclusive: [GATHERING] });
        openings.configure({ minGames: 5 });
        mining.configure({ enabled: true, workersPerGas: 2 });
        mapAnalysis.configure({ defenseOffset: 7 });
        placement.configure({ reservationTimeout: 30 });
        flying.configure({ priority: 3 });
        memory.configure({ expireGround: 5 });
        intel.configure({ groundNearBase: 7 });
        influence.configure({ costMultiplier: 3 });
        buildings.configure({ timeout: 60 });
        await stepWith(world, 904);
        await stepWith(world, 912);
        const worker = units.getWorkers().find((candidate) => mining.getAssignment(candidate))!;
        const townhall = units.getBases()[0];
        openings.record('stale');
        influence.getGrid('ground');
        buildings.build(UnitType.SUPPLYDEPOT, { at: { x: 50, y: 50 }, worker });
        flying.move(townhall, { x: 50, y: 50 });
        mapAnalysis.getDefensivePosition(map.getMain()!);
        const staleSquads = squads.getSquads(GATHERING);
        const staleAssignment = mining.getAssignment(worker);
        const withSettings = [
            { resource: roles, definition: rolesResource, states: stateByRoles },
            { resource: openings, definition: openingsResource, states: stateByOpenings },
            { resource: mining, definition: miningResource, states: stateByMining },
            { resource: mapAnalysis, definition: mapAnalysisResource, states: stateByMapAnalysis },
            { resource: placement, definition: placementResource, states: stateByPlacement },
            { resource: flying, definition: flyingResource, states: stateByFlying },
            { resource: intel, definition: intelResource, states: stateByIntel },
            { resource: influence, definition: influenceResource, states: stateByInfluence },
            { resource: buildings, definition: buildingsResource, states: stateByBuildings },
        ] as { resource: object; definition: ResourceDefinition<any>; states: WeakMap<object, { settings: object }> }[];
        const configured = withSettings.map(({ resource, states }) => states.get(resource)!.settings);
        const fresh = withSettings.map(({ definition, states }, index) => ({
            ...states.get(definition.create(world))!,
            settings: configured[index],
        }));
        const memorySettings = settingsByMemory.get(memory);

        withSettings.forEach(({ resource, states }, index) => expect(states.get(resource)).not.toEqual(fresh[index]));
        expect(staleSquads.length).toBeGreaterThan(0);
        expect(staleAssignment).toBeDefined();

        resetGameState(world);

        expect(withSettings.map(({ resource, states }) => states.get(resource))).toEqual(fresh);
        withSettings.forEach(({ resource, states }, index) =>
            expect(states.get(resource)!.settings).toBe(configured[index]),
        );
        expect(stateBySquads.get(squads)).toEqual(new Map());
        memory.configure({ expireAir: 9 });
        expect(settingsByMemory.get(memory)).toBe(memorySettings);
        expect(memorySettings).toEqual({ expireGround: 5, expireAir: 9 });
        expect(roles.roleOf(worker)).toBeUndefined();
        expect(mining.getAssignment(worker)).toBeUndefined();
        expect(() => mapAnalysis.getRegions()).toThrow('Start grids are not set yet');
        expect(openings.getChosen()).toBeUndefined();
        expect(flying.getPlans()).toEqual([]);
        expect(placement.getPlacements()).toEqual([]);
        expect(squads.getSquads(GATHERING)).toEqual([]);
    });
});

describe('resources registry', () => {
    it('returns the existing instance when the same definition is registered again', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const counter = world.resources.register(counterResource);

        expect(world.resources.register(counterResource)).toBe(counter);
    });

    it('throws when a different definition claims a registered name', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        world.resources.register(counterResource);

        expect(() => world.resources.register({ ...counterResource })).toThrow(NodeSC2Error);
    });

    it('runs step hooks in registration order once per dispatch, after engine systems and before the agent, past a throwing hook', async () => {
        const calls: string[] = [];
        const loopOf = (world: World) => world.resources.get().frame.getGameLoop();
        const agent = createAgent({
            async onStep(world: World) {
                calls.push(`agent@${loopOf(world)}`);
            },
        });
        const fixture = toyFixture();
        const world = await createTestWorld(fixture, { agent });
        calls.splice(0);
        world.resources.register({ ...tallyResource, onStep: (_, w) => calls.push(`tally@${loopOf(w)}`) });
        world.resources.register({
            ...counterResource,
            onStep: () => {
                throw new Error('boom');
            },
        });
        world.resources.register({
            name: 'testStepLog',
            create: () => ({}),
            onStep: (_, w) => calls.push(`log@${loopOf(w)}`),
        });
        const units = fixture.observations[0].observation!.rawData!.units!;

        await stepTo(world, observation({ gameLoop: 8, units }));
        await stepTo(world, observation({ gameLoop: 16, units }));

        expect(calls).toEqual(['tally@8', 'log@8', 'agent@8', 'tally@16', 'log@16', 'agent@16']);
    });

    it('shows step hook errors at sc2:debug:resources and warns on unexpected ones only', async () => {
        const world = await createTestWorld(toyFixture());
        let failure: Error = new NodeSC2Error('refused');
        world.resources.register({
            name: 'testFatalStep',
            create: () => ({}),
            onStep: () => {
                throw failure;
            },
        });
        const lines: string[] = [];
        const { log } = createDebug;
        createDebug.log = (line: string) => lines.push(line);
        createDebug.enable('sc2:debug:resources');
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await stepTo(world, observation({ gameLoop: 8 }));
            expect([lines.some((line) => line.includes('refused')), warn.mock.calls.length]).toEqual([true, 0]);

            failure = new TypeError('bad');
            await stepTo(world, observation({ gameLoop: 16 }));
            expect([lines.some((line) => line.includes('bad')), warn.mock.calls.length]).toEqual([true, 1]);
        } finally {
            createDebug.disable();
            createDebug.log = log;
            warn.mockRestore();
        }
    });

    it('rejects dispatch with a fatal error thrown by a step hook', async () => {
        const world = await createTestWorld(toyFixture());
        const failure = new GameEndedError('over');
        world.resources.register({
            name: 'testFatalStep',
            create: () => ({}),
            onStep: () => {
                throw failure;
            },
        });

        await expect(stepTo(world, observation({ gameLoop: 8 }))).rejects.toBe(failure);
    });

    it('passes config.resources sections to configure on register and after every reset, warning once for a resource without configure', async () => {
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        const world = await createTestWorld(toyFixture(), {
            config: { resources: { testConfigurable: { level: 3 }, testCounter: {} as never } },
        });
        const configurable = world.resources.register({
            name: 'testConfigurable',
            create: () => ({
                received: [] as unknown[],
                configure(settings) {
                    this.received.push(settings);
                },
            }),
            reset: () => {},
        });
        world.resources.register(counterResource);

        world.resources.reset(world);
        world.resources.reset(world);

        expect(configurable.received).toEqual([{ level: 3 }, { level: 3 }, { level: 3 }]);
        expect(warn.mock.calls.filter(([message]) => String(message).includes('testCounter'))).toHaveLength(1);
        warn.mockRestore();
    });
});
