import { describe, expect, it } from 'bun:test';
import { Alliance } from '../constants/enums.ts';
import { ATTACKING, BUILDING, DEFENDING, GATHERING, SCOUTING } from '../constants/unit-role.ts';
import { MARINE, MULE, SCV } from '../constants/unit-type.ts';
import { createTestWorld, observationAt, stepTo } from '../test/create-test-world.ts';
import { rawUnit } from '../test/factories.ts';
import { currentCommander } from './command-context.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { CommandResult, Unit } from '../types.ts';

const SCVS = ['4345823233', '4343988225', '4343726081'];
const MARINE_TAG = '4354211841';

const tags = (units: Unit[]) => units.map((unit) => unit.tag);

const withDead = (responseObservation: SC2APIProtocol.ResponseObservation, deadUnits: string[]) => {
    responseObservation.observation!.rawData!.event = { deadUnits };
    return responseObservation;
};

describe('roles', () => {
    it('assigns, replaces, clears and switches roles by unit or tag, and gets current own units by type without labelling them', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { roles, units } = world.resources.get();
        const marine = units.getByTag(MARINE_TAG)!;

        roles.assign(marine, ATTACKING);
        roles.assign([SCVS[0], SCVS[1]], ATTACKING);
        roles.assign(SCVS[1], DEFENDING);
        expect(roles.roleOf(SCVS[1])).toBe(DEFENDING);
        expect([...roles.getTags(ATTACKING)]).toEqual([MARINE_TAG, SCVS[0]]);
        expect(tags(roles.get(ATTACKING, { types: SCV }))).toEqual([SCVS[0]]);
        expect(tags(roles.get([ATTACKING, DEFENDING], { excludeTypes: [MARINE] }))).toEqual([SCVS[0], SCVS[1]]);

        roles.switchRole(ATTACKING, SCOUTING);
        roles.clear(units.getByTag(SCVS[0])!);
        expect(roles.getTags(ATTACKING).size).toBe(0);
        expect(tags(roles.get(SCOUTING))).toEqual([MARINE_TAG]);
        expect(roles.roleOf(marine)).toBe(SCOUTING);
        expect(marine.labels.size).toBe(0);
    });

    it('defaults new finished workers but not MULEs to GATHERING once, keeps cargo roles and drops dead units', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { roles } = world.resources.get();
        const mule = rawUnit({ unitType: MULE });
        const unfinished = rawUnit({ buildProgress: 0.5 });

        await stepTo(world, observationAt(world, 900, { add: [mule, unfinished] }));
        expect(SCVS.map((tag) => roles.roleOf(tag))).toEqual([GATHERING, GATHERING, GATHERING]);
        expect([roles.roleOf(MARINE_TAG), roles.roleOf(mule.tag), roles.roleOf(unfinished.tag)]).toEqual([
            undefined,
            undefined,
            undefined,
        ]);

        roles.clear(SCVS[0]);
        roles.assign(MARINE_TAG, ATTACKING);
        await stepTo(world, withDead(observationAt(world, 904, { hide: [MARINE_TAG] }), [SCVS[1]]));
        expect(roles.roleOf(SCVS[0])).toBeUndefined();
        expect(roles.roleOf(SCVS[1])).toBeUndefined();
        expect(roles.roleOf(MARINE_TAG)).toBe(ATTACKING);
        expect(roles.get(ATTACKING)).toHaveLength(0);

        await stepTo(world, observationAt(world, 908));
        expect(tags(roles.get(ATTACKING))).toEqual([MARINE_TAG]);

        const enemy = rawUnit({ alliance: Alliance.ENEMY, unitType: MARINE });
        await stepTo(world, observationAt(world, 912, { add: [enemy] }));
        roles.assign(enemy.tag, ATTACKING);
        expect(roles.get(ATTACKING).map((unit) => unit.tag)).toEqual([MARINE_TAG]);
        await stepTo(world, observationAt(world, 916));
        expect(roles.roleOf(enemy.tag)).toBeUndefined();
    });

    it('proposes inside as() under the role owner, inheriting the priority unless given', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { roles, actions, events, units } = world.resources.get();
        const reader = events.createReader();

        const inherited = actions.as({ priority: 7 }, () => roles.as(ATTACKING, () => currentCommander()));
        const given = roles.as(ATTACKING, () => currentCommander(), { priority: 3 });
        await roles.as(ATTACKING, () => actions.move(units.getByTag(MARINE_TAG)!, { x: 20, y: 20 }));
        await actions.flushQueuedActions();

        expect([inherited, given].map(({ owner, priority }) => ({ owner, priority }))).toEqual([
            { owner: 'role:ATTACKING', priority: 7 },
            { owner: 'role:ATTACKING', priority: 3 },
        ]);
        expect(
            events
                .read(reader)
                .flatMap(({ data }) => data as CommandResult[])
                .map(({ owner }) => owner),
        ).toEqual(['role:ATTACKING']);
    });

    it('lets only the role owner command an exclusive role, keeping settings but not roles across a game reset', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { roles } = world.resources.get();
        roles.configure({ exclusive: [BUILDING] });
        roles.assign(SCVS[0], BUILDING);
        roles.assign(SCVS[1], ATTACKING);

        expect([
            roles.mayCommand('Economy', SCVS[0]),
            roles.mayCommand('role:BUILDING', SCVS[0]),
            roles.mayCommand('Economy', SCVS[1]),
            roles.mayCommand('Economy', MARINE_TAG),
        ]).toEqual([false, true, true, true]);

        await world.engine.setupGame();

        expect(roles.getTags(ATTACKING).size).toBe(0);
        expect(roles.roleOf(SCVS[1])).toBe(GATHERING);
        roles.assign(SCVS[0], BUILDING);
        expect(roles.mayCommand('Economy', SCVS[0])).toBe(false);
    });
});
