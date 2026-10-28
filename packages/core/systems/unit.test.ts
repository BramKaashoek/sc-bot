import { describe, expect, it } from 'bun:test';
import createAgent from '../agent/create-agent.ts';
import { Ability, UnitType } from '../constants/index.ts';
import { Alliance, Attribute } from '../constants/enums.ts';
import { createTestWorld, loadFixture, stepTo } from '../test/create-test-world.ts';
import type { TestWorld } from '../test/create-test-world.ts';
import type { Unit, UnitDamage, UnitTypeChange, World } from '../types.ts';

type Recorded = Array<[number, string, ...number[]]>;

function editedObservation(
    world: TestWorld,
    loop: number,
    gameLoop: number,
    edit: (units: SC2APIProtocol.Unit[]) => SC2APIProtocol.Unit[],
): SC2APIProtocol.ResponseObservation {
    const responseObservation = structuredClone(world.client.fixture.observations[loop]);
    responseObservation.observation!.gameLoop = gameLoop;
    responseObservation.observation!.rawData!.units = edit(responseObservation.observation!.rawData!.units!);
    return responseObservation;
}

function recorder() {
    const events: Record<string, Recorded> = {};
    const record =
        (name: string) =>
        async (world: World, unit: Unit, ...extra: unknown[]) => {
            const numericExtra = extra.filter((value): value is number => typeof value === 'number');
            (events[name] ??= []).push([world.resources.get().frame.getGameLoop(), unit.tag!, ...numericExtra]);
        };
    return { events, record };
}

const sortedEvents = (recorded: Recorded = []) =>
    [...recorded].sort((left, right) => left[0] - right[0] || left[1].localeCompare(right[1]));

