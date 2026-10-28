# Getting started

This page builds a first bot in TypeScript: an eight-gate chargelot all-in written as a build system, based on [`examples/tutorial.ts`](../examples/tutorial.ts). It also introduces the four ideas the rest of the docs assume: event consumers, the world, systems and resources.

## Setup

You need [Bun](https://bun.sh), a StarCraft II 4.10 install with the maps you want to play on, and a project that depends on `@sc-bot/core`. The package is ESM-only TypeScript (`"main": "index.ts"`) and is consumed from source, so a Bun workspace or a `file:` dependency is how you get it. See [Finding StarCraft II](running-games.md) for how the launcher locates SC2 and maps.

Start with the smallest possible bot, `main.ts`:

```ts
import { createAgent, createEngine, createPlayer } from '@sc-bot/core';
import { Difficulty, Race } from '@sc-bot/core/constants/enums';

const bot = createAgent({ settings: { race: Race.PROTOSS } });

const engine = createEngine();
await engine.connect();

const [, results] = await engine.runGame('Melee/Simple64', [
    createPlayer({ race: Race.PROTOSS }, bot),
    createPlayer({ race: Race.RANDOM, difficulty: Difficulty.MEDIUM }),
]);

console.log(results);
engine.shutdown();
```

Run it with `bun run main.ts`. The first launch of SC2 takes a while; the client stays up afterwards and the next run reuses it. The bot does nothing yet and loses to the medium AI. The rest of this page gives it something to do.

## Event consumers

All logic that knows about the game lives in functions that consume events: `onGameStart`, `onStep`, `onUnitCreated`, `onUnitIdle`, `onUpgradeComplete` and so on. The agent takes them as properties, and so do systems. Every handler gets the `world` first and the event's data after it, and returns a promise (or nothing). The full list is in the [events table](agents.md).

## The world

`world` is the context of one game. It has three parts you use:

- `world.agent`: your agent, with player data such as minerals, supply and race.
- `world.data`: game data (unit types, abilities) and earmarks.
- `world.resources`: everything else, read through `resources.get()`.

Destructuring is the idiom:

```ts
import type { World } from '@sc-bot/core';

async function onStep({ agent, resources }: World) {
    const { units, map, actions } = resources.get();
    // ...
}
```

## Resources

Resources are the entry points to game state, one responsibility each. Three cover most of a first bot:

- `units`: every unit, with getters that return a `Units` collection (an array of `Unit` with chainable filters such as `idle`, `ready` and `closerThan`). Examples: `getWorkers()`, `getCombatUnits()`, `getById(type, filter)`.
- `map`: positions. Expansions (`getMain()`, `getEnemyMain()`, `getExpansions(alliance)`), `getCombatRally()`, pathing.
- `actions`: commands. `attackMove`, `build`, `train`, `gather`, `mine`, `upgrade` and the rest. A command call proposes the order; the engine sends the winning proposals once all systems have run, so the call resolves with no value (see [Commands](commands.md)).

`units`, `map` and the others are described in [Units](units.md), [Map](map.md) and [Resources](resources.md).

## Systems

A system is a self-contained part of your bot, like middleware: it takes the same event handlers as the agent, owns its own state and can be mounted on any agent. Systems are optional, but they keep a bot in reusable pieces. A `build` system also follows a build order.

The bot below is one build system. It goes in `eight-gate-all-in.ts`, and is [`examples/tutorial.ts`](../examples/tutorial.ts), introduced one handler at a time. The handler blocks below are fragments of that system object, shown out of order and not meant to compile on their own.

### The build order

`type: 'build'` plus a `buildOrder` of `[supply, task]` steps makes a build system. `taskFunctions` builds the tasks, and the unit, upgrade and ability constants come from `@sc-bot/core/constants/*`. A second argument to `build` is the quantity.

```ts
import { createSystem, taskFunctions } from '@sc-bot/core';
import type { World, Unit } from '@sc-bot/core';
import { Alliance } from '@sc-bot/core/constants/enums';
import { CHARGE } from '@sc-bot/core/constants/upgrade';
import { combatTypes } from '@sc-bot/core/constants/groups';
import {
    ASSIMILATOR,
    CYBERNETICSCORE,
    GATEWAY,
    NEXUS,
    TWILIGHTCOUNCIL,
    ZEALOT,
} from '@sc-bot/core/constants/unit-type';

const { build, upgrade } = taskFunctions;

const eightGateAllIn = createSystem({
    name: 'EightGateAllIn',
    type: 'build',
    defaultOptions: {
        state: { armySize: 12 },
    },
    buildOrder: [
        [16, build(ASSIMILATOR)],
        [17, build(GATEWAY)],
        [20, build(NEXUS)],
        [21, build(CYBERNETICSCORE)],
        [26, build(TWILIGHTCOUNCIL)],
        [34, upgrade(CHARGE)],
        [34, build(GATEWAY, 7)],
    ],
    // handlers below go here
});

export default eightGateAllIn;
```

The first number is the supply at which the step may run; the builder trains workers until the supply is reached. Build orders can also be written as short strings (`'16 gateway'`); see [Build orders](build-orders.md).

**This example builds no pylons.** A Nexus starts with a supply cap of 15, so the build can't get past its first steps and its gateways don't get placed. Add a pylon step to the order before using it for real (not verified in a live game).

### Gas workers

When an assimilator finishes (`onUnitFinished` gets the unit as its second argument), put the three nearest mineral workers on it:

```text
    async onUnitFinished({ resources }: World, newBuilding: Unit) {
        if (newBuilding.isGasMine()) {
            const { units, actions } = resources.get();

            const threeWorkers = units.getMineralWorkers().closestNUnits(newBuilding.pos, 3);
            return actions.mine(threeWorkers, newBuilding);
        }
    },
```

### Idle units

New workers go to minerals (`gather` picks the nearest mineral field at a base that needs workers, so it balances too), and new combat units go to `map.getCombatRally()`:

```text
    async onUnitCreated({ resources }: World, newUnit: Unit) {
        const { actions, map } = resources.get();

        if (newUnit.isWorker()) {
            return actions.gather(newUnit);
        } else if (combatTypes.includes(newUnit.unitType!)) {
            return actions.attackMove([newUnit], map.getCombatRally());
        }
    },
```

Idle gateways train zealots from `onStep`. `getById` takes a filter object in place of its default `{ alliance: Alliance.SELF }`, so the alliance stays in it:

```text
    async onStep({ resources }: World) {
        const { units, actions } = resources.get();

        const idleGateways = units.getById(GATEWAY, { alliance: Alliance.SELF, noQueue: true, buildProgress: 1 });

        if (idleGateways.length > 0) {
            return Promise.all(idleGateways.map((gateway: Unit) => actions.train(ZEALOT, gateway)));
        }
    },
```

### A timing attack

When Charge finishes, send everything at the enemy natural, then the main (`true` queues the command):

```text
    async onUpgradeComplete({ resources }: World, upgrade: number) {
        if (upgrade === CHARGE) {
            const { units, map, actions } = resources.get();

            const combatUnits = units.getCombatUnits();
            const [enemyMain, enemyNat] = map.getExpansions(Alliance.ENEMY);

            return Promise.all(
                [enemyNat, enemyMain].map((expansion) => {
                    return actions.attackMove(combatUnits, expansion.townhallPosition, true);
                }),
            );
        }
    },
```

### System state and waves

`defaultOptions.state` is the system's initial state, read as `this.state` and changed with `this.setState` (pass the new values; don't mutate the old object). `this` in a system's handler is always the system. The system's `buildComplete` handler runs when the last build step is done, so it can flip a flag that `onStep` checks:

```text
    async buildComplete() {
        this.setState({ buildComplete: true });
    },
```

With the flag set, `onStep` attacks in waves, each two units larger than the last. This is the start of the `onStep` above:

```text
    async onStep({ resources }: World) {
        const { units, map, actions } = resources.get();

        if (this.state.buildComplete) {
            const idleCombatUnits = units.getCombatUnits().filter((unit: Unit) => unit.noQueue);

            if (idleCombatUnits.length > this.state.armySize) {
                this.setState({ armySize: this.state.armySize + 2 });
                const [enemyMain, enemyNat] = map.getExpansions(Alliance.ENEMY);

                return Promise.all(
                    [enemyNat, enemyMain].map((expansion) => {
                        return actions.attackMove(idleCombatUnits, expansion.townhallPosition, true);
                    }),
                );
            }
        }

        // ... the idle gateway code from above
    },
```

## Mount it and run

Back in `main.ts`, mount the system on the agent with `use()` (a single system or an array):

```ts
import eightGateAllIn from './eight-gate-all-in.ts';

bot.use(eightGateAllIn);
```

Systems on one agent run concurrently, and when two of them order the same unit, priority and `use()` order decide the winner; see [Commands](commands.md).

## Where to go next

- [Running games](running-games.md): engine options, ladder play, replays, config file.
- [Agents](agents.md): agent settings, events, custom systems.
- [Build orders](build-orders.md): string steps, openings, targets.
- [Architecture](architecture.md): how systems, labels and the event channel fit together.
- [`examples/`](../examples): runnable bots, including worker rushes, a cannon rush and a bot made of behaviors.
