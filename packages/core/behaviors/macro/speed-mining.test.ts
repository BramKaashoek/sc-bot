import { describe, expect, it } from 'bun:test';
import { HARVEST_GATHER, HARVEST_RETURN, MOVE, SMART } from '../../constants/ability.ts';
import { CARRYMINERALFIELDMINERALS } from '../../constants/buff.ts';
import { COMMANDCENTER, SCV } from '../../constants/unit-type.ts';
import { runBehavior } from '../../test/behavior-helpers.ts';
import { createTestWorld, observationAt, stepTo } from '../../test/create-test-world.ts';
import { rawUnit } from '../../test/factories.ts';
import { townhallTarget } from '../../utils/mining/targets.ts';
import { speedMining } from './speed-mining.ts';

describe('speedMining', () => {
    it('steps a mineral-bound worker onto the patch target, and a returning worker onto its townhall target', async () => {
        const world = await createTestWorld('blueshift', { loop: 0 });
        const { units, mining } = world.resources.get();
        const [townhall] = units.getBases();
        const mineral = units.getMineralFields().closestTo(townhall)!;
        const worker = units.getById(SCV).closestTo(mineral)!;
        const target = mining.getMineralTarget(mineral)!;
        const place = (x: number, y: number, orders: SC2APIProtocol.UnitOrder[], carrying = false) => {
            worker.pos = { ...worker.pos, x, y };
            worker.orders = orders;
            worker.buffIds = carrying ? [CARRYMINERALFIELDMINERALS] : [];
        };

        place(target.x + 1.9, target.y, [{ abilityId: HARVEST_GATHER, targetUnitTag: mineral.tag }]);
        expect(await runBehavior(world, speedMining({ worker, target: mineral }))).toEqual([
            true,
            [
                { abilityId: MOVE, pos: target },
                { abilityId: SMART, target: mineral.tag },
            ],
        ]);

        const returning = { x: townhall.pos.x + 2.75 * 1.08 + 1.9, y: townhall.pos.y };
        place(returning.x, returning.y, [{ abilityId: HARVEST_RETURN, targetUnitTag: townhall.tag }], true);
        expect(await runBehavior(world, speedMining({ worker, target: mineral, townhall }))).toEqual([
            true,
            [
                { abilityId: MOVE, pos: townhallTarget(townhall.pos, returning) },
                { abilityId: SMART, target: townhall.tag },
            ],
        ]);

        place(target.x + 0.7, target.y, [{ abilityId: HARVEST_GATHER, targetUnitTag: mineral.tag }]);
        expect(await runBehavior(world, speedMining({ worker, target: mineral }))).toEqual([false, []]);

        const far = { x: townhall.pos.x + 7, y: townhall.pos.y };
        place(far.x, far.y, [{ abilityId: HARVEST_RETURN, targetUnitTag: townhall.tag }], true);
        expect(await runBehavior(world, speedMining({ worker, target: mineral, townhall }))).toEqual([false, []]);

        const mining2 = [{ abilityId: HARVEST_GATHER, targetUnitTag: mineral.tag }];
        place(target.x + 2.1, target.y, [...mining2, ...mining2]);
        expect(await runBehavior(world, speedMining({ worker, target: mineral }))).toEqual([true, []]);
    });

    describe('with a second base beside the returning worker', () => {
        const setup = async (buildProgress: number) => {
            const world = await createTestWorld('blueshift', { loop: 0 });
            const { units } = world.resources.get();
            const [townhall] = units.getBases();
            const mineral = units.getMineralFields().closestTo(townhall)!;
            const probe = units.getById(SCV).closestTo(mineral)!;
            const pos = { ...probe.pos, x: townhall.pos.x + 2.75 * 1.08 + 1.9, y: townhall.pos.y };
            const nearer = rawUnit({
                tag: 'second',
                unitType: COMMANDCENTER,
                pos: { x: pos.x + 4, y: pos.y, z: pos.z },
                buildProgress,
            });
            await stepTo(world, observationAt(world, 12, { base: 0, add: [nearer] }));
            const worker = units.getByTag(probe.tag)!;
            worker.pos = pos;
            worker.orders = [{ abilityId: HARVEST_RETURN, targetUnitTag: townhall.tag }];
            worker.buffIds = [CARRYMINERALFIELDMINERALS];
            return { world, townhall, mineral, worker, second: units.getByTag('second')! };
        };

        it('honours an explicit townhall over the closest one', async () => {
            const { world, townhall, mineral, worker, second } = await setup(1);
            const behavior = (explicit?: typeof townhall) =>
                speedMining({ worker, target: mineral, townhall: explicit });

            expect(await runBehavior(world, behavior(townhall))).toEqual([
                true,
                [
                    { abilityId: MOVE, pos: townhallTarget(townhall.pos, worker.pos) },
                    { abilityId: SMART, target: townhall.tag },
                ],
            ]);
            expect(await runBehavior(world, behavior())).toEqual([
                true,
                [
                    { abilityId: MOVE, pos: townhallTarget(second.pos, worker.pos) },
                    { abilityId: SMART, target: second.tag },
                ],
            ]);
        });

        it('picks the closest townhall from every base, unfinished ones included', async () => {
            const { world, mineral, worker, second } = await setup(0.5);

            expect(await runBehavior(world, speedMining({ worker, target: mineral }))).toEqual([
                true,
                [
                    { abilityId: MOVE, pos: townhallTarget(second.pos, worker.pos) },
                    { abilityId: SMART, target: second.tag },
                ],
            ]);
        });
    });
});
