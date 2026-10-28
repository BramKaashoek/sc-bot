# Architecture

How the library is put together and why. For contributors and for bot authors who want to know what runs when. The user-facing API is in the other pages; this one covers the design levels, the engine's dispatch, the resource registry, shared modules, extension points and the test setup.

## Design

The library offers a bot several levels of abstraction, so a small bot uses simple pieces and a large one can grow into the next level.

### Level 1: engine events

An agent can implement engine events directly, such as `onStep`, `onUnitCreated` or `onUnitIdle`, and a whole bot can be one file of such handlers. Every handler gets the `World` (the context of the current game) and the data of its event (the `gameLoop` of a step, the unit of `onUnitCreated`).

### Level 2: systems

A system is the basic construct for splitting a bot up. It borrows from middleware, from React components and from the system of an entity-component-system. Systems implement the same event handlers as an agent, hold optional state (`this.state`, `this.setState`) and are designed not to reach into one another. The engine's own systems have the same shape; they run first, in series, as `engine` systems, while your systems are mounted on the agent (`agent.use()`) and are called agent systems. `this` is avoided inside the framework (context goes through arguments and closures), with systems as the exception: `this` in a system's handler is the system.

Some system types add behaviour: `type: 'build'` takes a build order, `type: 'unit'` filters units by type and label for its `onStep`. Reusable logic can be packaged as a system and mounted on several bots.

#### Behaviors

