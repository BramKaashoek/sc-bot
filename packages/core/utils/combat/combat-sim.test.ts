import { describe, expect, it } from 'bun:test';
import { UnitType } from '../../constants/index.ts';
import { Alliance } from '../../constants/enums.ts';
import {
    LOSS_CLOSE,
    LOSS_DECISIVE,
    LOSS_EMPHATIC,
    LOSS_MARGINAL,
    LOSS_OVERWHELMING,
    TIE,
    VICTORY_CLOSE,
    VICTORY_DECISIVE,
    VICTORY_EMPHATIC,
    VICTORY_MARGINAL,
    VICTORY_OVERWHELMING,
} from '../../constants/engagement-result.ts';
import { createTestWorld, loadFixture } from '../../test/create-test-world.ts';
import { observation, rawUnit, toyFixture } from '../../test/factories.ts';
import type { Unit } from '../../types.ts';
import { canWinFight, type FightSimulation, simulateFight, toEngagementResult } from './combat-sim.ts';

const data = loadFixture('simple64').data;

const stats: Record<number, SC2APIProtocol.Unit> = {
    [UnitType.MARINE]: { health: 45, healthMax: 45, radius: 0.375 },
    [UnitType.ZERGLING]: { health: 35, healthMax: 35, radius: 0.375 },
    [UnitType.VIKINGFIGHTER]: { health: 135, healthMax: 135, radius: 0.75, isFlying: true },
    [UnitType.SIEGETANKSIEGED]: { health: 175, healthMax: 175, radius: 0.875 },
    [UnitType.ZEALOT]: { health: 100, healthMax: 100, shield: 50, shieldMax: 50, radius: 0.5 },
    [UnitType.SCV]: { health: 45, healthMax: 45, radius: 0.375 },
    [UnitType.MUTALISK]: { health: 120, healthMax: 120, radius: 0.5, isFlying: true },
};

const squad = (unitType: number, count: number, x: number, overrides: SC2APIProtocol.Unit = {}) =>
    Array.from({ length: count }, (_, index) =>
        rawUnit({
            unitType,
            ...stats[unitType],
            pos: { x: x + Math.floor(index / 10) * 0.75, y: 8 + (index % 10) * 0.75, z: 10 },
            ...overrides,
        }),
    );

const enemy = (raws: SC2APIProtocol.Unit[]) => raws.map((raw) => ({ ...raw, alliance: Alliance.ENEMY, owner: 2 }));

async function armies(own: SC2APIProtocol.Unit[], foes: SC2APIProtocol.Unit[]): Promise<[Unit[], Unit[]]> {
    const fixture = toyFixture();
    fixture.data = data;
    fixture.observations[0] = observation({
        units: [...fixture.observations[0].observation!.rawData!.units!, ...own, ...foes],
    });
    const world = await createTestWorld(fixture);
    const units = (raws: SC2APIProtocol.Unit[]) => raws.map((raw) => world.resources.get().units.getByTag(raw.tag!)!);
    return [units(own), units(foes)];
}

const outcome = (ownWins: boolean, ownFraction: number, enemyFraction: number): FightSimulation => ({
    ownWins,
    ownHealthLeft: ownFraction * 100,
    enemyHealthLeft: enemyFraction * 100,
    ownHealthStart: 100,
    enemyHealthStart: 100,
    seconds: 1,
});

