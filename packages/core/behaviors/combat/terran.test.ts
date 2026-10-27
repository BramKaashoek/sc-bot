import { describe, expect, it } from 'bun:test';
import { Alliance } from '../../constants/enums.ts';
import { EFFECT_HEAL, MORPH_SIEGEMODE, MORPH_UNSIEGE, MOVE, SMART, UNLOADALLAT } from '../../constants/ability.ts';
import * as UnitType from '../../constants/unit-type.ts';
import { Units, toPoint } from '../../resources/units-collection.ts';
import { createTestWorld } from '../../test/create-test-world.ts';
import { dropCargo, medivacHeal, pickUpAndDropCargo, pickUpCargo, siegeTankDecision } from './terran.ts';
import type { TestWorld } from '../../test/create-test-world.ts';
import type { Behavior, Point2D, Unit } from '../../types.ts';

const MARINE = '4354211841';
const SCV = '4345823233';
const LINGS = ['4354473985', '4354736129'];
const OVERLORD = '4353949698';

type Sent = { abilityId?: number; target?: string; pos?: Point2D };
type Fixture = Awaited<ReturnType<typeof fixture>>;

const place = (unit: Unit, x: number, y: number) => {
    unit.pos = { x, y, z: unit.pos.z };
};

async function fixture() {
    const world = await createTestWorld('blueshift', { loop: 896 });
    const get = (tag: string) => world.resources.get().units.getByTag(tag)!;
    const unit = get(MARINE);
    place(unit, 14.4, 10.8);
    [...LINGS, SCV, OVERLORD].forEach((tag) => place(get(tag), 40, 40));
    return { world, unit, scv: get(SCV), lings: LINGS.map(get), overlord: get(OVERLORD) };
}

let owner = 0;
async function run(world: TestWorld, behavior: Behavior): Promise<[boolean, Sent[]]> {
    const { behaviors, actions } = world.resources.get();
    actions.clearQueuedActions();
    const before = world.client.sent.actions.length;
    const result = await actions.as({ owner: `case-${owner++}` }, () => behaviors.run(behavior));
    await actions.flushQueuedActions();
    const sent = world.client.sent.actions
        .slice(before)
        .flatMap(({ actions: list }) => list ?? [])
        .map(({ actionRaw }) => actionRaw!.unitCommand!)
        .map(({ abilityId, targetUnitTag, targetWorldSpacePos }) => ({
            abilityId,
            ...(targetUnitTag && { target: targetUnitTag }),
            ...(targetWorldSpacePos && { pos: targetWorldSpacePos as Point2D }),
        }));
    return [result, sent];
}