A system is a unit of scheduling: it reacts to events, owns state and has a commander (a name and a priority) for the commands it proposes. A behavior is a unit of logic with none of that: a small `{ name, execute(ctx) }` object (stutter a marine back, spawn toward a composition) that a system or agent handler runs with `behaviors.run`, optionally as a role or at a priority. It orders units through the commander of whoever runs it, so it never competes with the system that owns it; `actions.flushQueuedActions` still arbitrates between owners and picks one per unit (see [Command arbitration](commands.md#command-arbitration)), and `plan` composes behaviors first-success-wins. Systems decide when and under which owner things run; behaviors are the pieces they run.

### Level 3: communication between systems

Systems don't see each other, yet they are parts of one machine. Three channels connect them.

**Custom events.** The `events` resource (the `EventChannel`) is a pub/sub channel. Most events come from the engine's internal systems and flow through the regular dispatch, and any system can write its own event and read it with an `on<EventName>` handler. Events are pull-based, with readers registered ahead of time; see [Events](#events) below. Use them to signal that something happened or to trigger state changes in another system.

**Data registers.** `world.data` is a `DataStorage`: `get` and `set` like a `Map`, plus `register`, which attaches helper functions to a key. That defines a data type and the functions that act as its methods, usable from all systems without sharing references. The engine uses it for the protocol's `ResponseData` (unit types, abilities) and for earmarks. A system or agent registers its own shapes in `setup` or `onGameStart`.

**Entity labels.** A label is a string key on a unit, mapping to any value (usually a boolean or a small object). Labels carry data between systems with no shared function or type. For example, a scouting system labels the nearest zergling `scoutLocation` with the positions of the possible enemy thirds, and a movement system that reads that label queues the moves. Neither system calls the other, and a third could consume the same label. Labels suit skirmishes, harassment campaigns, army groups or per-unit behaviour trees.

Labels that the library itself reads are few (`command` and `stuck` on workers, for instance: mining and `units.getMineralWorkers` skip a `command` worker, and the builder pick skips a `stuck` one; see [Macro](macro.md)). Roles are the exception to the label idiom, and live in the `roles` resource instead, since labelled units get special handling in unit systems.

## Internals

### Agent

An agent is a participant controlling a player. `createAgent(blueprint)` returns one. It implements the event handlers of its blueprint and also the combined proto definitions of `PlayerCommon` and `PlayerRaw`, plus methods such as `canAfford` and `hasTechFor` and properties such as `race`, `playerId` and `larvaCount`. Agent systems are mounted with `agent.use()`. The agent's own handlers have lower priority than engine systems and run before agent systems.

### Engine

`createEngine` builds the glue that runs a bot: connecting to a client, creating or joining games, and running the loop. It creates the `World` for every game it coordinates, with all resources and data, and is given the agent when a game starts. In a game it requests a step and dispatches that step across the systems and the agent.

### System wrapper

`createSystem` returns a wrapper around the blueprint. The wrapper holds metadata the system itself can't see, reads the system's events and calls its handlers; when the engine dispatches, each wrapper handles its own system. The blueprint's `name` is used for debugging and for the commander of the commands it proposes.

System types are `engine`, `agent`, `build` and `unit`. A `build` or `unit` system is an agent system with extra behaviour, added by a plugin that rewrites its handlers (`systems/builder-plugin.ts` and `systems/unit-plugin.ts`, applied in `systems/create-system.ts`). That is the place to look for how a new system type would be added. Systems of type `agent` skip a `step` event that falls within their `stepIncrement` of the last run (default 8 game loops).

### Events

Events here are closer to the event systems of systems languages than to browser or Node event emitters. A dispatch mechanism has to leave the handler at the call site, or asynchronous handlers would run across game loops and determinism between systems and frames would be lost. The design is loosely reminiscent of Rust's `shrev`: the `EventChannel` is a pull-style channel with immutable reads, and readers register ahead of time in exchange for a reader id. Writing an event stores it with every reader of the same event type (or of type `all`) registered at that moment. Each `read` consumes the event for that reader, and the event is destroyed after every intended reader has read it, even if that takes more than one frame. `event.destroy()` consumes an event early.

The channel is synchronous; dispatch is asynchronous. Handlers return a promise that resolves when they are done.

### Dispatch order

Each loop the engine requests a step and creates a `step` event. `engine.dispatch()` then runs:

1. Engine systems, in series, in the order they were added (so mutations of resources and new events are deterministic). The engine mounts, in this order, `FrameSystem` (reads the observation, updates `frame`, creates `unitDestroyed` events), `UnitSystem` (adds and updates units on `units`, creating events by diffing), `MapSystem` (visibility and creep) and, when `features.chatDebug` is on, the chat debug system. `engine.use()` appends after those.
2. `world.resources.step(world)`: every registered resource's `onStep` hook, synchronously, in registration order. `memory` forgets expired ghosts here, before any agent code reads units.
3. The agent, under the commander `{ owner: 'agent', priority: commandPriority, rank: -1 }`.
4. Agent systems, concurrently, each under its own commander (`owner` is the system name, `priority` its `commandPriority`, `rank` its index in `use()` order). See [Command arbitration](commands.md#command-arbitration) for how the commander follows a handler.
5. `actions.flushQueuedActions()`: arbitrates and sends the step's commands (see [Command arbitration](commands.md#command-arbitration)) and writes one `commandResults` event (type `agent`); readers get it on the next dispatch. A flush error is logged, except `GameEndedError` and `ConnectionClosedError`, which propagate to the game loop.
6. `debugSystem`, last, because it updates the in-client debug display.

Running agent systems concurrently is safe because events aren't destroyed until all their readers have consumed them: a system can write an event that some readers consume this frame and others the next.

When a game ends, the engine's `onGameEnd` calls `world.resources.endGame(world, results)`, which runs every resource definition's `onGameEnd` hook synchronously in registration order (a throwing hook is logged and doesn't stop the next), and then the `onGameEnd` option of `createEngine`. A normal end, a replay's end, leaving the game (a silent defeat) and passing `gameTimeLimit` (a tie for every participant) get there; a game that ends in `ConnectionClosedError` or an unknown error doesn't. `openings` writes its history from this hook.

### World

```ts
// signature sketch
World { agent: Agent, data: DataStorage, resources: ResourceManager, config: Readonly<CoreConfig> }
```

`config` is resolved once by `createEngine` (defaults, the JSON config file, inline `config`, then `STEP_COUNT`; see [Running games](running-games.md)) and is set before the built-in resources register. The engine takes its step size from `config.gameStep`.

`world.data` is marginal to the engine (static `ResponseData` and earmarks) and mostly a shared space for systems, as described under data registers.

### Resources and the registry

A resource is defined by `{ name, create(world), reset?(resource, world) }` and added with `world.resources.register(definition)`, which creates it once and returns it. Registering the same definition object again returns the existing resource; a different definition under a taken name throws. Its type comes from augmenting the `ResourceContainer` interface in `@sc-bot/core/types`. `createWorld` (`engine/create-world.ts`) registers the built-ins; bots and plugins register theirs from a system's `setup`. Most built-ins have a matching engine system or `onStep` hook that is the sole mutator of that resource.

The registration order, which is also the order of `onStep`, `reset` and `onGameEnd` hooks:

1. `frame`: the current game loop, observation and game info.
2. `map`: map and grid state, expansions, pathing queries.
3. `debug`: drawing and debug commands.
4. `units`: the unit stores and filters.
5. `events`: the `EventChannel`.
6. `actions`: the `ActionManager`, the main way to command units; its helpers propose commands for the step-end flush.
7. `memory`: enemy ghosts. Its `onStep` deletes ghosts that expired or whose position is seen empty.
8. `spatial`: a bucket grid over enemies (ghosts included) and own units, rebuilt lazily on the first query of each game loop.
9. `influence`: per-loop ground and air (and avoidance) cost grids, built lazily from the pathing grid, enemy units and effects.
10. `pathing`: A* over the influence grids, with buffers reused between queries.
11. `roles`: a tag-to-role map kept apart from labels. `onStep` drops dead units and applies the default role once per new finished unit; `flushQueuedActions` asks its `mayCommand` to drop proposals for units in an exclusive role (`'not-owner'`).
12. `squads`: no `onStep`; a role's units are clustered on the first `getSquads` call per (role, types) in a game loop and cached for the rest of it.
13. `intel`: `onStep` reads `spatial` and `memory` to update per-base threat sets and the sticky strategy flags, and writes `enemyStrategyDetected` for each newly set flag, so agent handlers see it in the same step.
14. `placement`, 15. `buildings`, 16. `mining`, 17. `flying`: each has an `onStep`, in this order, which is the dependency order. `placement` solves the Terran or Protoss spots on the first step with expansions, race and map state, and updates spot states from structures. `buildings` advances tracked builds, which read those spots and reserve through `placement`, so `placement` runs first. `mining` assigns workers after `buildings`, so a worker the tracker took (`mining.selectWorker` moves it to the `BUILDING` role) or handed back (`release`) is already out of or back in `GATHERING`. `flying` depends on none of them. Their commands go through `roles.as` (`BUILDING` at 10 for `buildings`, `GATHERING` at -10 for `mining`) or `actions.as({ owner: 'flying', priority: 10 })`. Their settings survive `reset`; plans, builds, assignments and spots don't.
18. `mapAnalysis`: computes the region and choke analysis from the start pathing grid once per game in `onStep` when `features.eagerMapAnalysis` is on (errors are logged on `sc2:debug:mapAnalysis`, never thrown); otherwise the first accessor call does it. Ground-distance fields are cached per start cell (32 at most). Settings survive `reset`; the analysis and caches don't, and `configure` drops them too.
19. `behaviors`: no `onStep`. `run` executes a behavior at once under the caller's commander (wrapped in `roles.as` or `actions.as` for a role or priority). The `ctx.order` dedupe state (the tags each owner ordered, per game loop) lives in the resource, cleared lazily when the game loop changes and on `reset`. Its orders are proposals like any other and go out in the step-end flush.
20. `openings`: holds the opening definitions and settings and picks one per game (`choose`, memoized until `reset`); the build plugin reads it and records the chosen name at game start. `onStep` only notes a replay, and `onGameEnd` appends the game to the history file when `dataDir` is set and an opening was recorded. Settings survive `reset`; the chosen opening and the history don't.

#### Per-game reset

Another game on the same engine resets every registered resource in place, in registration order; see [Per-game reset](resources.md#per-game-reset) for what is reset, what is kept and how settings and config sections are re-applied. `actions` must not be recreated, since that would create a new proto client.

### Shared modules

Internal modules (not in the package.json exports map) that several systems build on, so each rule lives in one place:

- `utils/workers/select-builder.ts`: `selectBuilder(world, near, { exclude, reuseConstructing })`, the build-worker fallback for `actions.build` and the building tracker; the rule is in [Builder pick](macro.md#builder-pick).
- `utils/map/blockers.ts`: `livePathing`, `claimableCells` and `releasableCells`, used by the map system to block the cells of destructible rocks and xel'naga towers and release them when the rock dies. The grid is the live pathing grid from a `gameInfo` request (cached per game loop), since the one at game start lacks flat rocks and towers.
- `utils/grid/cell.ts`: `cellCentre(index, width)`, the centre point of a flat grid index, used by `pathing` and `mapAnalysis` to turn grid results into map positions.
- `constants/time.ts`: `GAME_LOOPS_PER_SECOND`, the only place the 22.4 rate lives (public as `@sc-bot/core/constants/time`).
- `constants/groups.ts`: the unit-type groups and tables systems would otherwise keep private copies of (`addonHost`, `addonHostTypes`, `creepTumorTypes`, `researcherEquivalents`, `creationAbilityOverrides`, and the rich gas and mineral variants in `gasMineTypes` and `mineralFieldTypes`).
- `utils/geometry/point.ts`: the point helpers (`distance`, `distanceSquared`, `towards`, `avgPoints`, `closestPoint`), exported from the package root.

### The `utils/` rule

`utils/` holds pure algorithms: they take plain data (points, grids, numbers) and never import `World`. Examples are `utils/pathing/astar.ts`, `utils/map/flood.ts`, `utils/map/chokes.ts`, `utils/spatial/bucket-index.ts`, `utils/grid/stamp.ts` and `utils/placement/formation.ts`. A helper that reads game state takes the `world` as its first parameter, so the dependency shows at the call site. Six modules in `utils/` do that today and are the known exceptions: `utils/map/blockers.ts`, `utils/map/townhall.ts`, `utils/map/region.ts`, `utils/workers/select-builder.ts`, `utils/build-order/targets.ts` and `utils/geometry/units.ts`. New World-taking code goes next to the resource or system that owns it, not into `utils/`.

### Extension points

- **Engine systems.** `engine.use(system)` or `engine.use([systems])` mounts `type: 'engine'` systems. They run first on every dispatch, in series, in the order added, after the built-in frame, unit, map and chat debug systems, and they can read and write resources before any agent code runs.
- **Agent systems.** `agent.use(system)` mounts a system on a bot; see [Agents](agents.md).
- **Resources.** `world.resources.register(definition)` from a system's `setup`, with the type added to `ResourceContainer`; see [Resources](resources.md).
- **System types.** A new type means a plugin like `systems/builder-plugin.ts`, applied by `createSystem`.
- **Placement and behaviors.** The `placer` resource and custom behaviors extend building placement and unit micro without touching the engine; see [Macro](macro.md) and [Behaviors](behaviors.md).

## Chat debug and the debug system

The chat debug system (`systems/chat-debug.ts`) is an engine system added only when `features.chatDebug` is set. It handles your own chat messages as debug commands. `debugSystem` (`systems/debug.ts`) always runs last in a dispatch, tracks losses and draws the on-screen debug display when the `sc2:DebugOnScreen` debug namespace is enabled.

## Testing

Run `bun test` in `packages/core` (or `bun run test` at the repo root, through turbo). Tests are colocated with the code as `*.test.ts`, in three tiers:

- **Pure:** plain inputs, no world.
- **Fixture:** a real engine and world built from captured game data, with a fake SC2 client. No SC2 needed.
- **Live:** real SC2 games, in the `*.live.test.ts` files. They only run when `SC2PATH` is set. Today those are `engine/create-engine.live.test.ts`, `engine/behaviors.live.test.ts`, `examples/examples.live.test.ts`, `resources/mining.live.test.ts`, `resources/placement.live.test.ts` and `resources/flying.live.test.ts`. They share `test/live.ts` and must not run in parallel with other SC2 sessions, since the helper kills SC2 processes started during a suite.

The fixture tier uses `createTestWorld(fixtureOrMapName, { loop?, agent?, onQuery?, config? })` from `test/create-test-world.ts`. It loads `fixtures/<map>/`, runs the engine's setup and first step on the observation at `loop`, and returns the world plus `client` and `engine`. `stepTo(world, loopOrObservation)` feeds the next observation through a full dispatch, so events fire. The fake client (`test/fake-client.ts`) records every request in `client.sent` (`actions`, `step`, `debug`, `queries`, `createGame`, `leaveGame`, `saveReplay`, ...). It tracks `client.status` through `createGame`, `joinGame` and `leaveGame` and, like SC2, throws from `saveReplay` once the game has been left. It answers placement and pathing queries with the answers recorded from the real engine when it has them, and otherwise computes them from the fixture's grids. `test/factories.ts` has `rawUnit`, `observation`, `unitTypeData` and `toyFixture` for hand-built frames.

```ts
import { describe, expect, it } from 'bun:test';
import { createTestWorld, stepTo } from '../test/create-test-world.ts';
import { UnitType } from '../constants/index.ts';

describe('opening', () => {
    it('stops the starting workers on Blueshift', async () => {
        const world = await createTestWorld('blueshift', { loop: 0 });
        const { units, actions } = world.resources.get();

        const workers = units.getWorkers();
        expect(workers.exists).toBe(true);
        expect(units.getById(UnitType.COMMANDCENTER).amount).toBe(1);

        await actions.stop(workers);
        expect(world.client.sent.actions).toHaveLength(1);

        await stepTo(world, 224);
        expect(world.resources.get().frame.getGameLoop()).toBe(224);
    });
});
```

To test a failure path, override a client method on the world, e.g. `world.client.action = async () => ({ result: [3] })` makes SC2 reject every command. The test helpers live inside the package and aren't part of its exports, so they are for tests within `packages/core`.

### Fixtures

`fixtures/` holds games captured from SC2 4.10: `blueshift`, `acropolis` and `simple64` (Terran), plus `blueshift-zerg` and `blueshift-protoss`. Each has `gameInfo.json`, observations at loops 0, 224 and 896 (`obs-<loop>.json`), and `abilities.json` and `queries.json` keyed by loop. `fixtures/data.json` is the shared game data. `blueshift/type-abilities.json` lists the abilities of each unit type (it feeds `generate:data`), and `simple64/rock-placements.json` holds placement answers around destructible rocks, captured by hand.

### Scripts

Run in `packages/core`:

- `bun run capture:fixtures [fixture...]` plays scripted games against the built-in AI and re-captures all fixtures, or only the named ones. It needs SC2 and the maps (`Ladder2018Season4/BlueshiftLE`, `Ladder2019Season3/AcropolisLE`, `Melee/Simple64`). It uses port 5077 and refuses to start if that port is taken. Each fixture is written to `<fixture>.capturing` and only replaces the old one when the capture completes. A saved observation is the exact response the frame system consumed, so the actions, action errors, chat and dead units SC2 reports only once are kept. The `type-abilities` passes run when no fixture is named, or when `type-abilities` is named along with `blueshift`. `CAPTURE_DIR` changes the output folder.
- `bun run generate:data` regenerates the id modules in `constants/` and the dictionaries in `constants/dicts/` from the captured data and formats them with the repo's biome. Existing names are kept. `bun run check:data` (also run by the test suite) fails when a committed generated file differs from a fresh run. `CONSTANTS_DIR` changes the target folder.
- `bun run check-types` type-checks the package, examples and tests.