describe('canWinFight', () => {
    it('predicts the scripted fights', async () => {
        const mixed = (x: number) => [...squad(UnitType.MARINE, 4, x), ...squad(UnitType.ZERGLING, 4, x + 1)];

        expect(
            canWinFight(...(await armies(squad(UnitType.MARINE, 10, 10), enemy(squad(UnitType.ZERGLING, 4, 14))))),
        ).toBeGreaterThanOrEqual(VICTORY_DECISIVE);
        expect(
            canWinFight(...(await armies(squad(UnitType.MARINE, 4, 16), enemy(squad(UnitType.ZERGLING, 8, 16))))),
        ).toBeLessThan(TIE);
        expect(
            canWinFight(...(await armies(squad(UnitType.MARINE, 1, 16), enemy(squad(UnitType.MARINE, 1, 18))))),
        ).toBe(TIE);
        expect(canWinFight(...(await armies(mixed(10), enemy(mixed(10)))))).toBe(TIE);
        expect(
            canWinFight(...(await armies(squad(UnitType.VIKINGFIGHTER, 5, 10), enemy(squad(UnitType.MARINE, 5, 14))))),
        ).toBe(LOSS_EMPHATIC);
        expect(
            canWinFight(...(await armies(squad(UnitType.SCV, 20, 10), enemy(squad(UnitType.MUTALISK, 1, 12)))), {
                workersDoNoDamage: true,
            }),
        ).toBeLessThan(TIE);
        expect(
            canWinFight(
                ...(await armies(
                    squad(UnitType.MARINE, 8, 10, { attackUpgradeLevel: 1 }),
                    enemy(squad(UnitType.MARINE, 8, 14)),
                )),
            ),
        ).toBeGreaterThan(TIE);

        const [marines, lings] = await armies(squad(UnitType.MARINE, 2, 10), enemy(squad(UnitType.ZERGLING, 2, 12)));
        const [zealots, vikings] = await armies(
            squad(UnitType.ZEALOT, 1, 10),
            enemy(squad(UnitType.VIKINGFIGHTER, 2, 12)),
        );

        expect(canWinFight(marines, [])).toBe(VICTORY_EMPHATIC);
        expect(canWinFight([], lings)).toBe(LOSS_EMPHATIC);
        expect(canWinFight([], [])).toBe(TIE);
        expect(simulateFight(marines, lings, { maxSeconds: 1 }).ownWins).toBe(true);
        expect(simulateFight(zealots, vikings)).toMatchObject({
            ownHealthStart: 150,
            enemyHealthStart: 270,
            seconds: 0,
        });
        expect(canWinFight(zealots, vikings)).toBe(TIE);
    });

    it('lets a sieged tank win only when the zealot has to walk in first', async () => {
        const [tank, zealots] = await armies(
            squad(UnitType.SIEGETANKSIEGED, 1, 4),
            enemy(squad(UnitType.ZEALOT, 1, 16)),
        );

        const adjusted = simulateFight(tank, zealots, { timingAdjust: true });
        const flat = simulateFight(tank, zealots, { timingAdjust: false });

        expect(adjusted.ownWins).toBe(true);
        expect(flat.ownHealthLeft).toBeLessThan(adjusted.ownHealthLeft);

        const [farTank, closingMarines] = await armies(
            squad(UnitType.SIEGETANKSIEGED, 1, 4),
            enemy(squad(UnitType.MARINE, 3, 20.5)),
        );
        const [nearTank, huggingMarines] = await armies(
            squad(UnitType.SIEGETANKSIEGED, 1, 4),
            enemy(squad(UnitType.MARINE, 3, 4.5)),
        );

        expect(simulateFight(farTank, closingMarines).enemyHealthLeft).toBeLessThan(135);
        expect(simulateFight(nearTank, huggingMarines).enemyHealthLeft).toBe(135);
    });

    it('buckets wins by own health left and losses by enemy health left', () => {
        const wins = [0.9, 0.8999, 0.75, 0.6, 0.4001, 0.4, 0.2001, 0.2].map((f) =>
            toEngagementResult(outcome(true, f, 0)),
        );
        const losses = [0.9, 0.75, 0.7499, 0.6001, 0.6, 0.4, 0.2001, 0.2].map((f) =>
            toEngagementResult(outcome(false, 0, f)),
        );

        expect(wins).toEqual([
            VICTORY_EMPHATIC,
            VICTORY_OVERWHELMING,
            VICTORY_OVERWHELMING,
            VICTORY_DECISIVE,
            VICTORY_CLOSE,
            VICTORY_MARGINAL,
            VICTORY_MARGINAL,
            TIE,
        ]);
        expect(losses).toEqual([
            LOSS_EMPHATIC,
            LOSS_OVERWHELMING,
            LOSS_DECISIVE,
            LOSS_DECISIVE,
            LOSS_CLOSE,
            LOSS_MARGINAL,
            LOSS_MARGINAL,
            TIE,
        ]);
    });
});