describe('unit system events', () => {
    it('emits construction started for new unfinished own structures and complete for new finished or finishing ones', async () => {
        const { events, record } = recorder();
        const agent = createAgent({
            onBuildingConstructionStarted: record('droppedStarted'),
            onBuildingConstructionComplete: record('droppedComplete'),
            onStructureConstructionStarted: record('structureStarted'),
            onStructureConstructionComplete: record('structureComplete'),
            onUnitSpawned: record('spawned'),
        });
        const world = await createTestWorld('blueshift', { loop: 0, agent });
        const commandCenterAbilities = () => [
            ...world.resources.get().units.getByTag('4342677505')!.availableAbilities(),
        ];
        const abilitiesByLoop = [commandCenterAbilities()];

        await stepTo(world, 224);
        abilitiesByLoop.push(commandCenterAbilities());
        await stepTo(world, 896);
        abilitiesByLoop.push(commandCenterAbilities());
        const morphingWorker = '4354211841';
        await stepTo(
            world,
            editedObservation(world, 896, 900, (raws) =>
                raws.map((raw) =>
                    raw.tag === morphingWorker ? { ...raw, unitType: UnitType.HATCHERY, buildProgress: 0.1 } : raw,
                ),
            ),
        );

        const ownNonStructureTags = [0, 224, 896].flatMap((loop) =>
            world.client.fixture.observations[loop]
                .observation!.rawData!.units!.filter(
                    (raw) =>
                        raw.alliance === Alliance.SELF &&
                        !world.data.getUnitTypeData(raw.unitType!).attributes!.includes(Attribute.STRUCTURE),
                )
                .map((raw) => raw.tag!),
        );
        expect((events.spawned ?? []).map(([, tag]) => tag).sort()).toEqual([...new Set(ownNonStructureTags)].sort());
        expect(events.droppedStarted).toBeUndefined();
        expect(events.droppedComplete).toBeUndefined();

        expect(sortedEvents(events.structureStarted)).toEqual([
            [224, '4351066113'],
            [224, '4351328257'],
            [224, '4351590401'],
            [896, '4352638978'],
            [900, morphingWorker],
        ]);
        expect(abilitiesByLoop).toEqual([
            [203, 416, 417, 524, 1],
            [203, 308, 416, 524, 1],
            [203, 416, 417, 524, 1450, 1516, 1],
        ]);
        expect(sortedEvents(events.structureComplete)).toEqual([
            [0, '4342677505'],
            [224, '4350541825'],
            [224, '4350803969'],
            [896, '4351066113'],
            [896, '4351328257'],
            [896, '4351590401'],
        ]);
    });

    it('emits type changes with the previous type and damage with the health plus shield lost', async () => {
        const { events, record } = recorder();
        const agent = createAgent({
            onUnitTypeChanged: async (world: World, { unit, previousType }: UnitTypeChange) =>
                record('typeChanged')(world, unit, previousType),
            onUnitTookDamage: async (world: World, { unit, amount }: UnitDamage) =>
                record('tookDamage')(world, unit, amount),
            onUnitIsTransforming: record('transforming'),
            onUnitDamaged: record('droppedDamaged'),
        });
        const fixture = loadFixture('blueshift');
        Object.assign(fixture.observations[896].observation!.rawData!.units!.find((raw) => raw.tag === '4354211841')!, {
            shield: 50,
            shieldMax: 50,
        });
        const world = await createTestWorld(fixture, { loop: 896, agent });

        await stepTo(
            world,
            editedObservation(world, 896, 900, (raws) =>
                raws.map((raw) => {
                    if (raw.tag === '4351328257') return { ...raw, unitType: UnitType.SUPPLYDEPOTLOWERED };
                    if (raw.tag === '4354211841') return { ...raw, health: 33, shield: 40 };
                    if (raw.tag === '4342677505') return { ...raw, health: 1480 };
                    return raw;
                }),
            ),
        );

        expect(events.typeChanged).toEqual([[900, '4351328257', UnitType.SUPPLYDEPOT]]);
        expect(world.resources.get().units.getByTag('4351328257')!.unitType).toBe(UnitType.SUPPLYDEPOTLOWERED);
        expect(sortedEvents(events.tookDamage)).toEqual([
            [900, '4342677505', 20],
            [900, '4354211841', 22],
        ]);
        expect(events.transforming).toEqual([[900, '4351328257']]);
        expect(events.droppedDamaged).toBeUndefined();
    });

    it('emits enemy entered vision every time an enemy appears and left vision when it disappears, first seen only once', async () => {
        const zerglings = ['4354473985', '4354736129'];
        const { events, record } = recorder();
        const agent = createAgent({
            onEnemyUnitEnteredVision: record('entered'),
            onEnemyUnitLeftVision: record('left'),
            onEnemyFirstSeen: record('firstSeen'),
        });
        const world = await createTestWorld('blueshift', { loop: 224, agent });

        await stepTo(world, 896);
        await stepTo(
            world,
            editedObservation(world, 896, 920, (raws) => raws.filter((raw) => !zerglings.includes(raw.tag!))),
        );
        await stepTo(
            world,
            editedObservation(world, 896, 940, (raws) => raws),
        );

        const enemiesAt896 = ['4353949698', '4354473985', '4354736129', '8603041799', '8617918489', '8619032579'];
        expect(sortedEvents(events.entered)).toEqual([
            ...enemiesAt896.map((tag): [number, string] => [896, tag]),
            [940, zerglings[0]],
            [940, zerglings[1]],
        ]);
        expect(sortedEvents(events.left)).toEqual([
            [920, zerglings[0]],
            [920, zerglings[1]],
        ]);
        expect(sortedEvents(events.firstSeen)).toEqual(enemiesAt896.map((tag): [number, string] => [896, tag]));
    });

    it('keeps the previous loop army and this loop morphed enemy tags per game loop, forgetting both when a new game starts', async () => {
        const world = await createTestWorld('blueshift', { loop: 896 });
        const { units } = world.resources.get();
        const [zergling, hellion] = ['4354473985', '4354736129'];
        const armyAt896 = units
            .getCombatUnits()
            .map((unit) => unit.tag!)
            .sort();
        const [lost, moved] = armyAt896;
        const { health, pos } = units.getByTag(moved)!;
        const decoy = '4353949698';
        const tagsOfPreviousArmy = () =>
            units
                .getPreviousArmy()
                .map((unit) => unit.tag!)
                .sort();

        await stepTo(
            world,
            editedObservation(world, 896, 900, (raws) =>
                raws
                    .filter((raw) => raw.tag !== lost)
                    .map((raw) => {
                        if (raw.tag === zergling) return { ...raw, unitType: UnitType.BANELING };
                        if (raw.tag === hellion) return { ...raw, unitType: UnitType.HELLIONTANK };
                        if (raw.tag === decoy) return { ...raw, unitType: UnitType.BANELING, isHallucination: true };
                        return raw;
                    }),
            ),
        );
        const armyAt900 = tagsOfPreviousArmy();
        const morphedAt900 = [...units.getMorphedEnemyTags()].sort();
        await stepTo(
            world,
            // the unedited raws put the zergling, hellion and decoy back to their original types
            editedObservation(world, 896, 904, (raws) =>
                raws
                    .filter((raw) => raw.tag !== lost)
                    .map((raw) =>
                        raw.tag === moved
                            ? { ...raw, health: raw.health! - 1, pos: { ...raw.pos!, x: raw.pos!.x! + 1 } }
                            : raw,
                    ),
            ),
        );
        const armyAt904 = tagsOfPreviousArmy();
        const morphedAt904 = [...units.getMorphedEnemyTags()];
        const snapshot = units.getPreviousArmy().find((unit) => unit.tag === moved)!;
        const live = units.getByTag(moved)!;

        world.client.setObservation(world.client.fixture.observations[896]);
        await world.engine.setupGame();

        expect(armyAt896.length).toBeGreaterThan(1);
        expect([armyAt900, morphedAt900, armyAt904, morphedAt904]).toEqual([
            armyAt896,
            [zergling, hellion].sort(),
            armyAt896.filter((tag) => tag !== lost),
            [],
        ]);
        expect([snapshot.health, snapshot.pos]).toEqual([health, pos]);
        expect([live.health, live.pos.x]).toEqual([health! - 1, pos.x + 1]);
        expect([units.getPreviousArmy().length, units.getMorphedEnemyTags().size]).toEqual([0, 0]);
    });

    it('forgets which units were already seen when a second game starts on the same engine', async () => {
        const { events, record } = recorder();
        const agent = createAgent({ onUnitSpawned: record('spawned'), onEnemyFirstSeen: record('firstSeen') });
        const world = await createTestWorld('blueshift', { loop: 896, agent });
        const spawnedInGame1 = events.spawned.length;
        const firstSeenInGame1 = events.firstSeen.length;

        world.client.setObservation(world.client.fixture.observations[896]);
        await world.engine.setupGame();

        expect(spawnedInGame1).toBeGreaterThan(0);
        expect(firstSeenInGame1).toBeGreaterThan(0);
        expect(events.spawned).toHaveLength(spawnedInGame1 * 2);
        expect(events.firstSeen).toHaveLength(firstSeenInGame1 * 2);
    });

    it('keeps processing later own units after one of an unknown type, on both the create and update paths', async () => {
        const { events, record } = recorder();
        const agent = createAgent({
            onUnitCreated: record('created'),
            onUnitTookDamage: async (world: World, { unit, amount }: UnitDamage) =>
                record('tookDamage')(world, unit, amount),
        });
        const world = await createTestWorld('blueshift', { loop: 0, agent });
        const unknown = { ...world.client.fixture.observations[0].observation!.rawData!.units![0] };
        Object.assign(unknown, { tag: '99999', unitType: 99999, alliance: Alliance.SELF });
        const withUnknownFirst = (raws: SC2APIProtocol.Unit[]) => [unknown, ...raws];
        const worker = '4343988225';

        await stepTo(world, editedObservation(world, 224, 224, withUnknownFirst));
        await stepTo(
            world,
            editedObservation(world, 224, 228, (raws) =>
                withUnknownFirst(raws.map((raw) => (raw.tag === worker ? { ...raw, health: raw.health! - 5 } : raw))),
            ),
        );

        expect(sortedEvents(events.created).filter(([, tag]) => tag === '4351066113')).toEqual([[224, '4351066113']]);
        expect(events.tookDamage).toEqual([[228, worker, 5]]);
    });

    it('skips the per-step abilities query when asked, answering availability from abilities fetched once per game loop', async () => {
        const world = await createTestWorld('blueshift', {
            loop: 0,
            agent: createAgent({ settings: { skipAvailableAbilitiesQuery: true } }),
        });
        const abilityQueries = () =>
            world.client.sent.queries.filter((query) => (query.abilities ?? []).length > 0).length;
        const commandCenter = world.resources.get().units.getByTag('4342677505')!;

        const beforeFetch = { trainScv: commandCenter.abilityAvailable(Ability.TRAIN_SCV), queries: abilityQueries() };
        const fetched = [...(await commandCenter.fetchAvailableAbilities())];
        await commandCenter.fetchAvailableAbilities();
        const afterFetch = { trainScv: commandCenter.abilityAvailable(Ability.TRAIN_SCV), queries: abilityQueries() };
        await stepTo(world, 224);

        expect({
            beforeFetch,
            fetched,
            afterFetch,
            nextLoop: { abilities: commandCenter.availableAbilities(), queries: abilityQueries() },
        }).toEqual({
            beforeFetch: { trainScv: false, queries: 0 },
            fetched: [203, 416, 417, 524, 1],
            afterFetch: { trainScv: true, queries: 1 },
            nextLoop: { abilities: [], queries: 1 },
        });
    });
});
