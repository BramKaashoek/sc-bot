import { describe, expect, it } from 'bun:test';
import { UnitType } from '../constants/index.ts';
import { createTestWorld, observationAt, stepTo } from '../test/create-test-world.ts';

const UNIT_VALUE_LIFE = 2;
const WHITE = { r: 255, g: 255, b: 255 };
const CHEATS = [
    'showMap',
    'controlEnemy',
    'food',
    'free',
    'allResources',
    'god',
    'minerals',
    'gas',
    'cooldown',
    'techTree',
    'upgrade',
    'fastBuild',
] as const;

describe('Debugger', () => {
    it('kills units, sets unit values and toggles each cheat with one debug request each', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { units } = world.resources.get();
        const debug = world.resources.get().debug!;
        const marines = units.getById(UnitType.MARINE);
        const marineTags = marines.map((marine) => marine.tag!);
        const sentBefore = world.client.sent.debug.length;

        await debug.killUnit(marines);
        await debug.setUnitValue(marines, UNIT_VALUE_LIFE, 1);
        for (const cheat of CHEATS) await debug[cheat]();

        const expected: unknown[] = [
            { debug: [{ killUnit: { tag: marineTags } }] },
            { debug: marineTags.map((unitTag) => ({ unitValue: { unitValue: UNIT_VALUE_LIFE, value: 1, unitTag } })) },
            ...CHEATS.map((_cheat, index) => ({ debug: [{ gameState: index + 1 }] })),
        ];
        expect(world.client.sent.debug.slice(sentBefore) as unknown[]).toEqual(expected);
    });

    it('moves the camera to a unit or point on the ground plane and quick saves/loads', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const debug = world.resources.get().debug!;
        const commandCenter = world.resources.get().units.getByTag('4342677505')!;
        const sentBefore = world.client.sent.actions.length;

        await debug.moveCamera(commandCenter);
        await debug.moveCamera({ x: 40, y: 30 });
        await debug.quickSave();
        await debug.quickLoad();

        expect(world.client.sent.actions.slice(sentBefore)).toEqual([
            { actions: [{ actionRaw: { cameraMove: { centerWorldSpace: { x: 15.5, y: 15.5, z: 0 } } } }] },
            { actions: [{ actionRaw: { cameraMove: { centerWorldSpace: { x: 40, y: 30, z: 0 } } } }] },
        ]);
        expect(world.client.sent.quickSave).toEqual([{}]);
        expect(world.client.sent.quickLoad).toEqual([{}]);
    });

    it('draws boxes with the next screen update only, white unless coloured', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const debug = world.resources.get().debug!;
        const red = { r: 255, g: 0, b: 0 };
        const boxesIn = (request: SC2APIProtocol.RequestDebug) =>
            (request.debug ?? []).flatMap((command) => command.draw?.boxes ?? []);

        debug.touched = false;
        debug.drawBox({ x: 10, y: 10, z: 12 }, { x: 11, y: 11, z: 13 });
        debug.drawBox({ x: 20, y: 20, z: 12 }, { x: 22, y: 22, z: 14 }, red);
        expect(debug.touched).toBe(true);
        await debug.updateScreen();
        await debug.updateScreen();

        const [withBoxes, afterwards] = world.client.sent.debug.slice(-2);
        expect(boxesIn(withBoxes)).toEqual([
            { min: { x: 10, y: 10, z: 12 }, max: { x: 11, y: 11, z: 13 }, color: WHITE },
            { min: { x: 20, y: 20, z: 12 }, max: { x: 22, y: 22, z: 14 }, color: red },
        ]);
        expect(boxesIn(afterwards)).toEqual([]);
    });

    it('flushes boxes drawn before a step during that step without any debug flag, then sends only newer ones', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const debug = world.resources.get().debug!;
        const nextLoop = observationAt(world, 900);
        const boxesSince = (sentBefore: number) =>
            world.client.sent.debug
                .slice(sentBefore)
                .flatMap((request) => request.debug ?? [])
                .flatMap((command) => command.draw?.boxes ?? []);
        const sentBefore = world.client.sent.debug.length;

        debug.drawBox({ x: 10, y: 10, z: 12 }, { x: 11, y: 11, z: 13 });
        await stepTo(world, nextLoop);

        expect(boxesSince(sentBefore)).toEqual([
            { min: { x: 10, y: 10, z: 12 }, max: { x: 11, y: 11, z: 13 }, color: WHITE },
        ]);
        expect(debug.touched).toBe(false);

        const sentAfterStep = world.client.sent.debug.length;
        debug.drawBox({ x: 20, y: 20, z: 12 }, { x: 22, y: 22, z: 14 });
        await debug.updateScreen();

        expect(boxesSince(sentAfterStep)).toEqual([
            { min: { x: 20, y: 20, z: 12 }, max: { x: 22, y: 22, z: 14 }, color: WHITE },
        ]);
    });
});
