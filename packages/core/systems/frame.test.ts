import { describe, expect, it, spyOn } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { Ability } from '../constants/index.ts';
import { Alert } from '../constants/enums.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';

const NOT_ENOUGH_MINERALS = 6 as SC2APIProtocol.ActionResult;

describe('frame system', () => {
    it("exposes the observation's alerts and action errors and python-sc2 game time", async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { frame } = world.resources.get();

        expect([frame.time(), frame.timeFormatted(), frame.timeInSeconds()]).toEqual([40, '00:40', 39]);
        expect(frame.getAlerts()).toEqual([]);
        expect(frame.getActionErrors()).toEqual([]);

        const actionError = {
            unitTag: '4350541825',
            abilityId: String(Ability.TRAIN_MARINE),
            result: NOT_ENOUGH_MINERALS,
        };
        const responseObservation = structuredClone(world.client.fixture.observations[896]);
        responseObservation.observation!.gameLoop = 2000;
        responseObservation.observation!.alerts = [Alert.NUCLEARLAUNCHDETECTED];
        responseObservation.actionErrors = [actionError];
        await stepTo(world, responseObservation);

        expect([frame.time(), frame.timeFormatted()]).toEqual([2000 / 22.4, '01:29']);
        expect(frame.getAlerts()).toEqual([Alert.NUCLEARLAUNCHDETECTED]);
        expect([frame.hasAlert(Alert.NUCLEARLAUNCHDETECTED), frame.hasAlert(Alert.NYDUSWORMDETECTED)]).toEqual([
            true,
            false,
        ]);
        expect(frame.getActionErrors()).toEqual([actionError]);
    });

    it('tracks min/avg/max/last agent step duration in milliseconds, one sample per step', async () => {
        let clock = 1000;
        const clockSpy = spyOn(performance, 'now').mockImplementation(() => clock);
        const stepDurations = [10, 30, 20];
        const agent = createAgent({
            async onStep() {
                clock += stepDurations.shift() ?? 0;
            },
        });
        try {
            const world = await createTestWorld('blueshift', { loop: 0, agent });

            await stepTo(world, 224);
            await stepTo(world, 896);

            expect(world.resources.get().frame.getStepTime()).toEqual({ min: 10, avg: 20, max: 30, last: 20 });
        } finally {
            clockSpy.mockRestore();
        }
    });
});