describe('terran individual behaviors', () => {
    it('medivacHeal heals the closest hurt biological ally, ignoring hurt SCVs, and respects its guards', async () => {
        const { world, unit, scv, lings } = await fixture();
        const [near, far] = lings;
        const allies = [far, near, scv];
        expect(await run(world, medivacHeal({ unit, allies }))).toEqual([false, []]);

        unit.unitType = UnitType.MEDIVAC;
        unit.isFlying = true;
        scv.health = 1;
        expect(await run(world, medivacHeal({ unit, allies }))).toEqual([false, []]);

        place(near, 15, 12);
        place(far, 20, 20);
        near.health = near.healthMax! - 1;
        far.health = far.healthMax! - 1;
        expect(await run(world, medivacHeal({ unit, allies }))).toEqual([
            true,
            [{ abilityId: EFFECT_HEAL, target: near.tag }],
        ]);

        unit.orders = [{ abilityId: EFFECT_HEAL, targetUnitTag: near.tag }];
        expect(await run(world, medivacHeal({ unit, allies }))).toEqual([true, []]);

        unit.orders = [];
        world.resources.get().influence.addCost('air', unit.pos, 3, 50);
        const [, [retreat]] = await run(world, medivacHeal({ unit, allies }));
        expect(retreat.abilityId).toBe(MOVE);
        expect(await run(world, medivacHeal({ unit, allies, keepSafe: false }))).toEqual([
            true,
            [{ abilityId: EFFECT_HEAL, target: near.tag }],
        ]);
    });

    it('pickUpCargo smarts the closest target within 5, paths otherwise, and role-switches passengers with no targets', async () => {
        const { world, unit, scv, lings } = await fixture();
        unit.unitType = UnitType.MEDIVAC;
        place(scv, 17, 10.8);
        place(lings[0], 14.4, 20);
        expect(await run(world, pickUpCargo({ unit, targets: [lings[0], scv] }))).toEqual([
            true,
            [{ abilityId: SMART, target: scv.tag }],
        ]);

        place(scv, 25, 10.8);
        const [moved, [step]] = await run(world, pickUpCargo({ unit, targets: [scv] }));
        expect([moved, step.abilityId]).toEqual([true, MOVE]);

        unit.passengers = [{ tag: scv.tag }];
        expect(await run(world, pickUpCargo({ unit, targets: [], switchCargoToRole: 'DROP_UNITS_ATTACKING' }))).toEqual(
            [false, []],
        );
        expect(
            world.resources
                .get()
                .roles.get('DROP_UNITS_ATTACKING')
                .map(({ tag }) => tag),
        ).toEqual([scv.tag]);
    });

    it('dropCargo unloads at its own position only with cargo on pathable ground', async () => {
        const { world, unit } = await fixture();
        expect(await run(world, dropCargo({ unit }))).toEqual([false, []]);

        unit.cargoSpaceTaken = 2;
        expect(await run(world, dropCargo({ unit }))).toEqual([true, [{ abilityId: UNLOADALLAT, target: unit.tag }]]);

        place(unit, 0, 0);
        expect(await run(world, dropCargo({ unit }))).toEqual([false, []]);
    });

    it('pickUpAndDropCargo picks up while empty, then carries to the target and drops there', async () => {
        const { world, unit, scv } = await fixture();
        unit.unitType = UnitType.MEDIVAC;
        place(scv, 16, 10.8);
        expect(await run(world, pickUpAndDropCargo({ unit, targets: [scv], target: { x: 30, y: 30 } }))).toEqual([
            true,
            [{ abilityId: SMART, target: scv.tag }],
        ]);

        unit.cargoSpaceTaken = 1;
        const [, [step]] = await run(world, pickUpAndDropCargo({ unit, targets: [], target: { x: 30, y: 30 } }));
        expect(step.abilityId).toBe(MOVE);

        expect(await run(world, pickUpAndDropCargo({ unit, targets: [], target: unit.pos }))).toEqual([
            true,
            [{ abilityId: UNLOADALLAT, target: unit.tag }],
        ]);
    });
});

