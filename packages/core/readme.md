# @sc-bot/core

`@sc-bot/core` is a framework for writing StarCraft II bots in TypeScript. It started as a fork of [node-sc2](https://github.com/node-sc2/core) and has been extended to cover what a [python-sc2](https://github.com/BurnySc2/python-sc2) (BurnySc2 7.3.0) bot author uses: chainable unit collections, combat math, macro helpers, ramps and walls, per-unit command arbitration with batched sends, bot-vs-bot games, replays and more.

It talks to the game through the raw [s2client-proto](https://github.com/Blizzard/s2client-proto) API, using [`@node-sc2/proto`](https://github.com/node-sc2/proto) as the websocket transport. The type definitions in [`types.ts`](types.ts) are the source of truth for signatures.

## Requirements

- [Bun](https://bun.sh). The package ships its TypeScript source (`main` is `index.ts`). Inside this monorepo, depend on it with `"@sc-bot/core": "workspace:*"`.
- StarCraft II (the 4.10 Linux headless build that AI Arena runs, or any version that speaks the raw API) and the maps you want to play. [Running games](docs/running-games.md) explains how the launcher finds both.

## Quick start

The "hello world" of StarCraft bots is a worker rush:

```ts
import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';

const bot = createAgent({
    settings: { race: Race.ZERG },
    async onGameStart({ resources }) {
        const { units, map, actions } = resources.get();
        return actions.attackMove(units.getWorkers(true), map.getLocations().enemy[0]);
    },
});

const engine = createEngine();
await engine.connect();

const [, results] = await engine.runGame('Melee/Simple64', [
    createPlayer({ race: Race.ZERG }, bot),
    createPlayer({ race: Race.PROTOSS, difficulty: Difficulty.MEDIUM }),
]);

console.log(results);
engine.shutdown();
```

Run it with `bun run main.ts`. The first launch of SC2 takes a while; the client is left running afterwards (on port 5000 by default), and the next run reuses whatever SC2 is already listening on that port.

## Concepts

The engine (`createEngine`) launches or connects to SC2, creates the game and runs the step loop. Every handler gets the world as its first argument: `world.agent`, `world.data` (game data and earmarks) and `world.resources`.

**Agent.** `createAgent` is your bot: an object of event handlers (`onGameStart`, `onStep`, `onUnitCreated`, ...) plus settings such as the race. The agent also holds player data (minerals, supply) and the cost and affordability helpers. See [agents](docs/agents.md).

**Systems.** A system is a reusable unit of bot logic mounted on an agent with `agent.use()`: an agent system reacts to events, a unit system sorts units by label and runs per-unit hooks, and a build system runs a build order. See [systems](docs/agents.md#systems) and [build orders](docs/build-orders.md).

**Resources.** The game state and the means to act on it live in resources, fetched with `world.resources.get()`: `units`, `map`, `actions`, `frame` and more. You can register your own. See [resources](docs/resources.md).

**Events.** The engine turns each step into events and delivers them to every agent handler and system that listens; custom events go through the `events` resource. See [events](docs/agents.md#events).

## Documentation

| Page | Covers |
|---|---|
| [Getting started](docs/getting-started.md) | A first bot, step by step |
| [Running games](docs/running-games.md) | Engine, `runGame`, bot-vs-bot, replays, ladder, config file, debugging |
| [Agents, events and systems](docs/agents.md) | `createAgent`, settings, player data, events, systems |
| [Resources](docs/resources.md) | World, registry, per-game reset, `frame`, `debug`, `events`, `world.data` |
| [Commands](docs/commands.md) | `actions`, command arbitration, errors |
| [Units](docs/units.md) | `units`, `Units`, `Unit`, `memory`, `spatial` |
| [Map](docs/map.md) | `map`, expansions, ramps, `mapAnalysis`, `influence`, `pathing` |
| [Combat](docs/combat.md) | `roles`, `squads`, `intel`, fight simulation |
| [Behaviors](docs/behaviors.md) | Behaviors and controllers |
| [Macro](docs/macro.md) | Macro helpers, `placement`, `buildings`, `mining`, `flying` |
| [Build orders](docs/build-orders.md) | Build systems, string steps, openings, `parseBuildOrder` |
| [Constants](docs/constants.md) | Enums, dictionaries, groups |
| [Compatibility](docs/compatibility.md) | Differences from python-sc2, ares and node-sc2; known limitations |
| [Architecture](docs/architecture.md) | Design, engine internals, testing (for contributors) |
| [Glossary](GLOSSARY.md) | What structure, building, base, pending, near, target and other shared words mean |
| [Changelog](docs/changelog.md) | Release notes; [node-sc2 history](docs/changelog-node-sc2.md) |

## Examples

Runnable bots live in [`examples/`](examples); [its readme](examples/README.md) has the environment variables, the ares ports table and the opening configs.

- `worker-rush.ts`: Zerg worker rush.
- `cannon-rush.ts`: Protoss cannon rush.
- `ramp-wall.ts`: Terran main ramp wall.
- `bot-vs-bot.ts`: two agents against each other.
- `watch-replay.ts`: an observer over a replay.
- `ladder.ts`: started by a ladder manager.
- `behaviors-bot.ts`: Terran bio bot of only controllers and behaviors.
- `tutorial.ts`: the build system from [getting started](docs/getting-started.md).
- `ares/`: ports of the ares-sc2 tutorials.
- `examples.live.test.ts`: live smoke test, needs `SC2PATH`.

The SC2 AI community is on Discord: https://discord.gg/Emm5Ztz
