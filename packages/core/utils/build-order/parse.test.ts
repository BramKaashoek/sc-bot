import { describe, expect, it } from 'bun:test';
import * as Ability from '../../constants/ability.ts';
import { Race } from '../../constants/enums.ts';
import * as UnitType from '../../constants/unit-type.ts';
import * as Upgrade from '../../constants/upgrade.ts';
import { NodeSC2Error } from '../../engine/errors.ts';
import { parseBuildOrder } from './parse.ts';

const build = (id: number, opts = {}) => ({ type: 'build' as const, id, qty: 1, opts });
const train = (id: number, opts = {}) => ({ type: 'train' as const, id, qty: 1, opts });
const ability = (id: number, opts = {}) => ({ type: 'ability' as const, id, qty: 1, opts });

describe('parseBuildOrder', () => {
    it('compiles an ares-style Terran opening, passing existing tasks through', () => {
        const existing = { type: 'upgrade' as const, id: Upgrade.SHIELDWALL, qty: 1 };
        const tuple: [number, typeof existing] = [40, existing];

        const parsed = parseBuildOrder(
            [
                '14 supply @ ramp',
                '16 BARRACKS @RAMP',
                '16 gas @ nat',
                '19 Orbital',
                '19 reaper',
                '20 expand nat',
                '20 worker_scout',
                '21 factory',
                '22 addonswap factory barracksreactor',
                '22 marine x2',
                '23 stimpack x0',
                '24 cancel_gas',
                '25 mule',
                'twenty bunker @ nat',
                tuple,
                existing,
            ],
            Race.TERRAN,
        );

        expect(parsed).toEqual([
            [14, build(UnitType.SUPPLYDEPOT, { at: 'RAMP' })],
            [16, build(UnitType.BARRACKS, { at: 'RAMP' })],
            [16, build(UnitType.REFINERY)],
            [19, ability(Ability.MORPH_ORBITALCOMMAND)],
            [19, train(UnitType.REAPER)],
            [20, build(UnitType.COMMANDCENTER, { at: 'NAT' })],
            [20, { type: 'scout', opts: { scout: 'worker', waypoints: ['ENEMY_SPAWN'] } }],
            [21, build(UnitType.FACTORY)],
            [22, { type: 'addonSwap', id: UnitType.FACTORY, qty: 1, opts: { addon: UnitType.BARRACKSREACTOR } }],
            [22, train(UnitType.MARINE)],
            [22, train(UnitType.MARINE)],
            [23, { type: 'upgrade', id: Upgrade.STIMPACK, qty: 1 }],
            [24, ability(Ability.CANCEL_BUILDINPROGRESS, { on: UnitType.REFINERY })],
            [25, train(UnitType.MULE)],
            [0, build(UnitType.BUNKER, { at: 'NAT' })],
            tuple,
            existing,
        ]);
        expect((parsed[9] as [number, object])[1]).not.toBe((parsed[10] as [number, object])[1]);
        expect(parsed.at(-2)).toBe(tuple);
        expect(parsed.at(-1)).toBe(existing);
    });

    it.each([
        [
            Race.TERRAN,
            build(UnitType.SUPPLYDEPOT),
            build(UnitType.REFINERY),
            build(UnitType.COMMANDCENTER),
            UnitType.SCV,
        ],
        [Race.PROTOSS, build(UnitType.PYLON), build(UnitType.ASSIMILATOR), build(UnitType.NEXUS), UnitType.PROBE],
        [Race.ZERG, train(UnitType.OVERLORD), build(UnitType.EXTRACTOR), build(UnitType.HATCHERY), UnitType.DRONE],
    ])('compiles SUPPLY, GAS, EXPAND and WORKER for race %p', (race, supply, gas, expand, worker) => {
        expect(parseBuildOrder(['1 supply', '2 gas', '3 expand', '4 worker'], race)).toEqual([
            [1, supply],
            [2, gas],
            [3, expand],
            [4, train(worker)],
        ]);
    });

    it('compiles the Protoss and Zerg options and morphs', () => {
        expect(
            parseBuildOrder(
                [
                    '16 gate',
                    '17 core',
                    '18 chrono @ nexus',
                    '19 chrono core *3',
                    '30 lair',
                    '40 hive',
                    '13 overlord_scout',
                ],
                Race.PROTOSS,
            ),
        ).toEqual([
            [16, build(UnitType.GATEWAY)],
            [17, build(UnitType.CYBERNETICSCORE)],
            [18, ability(Ability.EFFECT_CHRONOBOOSTENERGYCOST, { target: UnitType.NEXUS })],
            ...Array(3).fill([19, ability(Ability.EFFECT_CHRONOBOOSTENERGYCOST, { target: UnitType.CYBERNETICSCORE })]),
            [30, ability(Ability.MORPH_LAIR)],
            [40, ability(Ability.MORPH_HIVE)],
            [13, { type: 'scout', opts: { scout: 'overlord', waypoints: ['ENEMY_NAT_VISION'] } }],
        ]);
    });

    it('gives a dict scout step the listed waypoints', () => {
        expect(parseBuildOrder([{ '14 worker_scout': ['spawn', 'enemy_nat', 'ENEMY_SPAWN'] }], Race.TERRAN)).toEqual([
            [14, { type: 'scout', opts: { scout: 'worker', waypoints: ['SPAWN', 'ENEMY_NAT', 'ENEMY_SPAWN'] } }],
        ]);
    });

    it.each([
        ['14 pylonz', 'unknown command "PYLONZ"'],
        ['14 supply @ moon', 'unknown target "MOON"'],
        ['14 overlord_scout @ enemy_nat_hg_spot', 'ENEMY_NAT_HG_SPOT is not supported'],
        [{ '14 worker_scout': ['nowhere'] }, 'unknown target "NOWHERE"'],
        ['21 addonswap factory', 'ADDONSWAP needs exactly 2 structures'],
        ['21 addonswap factory marine', '"marine" is not a structure'],
        ['18 chrono', 'CHRONO needs a unit type target'],
        ['16 tempestgroundattackupgrade', 'unknown command "TEMPESTGROUNDATTACKUPGRADE"'],
    ])('throws a NodeSC2Error naming the step for %p', (step, reason) => {
        const parse = () => parseBuildOrder([step], Race.PROTOSS);
        expect(parse).toThrow(NodeSC2Error);
        expect(parse).toThrow(reason);
        expect(parse).toThrow(typeof step === 'string' ? step : Object.keys(step)[0]);
    });
});