describe('siegeTankDecision', () => {
    const SIEGED = UnitType.SIEGETANKSIEGED;
    const SIEGE: [boolean, Sent[]] = [true, [{ abilityId: MORPH_SIEGEMODE }]];
    const UNSIEGE: [boolean, Sent[]] = [true, [{ abilityId: MORPH_UNSIEGE }]];
    const HOLD: [boolean, Sent[]] = [false, []];
    const target = { x: 14.4, y: 40 };

    const decide = async (
        setup: (f: Fixture) => void,
        options: Partial<Parameters<typeof siegeTankDecision>[0]> = {},
        type: number = UnitType.SIEGETANK,
        enemies: (f: Fixture) => Unit[] = (f) => f.lings,
    ) => {
        const f = await fixture();
        f.unit.unitType = type;
        setup(f);
        return run(
            f.world,
            siegeTankDecision({ unit: f.unit, closeEnemy: [...enemies(f), f.overlord], target, ...options }),
        );
    };
    const heavyPair = ({ lings }: Fixture) => {
        place(lings[0], 14.4, 20);
        place(lings[1], 14.4, 21);
        lings.forEach((ling) => (ling.unitType = UnitType.MARAUDER));
    };

    it('ignores non-tanks', async () => {
        expect(await decide(() => {}, {}, UnitType.MARINE)).toEqual(HOLD);
    });

    it('unsieged: sieges against two heavy enemies', async () => {
        expect(await decide(heavyPair)).toEqual(SIEGE);
    });

    it('unsieged: does not siege against light enemies', async () => {
        expect(
            await decide(({ lings }) => {
                place(lings[0], 14.4, 20);
                place(lings[1], 14.4, 21);
            }),
        ).toEqual(HOLD);
    });

    it('unsieged: sieges against an enemy tank', async () => {
        expect(
            await decide(({ lings }) => {
                place(lings[0], 14.4, 20);
                lings[0].unitType = SIEGED;
            }),
        ).toEqual(SIEGE);
    });

    it('unsieged: sieges against static defence within 13', async () => {
        expect(
            await decide(({ lings }) => {
                place(lings[0], 14.4, 20);
                lings[0].unitType = UnitType.BUNKER;
            }),
        ).toEqual(SIEGE);
    });

    it('unsieged: staySiegedNearTarget sieges only within 5 of the target', async () => {
        expect(await decide(() => {}, { staySiegedNearTarget: true })).toEqual(HOLD);
        expect(await decide(({ unit }) => place(unit, 14.4, 37), { staySiegedNearTarget: true })).toEqual(SIEGE);
    });

    it('unsieged: an enemy within 6.5 or forceUnsiege blocks sieging', async () => {
        expect(
            await decide((f) => {
                heavyPair(f);
                place(f.lings[0], 14.4, 14);
            }),
        ).toEqual(HOLD);
        expect(await decide(heavyPair, { forceUnsiege: true })).toEqual(HOLD);
    });

    it('unsieged: flying enemies are ignored by their own flying state', async () => {
        expect(
            await decide(({ lings }) => {
                lings.forEach((ling, i) => {
                    place(ling, 14.4, 20 + i);
                    ling.unitType = UnitType.BATTLECRUISER;
                    ling.isFlying = true;
                });
            }),
        ).toEqual(HOLD);
    });

    it('sieged: unsieges on forceUnsiege', async () => {
        expect(await decide(() => {}, { forceUnsiege: true }, SIEGED)).toEqual(UNSIEGE);
    });

    it('sieged: unsieges when one enemy is within 4 and fewer than two within 12, else stays', async () => {
        const close = ({ lings }: Fixture) => place(lings[0], 14.4, 13);
        expect(await decide(close, {}, SIEGED)).toEqual(UNSIEGE);
        expect(
            await decide(
                (f) => {
                    close(f);
                    place(f.lings[1], 14.4, 20);
                },
                {},
                SIEGED,
            ),
        ).toEqual([true, []]);
    });

    it('sieged: remainSieged or staying within 7 of the target holds without an order', async () => {
        expect(await decide(() => {}, { remainSieged: true }, SIEGED)).toEqual(HOLD);
        expect(await decide(({ unit }) => place(unit, 14.4, 35), { staySiegedNearTarget: true }, SIEGED)).toEqual(HOLD);
    });

    it('sieged: unsieges when no relevant enemy remains and the target is far; a nearby enemy keeps it up', async () => {
        const none = () => [];
        expect(await decide(() => {}, {}, SIEGED, none)).toEqual(UNSIEGE);
        expect(await decide(() => {}, {}, SIEGED)).toEqual([true, []]);
        expect(await decide(({ unit }) => place(unit, 14.4, 30), {}, SIEGED, none)).toEqual([true, []]);
    });

    it('sieged: three own ground units between the tank and the target hold it up', async () => {
        const farTarget = { x: 14.4, y: 36 };
        const setup = async (placeAhead: boolean, count = 3) => {
            const f = await fixture();
            f.unit.unitType = SIEGED;
            place(f.unit, 14.4, 20);
            const others = f.world.resources
                .get()
                .units.getAlive(Alliance.SELF)
                .filter((u) => u.tag !== f.unit.tag);
            others.forEach((u, i) => place(u, 40, 40 + i));
            others.slice(0, count).forEach((u, i) => place(u, 14.4 + i, placeAhead ? 28 : 5));
            const { spatial, units } = f.world.resources.get();
            spatial.unitsInRange = (position, range) =>
                Units.from(
                    units
                        .getAlive(Alliance.SELF)
                        .filter(
                            ({ pos }) => Math.hypot(pos.x - toPoint(position).x, pos.y - toPoint(position).y) <= range,
                        ),
                );
            return run(f.world, siegeTankDecision({ unit: f.unit, closeEnemy: [], target: farTarget }));
        };
        expect(await setup(true)).toEqual(HOLD);
        expect(await setup(false)).toEqual(UNSIEGE);
        expect(await setup(true, 2)).toEqual(UNSIEGE);
    });
});
