import { afterAll, afterEach, describe, expect, it, spyOn } from 'bun:test';
import { Race } from '../../constants/enums.ts';
import { parseBuildOrder } from '../build-order/parse.ts';
import { parseAresBuilds, parseAresPlacements } from './ares-yaml.ts';

const fixture = (name: string) => Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();

const warn = spyOn(console, 'warn').mockImplementation(() => {});
afterEach(() => warn.mockClear());
afterAll(() => warn.mockRestore());

describe('parseAresBuilds', () => {
    for (const [name, race, unparsable] of [
        ['terran', Race.TERRAN, {}],
        ['protoss', Race.PROTOSS, { OneBaseTempests: 'unknown command "TEMPESTGROUNDATTACKUPGRADE"' }],
        ['zerg', Race.ZERG, {}],
    ] as const) {
        it(`loads ares' ${name} example builds, and every opening parses except the ones with an unknown step`, async () => {
            const settings = parseAresBuilds(await fixture(`${name}_builds.yml`));

            expect(settings).toMatchObject({ dataDir: './data', method: 'winrate' });
            expect(Object.keys(settings.choices!)).toEqual(['test_123', 'Protoss', 'Random', 'Terran', 'Zerg']);
            const failures: Record<string, string> = {};
            for (const [opening, { buildOrder }] of Object.entries(settings.builds!)) {
                try {
                    parseBuildOrder(buildOrder, race);
                } catch (err) {
                    failures[opening] = (err as Error).message;
                }
            }
            expect(failures).toEqual(
                Object.fromEntries(
                    Object.entries(unparsable).map(([opening, text]) => [opening, expect.stringContaining(text)]),
                ),
            );
            expect(warn).not.toHaveBeenCalled();
        });
    }

    it('maps every build key and the selection settings, and warns on unknown keys', () => {
        const settings = parseAresBuilds(`
UseData: False
BuildSelection: Cycle
MinGamesWinrateBased: 5
Surprise: 1
BuildChoices:
    Zerg:
        BotName: ZergRace
        Cycle: [Quick, Slow]
        Extra: 1
Builds:
    Quick:
        OpeningBuildOrder:
            - 12 drone
            - 14 worker_scout:
                [ third, enemy_nat ]
        AutoSupplyAtSupply: 30
        ConstantWorkerProductionTill: 40
        PersistentWorker: True
        ShouldHandleGasSteal: False
        Flavour: spicy
    Slow:
        OpeningBuildOrder: [ 13 overlord ]
`);

        expect(settings).toEqual({
            method: 'cycle',
            minGames: 5,
            choices: { Zerg: ['Quick', 'Slow'] },
            builds: {
                Quick: {
                    buildOrder: ['12 drone', { '14 worker_scout': ['third', 'enemy_nat'] }],
                    autoSupplyAtSupply: 30,
                    constantWorkerProductionTill: 40,
                    persistentWorker: true,
                    shouldHandleGasSteal: false,
                },
                Slow: { buildOrder: ['13 overlord'] },
            },
        });
        expect(parseAresBuilds('UseData: False\nBuildSelection: WinrateBased')).toEqual({});
        expect(warn.mock.calls).toEqual([
            ['Unknown key "Surprise" in ares builds'],
            ['Unknown key "Extra" in ares BuildChoices.Zerg'],
            ['Unknown key "Flavour" in ares build "Quick"'],
        ]);
    });

    it('rejects malformed YAML and a build without an opening build order', () => {
        expect(() => parseAresBuilds('Builds: [')).toThrow(/Malformed ares builds YAML: .*YAML/);
        expect(() => parseAresBuilds('Builds:\n  Lonely:\n    AutoSupplyAtSupply: 3')).toThrow('"Lonely"');
    });
});

describe('parseAresPlacements', () => {
    it("flattens ares' point groups, spot-checked against the shipped Protoss data", async () => {
        const table = parseAresPlacements(
            await Bun.file(new URL('../../data/protoss_building_placements.yml', import.meta.url)).text(),
        );

        expect(Object.keys(table)).toHaveLength(7);
        expect(table.Persephone.UpperSpawn!.VsZerg).toEqual({
            FirstPylon: [[69, 144]],
            ThreeByThreesWall: [
                [71.5, 138.5],
                [73.5, 142.5],
                [74.5, 145.5],
            ],
            StaticDefencesWall: [[68, 140]],
            GateKeeper: [[72.5, 140.5]],
        });
        expect(warn).not.toHaveBeenCalled();
    });

    it('accepts a single point, a list and nested groups, and skips and warns on unknown keys', () => {
        expect(
            parseAresPlacements(`
Pylon:
    LowerSpawn:
        VsAll:
            SupplyDepots: [1, 2]
            Production: [[3, 4], [5, 6]]
            Bogus: [[7, 8]]
            SensorTowers:
                - [[9, 10]]
                - [[11, 12], [13, 14]]
    Sideways:
        VsAll: {}
`),
        ).toEqual({
            Pylon: {
                LowerSpawn: {
                    VsAll: {
                        SupplyDepots: [[1, 2]],
                        Production: [
                            [3, 4],
                            [5, 6],
                        ],
                        SensorTowers: [
                            [9, 10],
                            [11, 12],
                            [13, 14],
                        ],
                    },
                },
            },
        });
        expect(warn.mock.calls).toEqual([
            ['Unknown building placement key "Bogus" in ares placements for "Pylon"'],
            ['Unknown spawn key "Sideways" in ares placements for "Pylon"'],
        ]);
    });
});
