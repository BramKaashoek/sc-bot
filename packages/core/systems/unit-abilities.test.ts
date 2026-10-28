import { describe, expect, it } from 'bun:test';
import { Ability, UnitType } from '../constants/index.ts';
import { Alliance } from '../constants/enums.ts';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';

describe('unit system abilities query', () => {
    it('stops asking finished burrowed tumors that had no abilities, keeping active tumors and every other own unit', async () => {
        const world = await createTestWorld('blueshift', { loop: 0 });
        const [template] = world.client.fixture.observations[0].observation!.rawData!.units!;
        const tumor = (tag: string, buildProgress: number) => ({
            ...structuredClone(template),
            tag,
            unitType: UnitType.CREEPTUMORBURROWED,
            alliance: Alliance.SELF,
            buildProgress,
            orders: [],
        });
        const [active, spent, unfinished] = ['9001', '9002', '9003'];
        const tumors = [active, spent, unfinished];
        world.client.fixture.abilities = { 0: { [active]: [Ability.BUILD_CREEPTUMOR_TUMOR] } };
        const observationWithTumors = (gameLoop: number) => {
            const observation = structuredClone(world.client.fixture.observations[0]);
            observation.observation!.gameLoop = gameLoop;
            observation.observation!.rawData!.units!.push(tumor(active, 1), tumor(spent, 1), tumor(unfinished, 0.5));
            return observation;
        };
        const queriedTags = () =>
            world.client.sent.queries.flatMap((query) => (query.abilities ?? []).map((request) => request.unitTag!));
        const { units } = world.resources.get();

        await stepTo(world, observationWithTumors(4));
        const first = queriedTags().slice(-units._units[Alliance.SELF].size);
        const sentBefore = world.client.sent.queries.length;
        await stepTo(world, observationWithTumors(8));
        const second = world.client.sent.queries
            .slice(sentBefore)
            .flatMap((query) => (query.abilities ?? []).map((request) => request.unitTag!));

        expect({
            first: first.filter((tag) => tumors.includes(tag)),
            second: second.filter((tag) => tumors.includes(tag)),
            othersListed: second.filter((tag) => !tumors.includes(tag)).length,
            activeCan: units.getByTag(active)!.abilityAvailable(Ability.BUILD_CREEPTUMOR_TUMOR),
            spentCan: units.getByTag(spent)!.abilityAvailable(Ability.BUILD_CREEPTUMOR_TUMOR),
            spentStillAUnit: units.getByTag(spent) !== undefined,
        }).toEqual({
            first: tumors,
            second: [active, unfinished],
            othersListed: first.filter((tag) => !tumors.includes(tag)).length,
            activeCan: true,
            spentCan: false,
            spentStillAUnit: true,
        });
    });
});
