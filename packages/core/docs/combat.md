# Combat

Resources and utilities for deciding what your army should do: `roles` tags your units with a job, `squads` clusters a role's units into groups, `intel` watches the enemy near your bases and flags rushes, and `simulateFight` / `canWinFight` estimate who wins a fight. The [behaviors](behaviors.md) page covers the building blocks that carry the decision out.

All three resources are on `resources.get()`. They are ares' `UnitRoles`, squad and `ManagerMediator` threat features, reshaped as resources: roles live in their own store rather than in unit labels, squads are computed lazily, and the intel flags are evaluated by the engine every step.

- [roles](#roles): `ATTACKING`, `DEFENDING`, `GATHERING`, `BUILDING`, ... one role per unit; exclusive roles keep other code off a unit.
- [squads](#squads): per-role clusters by distance, with stable ids across steps.
- [intel](#intel): base threats and sticky enemy strategy flags.
- [Fights](#fights): `simulateFight`, `canWinFight` and the `EngagementResult` scale.

## roles

Roles group your own units by job, using ares' role names: the `UnitRole` constants in `@sc-bot/core/constants/unit-role` (`ATTACKING`, `DEFENDING`, `GATHERING`, `BUILDING`, ...). A unit has at most one role. Roles live in their own resource, not in unit labels, so unit systems and `units.withLabel` don't see them.

Each step, before agent code, `roles` drops units that died and gives each new finished own unit its default role, once per unit. By default workers other than MULEs get `GATHERING` and everything else gets none; change that with `configure({ defaultRole })`. A role you clear stays cleared. A unit inside a transport keeps its role, but `get` leaves it out until it is unloaded.

**Exclusive roles.** With `configure({ exclusive: [ATTACKING] })`, only `'role:ATTACKING'` may command units in that role: every other commander's proposal for them is dropped with `reason: 'not-owner'` (see [Command arbitration](commands.md#command-arbitration)). Make a role exclusive only once everything that commands its units does so inside `roles.as`. The immediate `sendAction` and `toggleAutocast` aren't filtered. A `sendAction` from another commander also takes the unit for the rest of the observation, so the role's own commands only get it back in that step when they strictly outrank the sender; pass `roles.as` a higher `priority` if that matters.

#### `roles.assign(units: Unit | Unit[] | string | string[], role: UnitRole) => void`

Gives one or more units (or tags) a role, replacing any previous one.

#### `roles.clear(units: Unit | Unit[] | string | string[]) => void`

Removes their role. It is not given again by `defaultRole`.

#### `roles.switchRole(from: UnitRole, to: UnitRole) => void`

Moves every unit of `from` to `to`.

#### `roles.get(roles: UnitRole | UnitRole[], opts?: { types?: number | number[]; excludeTypes?: number | number[] }) => Units`

Your current, alive units with that role, or with any of a list of roles, optionally filtered by unit type.

#### `roles.roleOf(unit: Unit | string) => UnitRole | undefined`

#### `roles.getTags(role: UnitRole) => ReadonlySet<string>`

The tags with that role, units in transports included.

#### `roles.as<T>(role: UnitRole, fn: () => T, opts?: { priority?: number }) => T`

Runs `fn` as the commander `'role:<ROLE>'` (through `actions.as`). `priority` defaults to the caller's.

#### `roles.mayCommand(owner: string, tag: string) => boolean`

`false` only when the unit's role is exclusive and `owner` isn't `'role:<ROLE>'` of that role.

#### `roles.configure(settings: Partial<RoleSettings>) => void`

```ts
// signature sketch
RoleSettings = {
    defaultRole: (unit) => (unit.isWorker() && unit.unitType !== MULE ? GATHERING : undefined),
    exclusive: [],
};
```

`defaultRole(unit)` returns the role for a new unit, or `undefined`. Settings survive a new game ([per-game reset](resources.md#per-game-reset)); roles don't.

```ts
import type { World } from '@sc-bot/core';
import { ATTACKING, GATHERING } from '@sc-bot/core/constants/unit-role';
import { MULE } from '@sc-bot/core/constants/unit-type';

export async function onGameStart({ resources }: World) {
    resources.get().roles.configure({
        defaultRole: (unit) =>
            unit.isWorker()
                ? unit.unitType === MULE
                    ? undefined
                    : GATHERING
                : unit.isCombatUnit()
                  ? ATTACKING
                  : undefined,
        exclusive: [ATTACKING],
    });
}

export async function onStep({ resources }: World) {
    const { actions, map, roles } = resources.get();
    const army = roles.get(ATTACKING);
    if (army.length >= 20) {
        await roles.as(ATTACKING, () => actions.attackMove(army, map.getEnemyNatural().townhallPosition));
    }
}
```

## squads

Groups a role's units into squads by distance, so you can give per-squad orders that hold across steps. It costs nothing until you ask: the first `getSquads` call for a role and type filter in a game loop does the clustering, and later calls in that loop return the same squads.

Clustering is ares': a unit farther than `radius` from its squad's centre leaves it; then at most one pair of squads whose centres are within `radius` merges, the smaller into the larger (the newer into the older on a tie); then each unit without a squad joins the closest squad within `radius`, or starts a new one. Ids are `'<ROLE>-<n>'`, counted per role and type filter, so a squad keeps its id for as long as it exists. The main squad is the one with the most units, the oldest on a tie.

**One radius per role and type filter.** The radius isn't part of what identifies the squads: the first `getSquads` call in a game loop decides it for that loop. Switching radius between loops makes squads split and merge back, so use one radius for each (role, types).

```ts
// signature sketch
Squad = { id: string; role: UnitRole; units: Units; tags: ReadonlySet<string>; position: Point2D; isMain: boolean };
```

`position` is the mean position of the squad's units.

#### `squads.getSquads(role: UnitRole, opts?: { radius = 6; types?: number | number[] }) => Squad[]`

The role's squads. Squads are per game: they are dropped on a new game.

#### `squads.getMainSquad(role: UnitRole, opts?: { radius?: number; types?: number | number[] }) => Squad | undefined`

The main squad, or `undefined` when the role has no units. `radius` defaults to 6.

#### `squads.getMainSquadPosition(role: UnitRole, opts?: { types?: number | number[] }) => Point2D`

The main squad's position. With no units, its last position for this role and filter, else your main base's townhall position.

```ts
import type { World } from '@sc-bot/core';
import { ATTACKING } from '@sc-bot/core/constants/unit-role';

export async function onStep({ resources }: World) {
    const { actions, roles, squads } = resources.get();
    const rally = squads.getMainSquadPosition(ATTACKING);
    for (const squad of squads.getSquads(ATTACKING)) {
        if (!squad.isMain) await roles.as(ATTACKING, () => actions.move(squad.units, rally));
    }
}
```

## intel

Each step, before agent code, `intel` tracks the enemies near each of your bases and sets strategy flags.

**Base threats.** A visible enemy within `groundNearBase` (15) of one of your townhalls joins that base's ground threats, and one within `airNearBase` (20) its air threats; ground and air are split as in [spatial](units.md#spatial). A base's ground threats are all cleared at once when the closest ground enemy is farther than `groundLeavingBase` (24) or is a ghost, and the same for air with `airLeavingBase` (22). That is ares' hysteresis: an enemy that walks off stays a threat while others are still close.

**Strategy flags.** Flags are judged on every known enemy, ghosts included, at game time `t` (`frame.time()`, in game seconds). Distances are to your main's and natural's townhall positions and to the enemy start location and natural. Once set, a flag stays set for the game. The first time, intel records the game loop and writes an `enemyStrategyDetected` event, which `onEnemyStrategyDetected` handlers receive in the same step (see [events](agents.md#events)).

| Flag | Set when |
|---|---|
| `workerRush` | Before 3:00, more than 6 enemy workers within 15 of your main or 16 of your natural |
| `lingRush` | More than 2 zerglings within 50 of your main before 2:30, more than 7 zerglings before 3:00, or more than 4 before 1:30 |
| `roachRush` | 6 or more roaches within 50 of your main before 4:00, or 3 or more roaches before 3:00 |
| `ravagerRush` | A ravager before 4:00 |
| `marineRush` | Up to 3:30, while the enemy has fewer than two townhalls and no factory: 3 or more barracks before 3:00, or at least `max(3, floor(t / 45))` marines more than 60 from the enemy start (before 5:00) |
| `marauderRush` | Up to 4:00: a barracks tech lab within 55 of your natural, 2 or more marauders before 3:30, or one before 2:40 |
| `fourGate` | Before 3:20, 3 or more gateways while the enemy has fewer than two townhalls |
| `proxyZealot` | Up to 4:00, 2 or more gateways within 100 of your main and more than 60 from the enemy start; or before 2:30, a zealot within 65 of your main |
| `proxy` | Before 4:00, any structure `getProxies()` returns |
| `reaper` | A reaper |
| `expanded` | An enemy townhall more than 6 from the enemy start |
| `baseOutsideNatural` | An enemy townhall more than 6 from both the enemy start and the enemy natural |
| `greedy` | 2 Terran or Protoss townhalls started before `greedyTwoBaseBefore` (65 s), or 3 hatcheries (lairs and hives included) started before `greedyThreeHatchBefore` (90 s). The start is estimated from the build progress when the townhall is first seen. |
| `rushed` | Any of `lingRush`, `workerRush`, `proxyZealot`, `ravagerRush`, `fourGate` or `roachRush`; `marauderRush` without `expanded`; `marineRush` with no enemy structure within 15 of your natural; or 3 or more roaches before 4:00, a zergling before 1:45, or 2 or more barracks before 2:00 |

#### `intel.getBaseThreats() => BaseThreat[]`

```ts
// signature sketch
BaseThreat = { townhall: Unit; ground: Units; air: Units; groundSupply: number; airSupply: number };
```

One per own townhall with tracked threats. `ground` and `air` are the threats still visible; the supplies are their `foodRequired`, structures left out.

#### `intel.getMainThreat(kind: 'ground' | 'air') => BaseThreat | undefined`

The base with the most `'ground'` or `'air'` supply, or `undefined` when no base has any.

#### `intel.has(flag: IntelFlag) => boolean`

Whether the flag has been set this game.

#### `intel.detectedAt(flag: IntelFlag) => number | undefined`

The game loop the flag was first set at.

#### `intel.getProxies() => Units`

Enemy structures, ghosts included, within 100 of your main and more than 60 from the enemy start, leaving out creep tumors and gas buildings.

#### `intel.configure(settings: Partial<IntelSettings>) => void`

```ts
// signature sketch
IntelSettings = {
    groundNearBase: 15,
    airNearBase: 20,
    groundLeavingBase: 24,
    airLeavingBase: 22,
    greedyTwoBaseBefore: 65, // game seconds: 2nd Terran/Protoss townhall started before this
    greedyThreeHatchBefore: 90, // game seconds: 3rd hatchery started before this
};
```

Distances, and the `greedy` thresholds in game seconds. Settings survive a new game ([per-game reset](resources.md#per-game-reset)); flags and threats don't.

```ts
import { createAgent } from '@sc-bot/core';
import type { EnemyStrategyDetected, World } from '@sc-bot/core';

export const bot = createAgent({
    async onEnemyStrategyDetected(world: World, { flag, gameLoop }: EnemyStrategyDetected) {
        console.log(`${flag} detected at loop ${gameLoop}`);
    },
    async onStep({ resources }: World) {
        const { actions, intel, units } = resources.get();
        const threat = intel.getMainThreat('ground');
        if (threat && intel.has('rushed')) await actions.attackMove(units.getCombatUnits(), threat.townhall.pos);
    },
});
```

## Fights

Pure functions exported from `@sc-bot/core`. They simulate a fight between two lists of units and grade the outcome on ares' 0 to 10 scale, so ares thresholds carry over.

Health is health plus shields on both sides. Every quarter second, each unit deals its `calculateDpsVsTarget` damage (upgrades, armor, attributes and air/ground targeting included, see [Unit](units.md#unit)) to the enemy with the least health that it can hit, skipping enemies already dealt enough to die, and both sides take their damage at the same time. A sieged tank can't hit enemies closer than 2 (edge to edge). The fight ends when a side has no units left, when neither side can hurt the other, or after `maxSeconds`. A side with units left against none wins; otherwise the side with the larger fraction of its health left wins, and equal fractions are a tie. An empty enemy list gives `VICTORY_EMPHATIC`, an empty own list `LOSS_EMPHATIC`, both empty `TIE`. See [known limitations](compatibility.md#known-limitations) for what it doesn't model.

#### `simulateFight(own: Unit[], enemy: Unit[], opts?: FightOptions) => FightSimulation`

```ts
// signature sketch
FightOptions = {
    timingAdjust: true, // each unit starts once it could reach the closest enemy it can hit
    workersDoNoDamage: false, // workers on both sides deal no damage
    maxSeconds: 60, // normal-speed seconds (16 game loops each, the time base of the unit data)
};
FightSimulation = {
    ownWins: boolean;
    ownHealthLeft: number;
    enemyHealthLeft: number;
    ownHealthStart: number;
    enemyHealthStart: number;
    seconds: number; // simulated time
};
```

With `timingAdjust`, each unit starts firing once it could have reached the closest enemy it can hit: the edge-to-edge gap minus its range, at its `realSpeed()`. A unit that can't move waits for the enemy to walk in. Without it every unit fires from the start. Use `simulateFight` to build your own grading.

#### `canWinFight(own: Unit[], enemy: Unit[], opts?: FightOptions) => EngagementResult`

Runs `simulateFight` and grades it. The results are constants in `@sc-bot/core/constants/engagement-result`; `EngagementResult` is the union `0 | 1 | ... | 10`. A win is graded by the fraction of your health left, a loss by the fraction of the enemy's:

| Result | Value | When |
|---|---|---|
| `VICTORY_EMPHATIC` | 10 | Win with at least 90% left |
| `VICTORY_OVERWHELMING` | 9 | Win with at least 75% |
| `VICTORY_DECISIVE` | 8 | Win with at least 60% |
| `VICTORY_CLOSE` | 7 | Win with more than 40% |
| `VICTORY_MARGINAL` | 6 | Win with more than 20% |
| `TIE` | 5 | Win with 20% or less, loss with the enemy at 20% or less, or equal fractions |
| `LOSS_MARGINAL` | 4 | Loss, enemy has more than 20% left |
| `LOSS_CLOSE` | 3 | More than 40% |
| `LOSS_DECISIVE` | 2 | More than 60% |
| `LOSS_OVERWHELMING` | 1 | At least 75% |
| `LOSS_EMPHATIC` | 0 | At least 90% |

```ts
import { canWinFight } from '@sc-bot/core';
import type { World } from '@sc-bot/core';
import { VICTORY_CLOSE } from '@sc-bot/core/constants/engagement-result';
import { ATTACKING } from '@sc-bot/core/constants/unit-role';

export async function onStep({ resources }: World) {
    const { actions, map, spatial, squads } = resources.get();
    const squad = squads.getMainSquad(ATTACKING);
    if (!squad) return;

    const enemies = spatial.unitsInRange(squad.position, 15, 'enemy');
    if (canWinFight(squad.units, enemies) >= VICTORY_CLOSE) {
        await actions.attackMove(squad.units, enemies.empty ? map.getEnemyNatural().townhallPosition : enemies.first.pos);
    } else {
        await actions.move(squad.units, map.getNatural().townhallPosition);
    }
}
```
