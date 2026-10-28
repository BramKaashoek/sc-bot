# Resources and the world

The world is the context of one engine's games, and the first argument of every handler (`onStep`, `onUnitCreated`, a system's `setup`, a behavior). It holds your agent, the game data, the config and the resources: the objects that own the game state and the services around it (units, map, actions, events, and so on), shared by every agent and system. Most handlers only need `resources.get()`, best destructured to the resources the routine uses.

A resource is registered once, from a definition (`name`, `create`, and optional `reset`, `onStep` and `onGameEnd` hooks), and is a long-lived object: the engine keeps it when another game starts and resets it in place, so a reference you hold stays valid. The built-in ones are all registered by the engine; you can register your own.

This page owns three rules that the resource pages only link to: the [per-game reset](#per-game-reset), the [registry](#registry) and the [settings that survive a new game](#per-game-reset). Resources documented elsewhere are listed under [`resources.get()`](#resourcesget).

## World

```ts
// signature sketch
interface World {
    agent: Agent;
    data: DataStorage;
    resources: ResourceManager;
    config: Readonly<CoreConfig>;
    baseBuild?: number;
}
```

- `world.agent` is your agent, with player data such as minerals and supply (see [agents.md](agents.md)).
- `world.data` is the game data from SC2, plus the [earmarks](#worlddata-and-earmarks).
- `world.resources` is the [registry](#registry).
- `world.config` is the [config](running-games.md#config-file) the engine resolved: `{ gameStep: number; features: { chatDebug: boolean; eagerMapAnalysis: boolean }; resources: ResourceSettings }`, defaulting to `4`, `false`, `true` and `{}`. `ResourceSettings` maps a resource name to the settings type of its `configure`. Only the top level is frozen (a shallow `Object.freeze`), so don't mutate `features` or `resources` either.
- `world.baseBuild` is the SC2 build number from the connection's ping. It is unset until `engine.connect()` resolves.

```ts
import { createAgent } from '@sc-bot/core';

createAgent({
    async onGameStart({ agent }) {
        console.log(`My race this game is ${agent.race}`);
    },
});
```

## `resources.get()`

#### `resources.get() => Readonly<ResourceContainer>`

Returns every resource; destructure what you need:

```ts
import type { World } from '@sc-bot/core';

export async function onStep({ resources }: World) {
    const { actions, frame, map, units, debug } = resources.get();
}
```

`ResourceContainer` (in [`types.ts`](../types.ts)) declares these 19 resources, plus the optional `debug` and `placer`:

| Resource | Holds | Page |
|---|---|---|
| `actions` | commands to SC2 and command arbitration | [commands.md](commands.md#actions) |
| `events` | the event channel | [events](#events) below |
| `frame` | the current observation | [frame](#frame) below |
| `map` | grids, expansions, ramps, placement and pathing queries | [map.md](map.md#map) |
| `units` | every known unit, as chainable collections | [units.md](units.md#units) |
| `memory` | enemies that left vision | [units.md](units.md#memory) |
| `spatial` | range queries over units | [units.md](units.md#spatial) |
| `influence` | influence and weight grids | [map.md](map.md#influence) |
| `pathing` | paths, safe spots and next-point queries over the influence layers | [map.md](map.md#pathing) |
| `mapAnalysis` | chokes, regions and defensive positions | [map.md](map.md#mapanalysis) |
| `roles` | unit roles | [combat.md](combat.md#roles) |
| `squads` | squads | [combat.md](combat.md#squads) |
| `intel` | base threats, intel flags and enemy detection | [combat.md](combat.md#intel) |
| `placement` | building placement | [macro.md](macro.md#placement) |
| `buildings` | tracked builds | [macro.md](macro.md#buildings) |
| `mining` | worker assignment | [macro.md](macro.md#mining) |
| `flying` | flying structures | [macro.md](macro.md#flying) |
| `behaviors` | runs [behaviors](behaviors.md) | [behaviors.md](behaviors.md#running-a-behavior) |
| `openings` | opening selection | [build-orders.md](build-orders.md#openings) |
| `debug` | debug drawing and cheats | [debug](#debug) below |
| `placer` | your own placement hooks | [macro.md](macro.md#placer) |

`debug` is typed as optional but the engine always registers it. `placer` isn't registered by anyone: set it yourself, with `resources.set({ placer })`.

## Registry

`world.resources` is the registry that creates, resets and steps the resources. Every definition is kept in registration order, which is also the order of reset, `onStep` and `onGameEnd`. The built-ins register in this order: `frame`, `map`, `debug`, `units`, `events`, `actions`, `memory`, `spatial`, `influence`, `pathing`, `roles`, `squads`, `intel`, `placement`, `buildings`, `mining`, `flying`, `mapAnalysis`, `behaviors`, `openings`.

#### `resources.register<K>(definition: ResourceDefinition<K>) => NonNullable<ResourceContainer[K]>`

Creates and stores a resource from `{ name: K, create(world), reset?(resource, world), onStep?(resource, world), onGameEnd?(resource, world, results) }`, applies its [config section](running-games.md#config-file) and returns it. Registering the same definition object again returns the existing resource, so it is safe to call from a system's `setup`, which runs every game. Registering another definition under a taken name throws `NodeSC2Error`.

#### `resources.set(resources: Partial<ResourceContainer>) => void`

Assigns the given resources without registering a definition. They are never reset, stepped or told the game ended. This is how you hand the engine a `placer`.

#### `resources.reset(world: World) => void`

Resets every registered resource, see [Per-game reset](#per-game-reset). The engine calls it when another game starts on the same engine; you shouldn't.

#### `resources.step(world: World) => void`

Runs every definition's `onStep(resource, world)`, in registration order. The engine calls it once per step, after the engine systems and before your agent's handlers. An error thrown by a hook is logged (on `sc2:debug:resources`, plus a `console.warn` unless it is a `NodeSC2Error`, see [Debugging](running-games.md#debugging)) and doesn't stop the next one, except a `GameEndedError` or `ConnectionClosedError`, which end the game.

#### `resources.endGame(world: World, results: PlayerResult[]) => void`

Runs every definition's `onGameEnd(resource, world, results)` synchronously, in registration order. A throwing hook is logged on `sc2:debug:resources` and the next one still runs. The engine calls it when a game ends, before the `onGameEnd` option of `createEngine`; you shouldn't. A game that crashes or loses its connection (`ConnectionClosedError` or an unknown error) never reaches it, so persist per-game data you can't lose some other way. A replay ends the same as a game, so check for it yourself.

## Per-game reset

The first game on an engine resets nothing. From the second game on, before any system's `setup` runs, the engine does the following, in this order:

1. Every registered resource is reset in registration order, keeping its identity, so references from `resources.get()` stay valid. Its `reset(resource, world)` runs when the definition has one; without it, a fresh `create(world)` is assigned onto the existing object. Right after, its `config.resources.<name>` section is passed to its `configure()` again. Resources added with `resources.set()` are left alone.
2. `world.data`'s earmarks are emptied. The rest of the data is loaded again from SC2.
3. Every system's `setup` runs. A system comes back unpaused, with its `state` set to a deep copy of the `state` it was created with and its step timing reset, and a build system's `buildOptions` (`paused`, `earmarks`, `fillWorkers`) back to their initial values. The build and unit plugins are applied only once, so a build order still runs once per step.

For the built-ins this means: `units` has every store emptied (so no enemy memory from the previous game), `actions` drops its queued commands, `frame` resets its step times, and `map`, `debug` (its drawings), `events` (readers and unread events; the systems register new readers in their `setup`) and every other resource without a `reset` are recreated. The other resource pages say what they forget: caches, flags, plans, builds, spots.

**Settings survive a new game.** Settings set through `configure()` are kept by the ten resources that have one: `memory`, `influence`, `roles`, `intel`, `placement`, `buildings`, `mining`, `flying`, `mapAnalysis` and `openings`. Their pages list the settings, and don't repeat this. Step 1 means the config file's (or `createEngine({ config })`'s) section for a resource is applied again after every reset, so it wins over your own `configure()` call made earlier. A bot that wants its own values calls `configure()` from `setup` or `onGameStart`, which run after the reset; a single call made once after `createEngine` is overwritten by the config section from the second game on. A config section for a resource without `configure()` is ignored with a warning.

## Custom resources

Register a resource from a system's `setup`. Declare its type by augmenting the `ResourceContainer` interface of `@sc-bot/core/types` (augmenting `@sc-bot/core` itself doesn't merge). The key is typed as present before `register` has run, so register it before anything reads it.

A definition can also have `onStep(resource, world)`, run every step (see `resources.step`), and `onGameEnd(resource, world, results)`, run when a game ends. `reset` is optional too, see [Per-game reset](#per-game-reset).

```ts
import { createSystem } from '@sc-bot/core';
import type { ResourceDefinition, Unit, World } from '@sc-bot/core';

declare module '@sc-bot/core/types' {
    interface ResourceContainer {
        sightings: { tags: Set<string> };
    }
}

const sightings: ResourceDefinition<'sightings'> = {
    name: 'sightings',
    create: () => ({ tags: new Set() }),
    reset: (resource) => resource.tags.clear(),
};

export const scouting = createSystem({
    name: 'Scouting',
    setup(world: World) {
        world.resources.register(sightings);
    },
    async onEnemyFirstSeen({ resources }: World, enemy: Unit) {
        resources.get().sightings.tags.add(enemy.tag!);
    },
});
```

## frame

`frame` gives synchronous access to the current observation. The engine's frame system fills it each step, so the raw accessors are only meaningful once the game has started.

#### `frame.getGameLoop() => number`

The current game loop. A system's `onStep` receives the same value as its second argument, except in realtime, where the argument is the previous loop plus `gameStep` while no step is taken.

#### `frame.time() => number`, `frame.timeFormatted() => string`

Game seconds (the game loop divided by [`GAME_LOOPS_PER_SECOND`](constants.md#constantstime)), and the same as `'MM:SS'`.

#### `frame.getObservation()`, `frame.getGameInfo()`, `frame.getMapState()`, `frame.getRender()`, `frame.getFeatureLayer()`

The raw `SC2APIProtocol.Observation`, `ResponseGameInfo`, `MapState` (the `ImageData` for visibility and creep), `ObservationRender` and `ObservationFeatureLayer`. The game info is only read at the start of the game. Render and feature-layer data need them enabled in the agent's `interface`.

#### `frame.getPrevious() => GameFrame`

The previous step's frame, which holds only its game loop: `{ _gameLoop }`.

#### `frame.getScore() => Score | undefined`

The score observation; needs `score: true` in the agent's `interface` (the default has it).

#### `frame.getAlerts() => Alert[]`, `frame.hasAlert(alert: Alert) => boolean`

Alerts such as a detected nuke. `[]` when there is no observation yet.

#### `frame.getActionErrors() => ActionError[]`

Commands SC2 rejected in the last step.

#### `frame.getEffects() => Effect[]`

Active effects, from the observation (it throws before the first one).

#### `frame.getStepTime() => { min, avg, max, last }`

Milliseconds spent in your agent's `onStep` handler (`avg` is `0` before the first step). Reset at every new game.

```ts
import type { World } from '@sc-bot/core';
import { Alert } from '@sc-bot/core/constants/enums';
import { MARINE } from '@sc-bot/core/constants/unit-type';

export async function onStep({ agent, resources }: World) {
    const { frame, debug, map } = resources.get();

    if (frame.hasAlert(Alert.NUCLEARLAUNCHDETECTED)) console.log('nuke incoming');
    frame.getActionErrors().forEach((error) => console.log('rejected', error.abilityId, error.result));

    const { avg, max } = frame.getStepTime();
    console.log(`${frame.timeFormatted()} step avg ${avg.toFixed(1)}ms, max ${max.toFixed(1)}ms`);

    if (frame.getGameLoop() < 10 && debug) {
        await debug.createUnit({ unitType: MARINE, quantity: 5, pos: map.getMain().townhallPosition, playerId: agent.playerId });
        await debug.showMap();
        debug.drawBox({ x: 10, y: 10, z: 12 }, { x: 12, y: 12, z: 14 });
    }
}
```

## debug

`debug` wraps SC2's debug interface, for testing and development. It is typed as optional on the resource container, so check it or use `debug!`. Drawings are sent by the engine's debug system at the end of a step, and only in steps where something was drawn; they stay in the resource until removed and are re-sent whenever any drawing changes.

#### `debug.createUnit(request: DebugUnitRequest | DebugUnitRequest[]) => Promise<ResponseDebug>`

Spawns units. A request is `{ unitType, quantity = 1, pos = a random placeable cell in your main, playerId = you }`.

#### `debug.killUnit(units: Unit | Unit[])`, `debug.setUnitValue(units: Unit | Unit[], unitValue, value: number)`

Kill units, or set one of their energy, life or shields (`unitValue` is a `DebugSetUnitValue_UnitValue`).

#### `debug.showMap()`, `controlEnemy()`, `food()`, `free()`, `allResources()`, `god()`, `minerals()`, `gas()`, `cooldown()`, `techTree()`, `upgrade()`, `fastBuild()`

The game's cheats, each sent as one game-state request.

#### `debug.moveCamera(target: Unit | Point2D)`

Centers the camera on a unit or point.

#### `debug.drawBox(min: Point, max: Point, color = Color.WHITE) => void`

Draws a box for the current step only.

#### `debug.setDrawCells(id, cells, opts?)`, `setDrawSpheres(id, spheres, opts?)`, `setDrawLines(id, lines, opts?)`, `setDrawTextWorld(id, texts, opts?)`, `setDrawTextScreen(id, texts, opts?)`

Drawings keyed by `id`: calling again with the same id replaces the previous drawing, and an empty list leaves it as it was. With `opts.temp` (spheres and world text) a drawing is sent for one step only. Cell, sphere and line drawings add a text label per shape unless `opts.includeText` is `false`. The shapes and options are the `ShapeDrawFn`, `TextDrawFn` and `LineDrawFn` types in `types.ts`.

#### `debug.removeCommand(id: string) => void`

Removes the drawing with that id, and its label `<id>-text-0`.

#### `debug.useDebugWidget(id: string, data: unknown, opts: { title?: string }) => void`

Sets one entry of the on-screen debug widget, keyed by `id` and titled `opts.title` (the id by default). The widget is only drawn when the `sc2:DebugWidget` namespace is enabled, see [Debugging](running-games.md#debugging).

#### `debug.quickSave() => Promise<unknown>`, `debug.quickLoad() => Promise<unknown>`

Single-player only.

`debug.updateScreen()` and `debug.setRegions(expansions)` belong to the engine's debug system.

### Chat commands

With `features.chatDebug` on (see [Config file](running-games.md#config-file); off by default, so an opponent's or a ladder game's chat can't trigger anything), the engine reads your own chat as debug commands, using ares-sc2's aliases. They are case-insensitive, other players' chat and other messages are ignored, and nothing is ever sent as a unit command. A malformed command, such as an unknown unit name, a missing argument, a count that isn't a positive integer or a bad player id, is answered in chat with the reason.

| Chat | Effect |
|---|---|
| `create \| make <count> <UnitType> [playerId]` | Spawns units at the camera (the map centre when there is no camera) for you, or for that player. |
| `kill \| destroy <count> <UnitType> [playerId]` | Kills the first `count` units of that type: yours, or that player's visible ones. Replies "Can't find any of those" when there are none. |
| `cooldown` | `debug.cooldown()` |
| `food` \| `supply` | `debug.food()` |
| `god` | `debug.god()` |
| `resources` \| `money` | `debug.allResources()` |
| `reveal` \| `show` \| `show-map` | `debug.showMap()` |
| `tech` \| `tech-tree` | `debug.techTree()` |
| `upgrades` | `debug.upgrade()` |

`<UnitType>` is a name from the unit-type constants, such as `MARINE` or `ZERGLING`, in any case; one trailing `s` is accepted (`marines`). `kill` with your own player id acts on your units. With another player's id it picks among that player's currently visible units; remembered ones out of sight are skipped.

## events

`events` is the event channel that delivers events to the engine, agents and systems. Which events exist and what they carry is in [agents.md](agents.md#events); this is the channel itself, which you only touch to write [custom events](agents.md#custom-events).

#### `events.write(event: SystemEventData, readerId?: ReaderId) => void`

Publishes `{ name, data?, type? }`. `type` is `'agent'` by default and picks who receives it: readers of that type, or every reader for `'all'`. `data` is `event.data || null`, so any falsy value (`0`, `''`, `false`) becomes `null`. The event is stamped with the current game loop and kept until every reader it was written for has read it. With `readerId`, that reader is left out, so a writer doesn't receive its own event. An event written with `type: 'build'` or `'unit'` reaches readers created with `'build'`, `'unit'` or `'agent'` (all three are the agent reader group), and the delivered event keeps the type it was written with.

#### `events.createReader(type?: EventType = 'agent') => ReaderId`

Registers a reader. `'build'` and `'unit'` are stored as `'agent'`; `'engine'`, `'agent'` and `'all'` are kept as given. The engine and each system create theirs in `setup`.

#### `events.read(readerId: ReaderId) => SystemEvent[]`

Returns the reader's unread events and marks them read.

#### `events.removeReader(readerId: ReaderId) => void`

Stops delivering new events to the reader. Events already written for it stay unread.

## `world.data` and earmarks

`world.data` is a `Map` with the game data from SC2, loaded at each game's setup: `abilities`, `units`, `upgrades`, `buffs`, `effects` (each keyed by id) and `earmarks`. It also has these methods. Until the first game's setup the data is `null`.

#### `data.getUnitTypeData(unitTypeId: number) => UnitTypeData`

The unit type's data. For a Zerg structure the mineral cost has the 50 of the drone taken off, so it is the net cost. Throws a `TypeError` for an id with no data.

#### `data.getAbilityData(abilityId: number)`, `data.getUpgradeData(upgradeId: number)`, `data.getEffectData(effectId: number)`

The `AbilityData`, `UpgradeData` and `EffectData` of that id, `undefined` when unknown. `getUpgradeData` and `getEffectData` throw a `TypeError` before the data is loaded.

#### `data.mineralCost(unitTypeId: number) => number`

`getUnitTypeData(unitTypeId).mineralCost`, so also net for a Zerg structure.

#### `data.findUnitTypesWithAbility(abilityId: number) => number[]`

Takes a specific or generic id (`BUILD_TECHLAB_BARRACKS` or `BUILD_TECHLAB`) and returns the sorted unit types whose generated abilities hold it or an ability that remaps to it, plus the types the hand-captured [`AbilitiesByUnit`](constants.md#constantsunit-ability-map) map lists for it while the game data marks it available.

#### `data.register(name: string, fn: Function) => void`

Attaches `fn` to the data object as `data[name]`, for plugins that extend it.

### Earmarks

An earmark reserves money for later, so that spending elsewhere doesn't starve it. While it exists, `agent.canAfford` and `agent.canAffordUpgrade` subtract it, except when called with that earmark's name; if that check passes, the earmark is settled (removed). Build systems create and settle earmarks themselves, see [build-orders.md](build-orders.md). Earmarks are emptied at every new game.

#### `data.addEarmark(earmark: { name: string; minerals: number; vespene: number })`

Adds the earmark. When one with that name exists it does nothing and returns the current earmarks, so the amounts of the first one stay; otherwise it returns the data storage.

#### `data.getEarmarkTotals(earmarkName?: string | null) => { minerals: number; vespene: number }`

The summed cost of every earmark except the named one.

#### `data.settleEarmark(earmarkName: string) => Earmark[]`

Removes the earmark and returns the ones left.

```ts
import type { World } from '@sc-bot/core';
import { BARRACKS } from '@sc-bot/core/constants/unit-type';

export async function onStep({ agent, data }: World) {
    data.addEarmark({ name: 'barracks', minerals: data.mineralCost(BARRACKS), vespene: 0 });
    console.log(data.getEarmarkTotals());

    if (agent.canAfford(BARRACKS, 'barracks')) {
        // the earmark is settled: the money is yours to spend on the barracks now
    }
}
```
