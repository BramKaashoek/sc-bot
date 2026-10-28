# Constants

Ids, enums, unit groups, lookup tables and tuning data live under `@sc-bot/core/constants/<module>`, one module per file in [`constants/`](../constants). The package exposes the folder through its `exports` map, so a module is imported by name, without the `.ts`. Only the influence tables are also on the root export (see [`constants/influence`](#constantsinfluence)). Types such as `UnitRole` and `EngagementResult` come with their module.

The id modules and the dictionaries are generated from SC2 4.10's own game data (`bun run generate:data`; `bun run check:data` fails when a file differs from a fresh generation), not copied from python-sc2's tables, which come from a newer version. Names that existed in node-sc2 are kept, so some old ids sit next to the 4.10 ones: `MOVE`, `PATROL` and `HOLDPOSITION` exist alongside `GENERAL_MOVE`, `GENERAL_PATROL` and `GENERAL_HOLDPOSITION`, and the unit predicates accept both.

```ts
import { researchedFrom } from '@sc-bot/core/constants/dicts/researched-from';
import { trainedFrom } from '@sc-bot/core/constants/dicts/trained-from';
import { townhallTypes, workerTypes } from '@sc-bot/core/constants/groups';
import { UnitTypeId } from '@sc-bot/core/constants/index';
import { MARINE } from '@sc-bot/core/constants/unit-type';
import { STIMPACK } from '@sc-bot/core/constants/upgrade';

console.log(trainedFrom[MARINE].map((producer) => UnitTypeId[producer]));
console.log(UnitTypeId[researchedFrom[STIMPACK]]);
console.log(workerTypes.length, townhallTypes.length);
```

## Game data ids

### `constants/unit-type`, `ability`, `upgrade`, `buff`, `effect`

One `export const NAME = <id>` per game object: `MARINE`, `ATTACK_ATTACK`, `STIMPACK`, `STIMPACKMARAUDER`, `PSISTORMPERSISTENT`. Generated; do not edit. Import them as a namespace when you need a name from a variable: `import * as UnitType from '@sc-bot/core/constants/unit-type'`.

### `constants/enums`

The proto enums as plain objects, each with an `*Id` reverse map (`Race` and `RaceId`): `Alert`, `Alliance`, `Attribute`, `Difficulty`, `AIBuild`, `DisplayType`, `GameResult` (`VICTORY` 1, `DEFEAT` 2, `TIE` 3, `UNDECIDED` 4), `PlayerType`, `Race` (`NORACE` 0 to `RANDOM` 4), `Status` (the client status, `LAUNCHED` 1 to `QUIT` 6, `UNKNOWN` 99), `WeaponTargetType`, `AbilityDataTarget` and `CloakState`. `GameResultId` maps a `result` of a `PlayerResult` back to its name. `BuildOrder` and `BuildResult` are the status values of build tasks, with `BuildOrderId` as the reverse map of `BuildOrder`; the types `BuildOrderStatus` and `BuildResult` come with them.

`GameResult` here is the enum object; the type of the same name exported from `@sc-bot/core` is the `[World, PlayerResult[]]` tuple that `runGame` resolves with.

### `constants/index`

Namespaces of the modules above (`UnitType`, `Ability`, `Upgrade`, `Buff`, `Effect`, `enums`, `groups`, `UnitRole`, `EngagementResult`, `BuildTarget`), plus:

- `UnitTypeId`, `AbilityId`, `UpgradeId`, `BuffId`, `EffectId`: id to constant name, `Record<number, string>`.
- `Color` (the [`constants/color`](#constantscolor) table), `AbilitiesByUnit` (default export of `unit-ability-map`) and `WarpUnitAbility` (warp-gate unit type to its `TRAINWARP_*` ability: Zealot, Stalker, Sentry, Adept, High Templar, Dark Templar).
- The six influence tables and their types, re-exported from [`constants/influence`](#constantsinfluence).

## Groups and tables

### `constants/groups`

Unit-type and ability groups, all plain arrays or id records:

- Unit types: `workerTypes` (drone, probe, SCV, MULE), `townhallTypes`, `structureTypes`, `combatTypes`, `mineralFieldTypes`, `vespeneGeyserTypes`, `gasMineTypes`, `creepTumorTypes`, `techLabTypes`, `reactorTypes`, `addonTypes`, `flyingStructureTypes`, `unbuildablePlateTypes`, `halfSupplyTypes` (zerglings and banelings in all their forms).
- Abilities and buffs: `gatheringAbilities`, `returningAbilities`, `constructionAbilities`, `scvConstructionAbilities`, `attackingAbilities`, `repairingAbilities`, `carryingMineralsBuffs`, `carryingVespeneBuffs`.
- Id records: `burrowedTypes` (type to its burrowed form), `toggleAbilities` (type to the ability that toggles it, such as a depot's lower and raise), `transformingAbility` (flying structure or type to its landing ability), `addonHost` (add-on to its Barracks, Factory or Starport), `addonHostTypes`, `researcherEquivalents` (structures that research for each other: Spire and Greater Spire; Hatchery, Lair and Hive), `creationAbilityOverrides` (`LURKERMP` to `MORPH_LURKER`).

### `constants/dicts/*`

| Module | Export |
|---|---|
| `trained-from` | `trainedFrom[unitType]`: producer types |
| `researched-from` | `researchedFrom[upgradeId]`: the researching structure |
| `research-requirements` | `researchRequirements[upgradeId]`: `{ requiredBuilding?, requiredUpgrade?, ability? }`, type `ResearchRequirement` |
| `tech-requirement` | `techRequirement[unitType]`: the structure that unlocks it |
| `tech-alias` | `techAlias[unitType]`: the base types this variant stands in for (a sieged tank for a tank) |
| `unit-alias` | `unitAlias[unitType]`: the base type of a variant (the changeling forms to `CHANGELING`) |
| `unit-abilities` | `unitAbilities[unitType]`: abilities the type can use, from 4.10's data |

`researchRequirements` is ported from python-sc2's `RESEARCH_INFO`, because the API data has no research requirements. `techRequirement` also lists requirements 4.10's data leaves out (ghost: ghost academy, thor: armory, battlecruiser: fusion core, mothership: fleet beacon, as in python-sc2's `TRAIN_INFO`); `agent.hasTechFor`, `techRequirementProgress`, `train`, `actions.build` and `actions.train` all respect them.

Terran vehicle and ship plating is one upgrade line on 4.10 (`TERRANVEHICLEANDSHIPARMORSLEVEL1` to `3`), researched at the armory. 4.10's data points those upgrades at abilities the armory doesn't have, so `researchRequirements` carries the armory's `RESEARCH_TERRANVEHICLEANDSHIPPLATINGLEVEL1` to `3` as their `ability`, which `research` and `alreadyPendingUpgrade` use, and `actions.upgrade` sends it too. The old separate `TERRANVEHICLEARMORSLEVEL*` and `TERRANSHIPARMORSLEVEL*` constants still exist but are not in `researchedFrom`, since nothing researches them.

### `constants/unit-ability-map`

Default export `UnitAbilityMap` (`AbilitiesByUnit` in `constants/index`): unit type to the ability ids it may have, captured by hand. `world.data.findUnitTypesWithAbility` uses it for abilities the generated `unit-abilities` never recorded, and only while the game data marks the ability available.

### `constants/race-map`

Per-race lookups keyed by `Race`: `WorkerRace`, `TownhallRace` (a list per race), `FlyingTownhallRace` (Terran's flying command center and orbital), `TownhallWithFlyingRace` (townhalls plus the flying ones), `GasMineRace`, `SupplyUnitRace` and `HarvestGatheringRace` (the gather ability of each worker).

## Domain constants

### `constants/unit-role`

ares' unit roles as string constants (`ATTACKING`, `GATHERING`, `BUILD_RUNNER_SCOUT`, ...), and the type `UnitRole`. Used by [`roles`](combat.md#roles).

### `constants/engagement-result`

The [fight](combat.md#fights) scale `LOSS_EMPHATIC` (0) to `TIE` (5) to `VICTORY_EMPHATIC` (10), and the type `EngagementResult`.

### `constants/build-target`

The `BuildTarget` names as strings: `RAMP`, `NAT`, `NAT_WALL`, `REAPER_WALL`, `THIRD`, `FOURTH`, `FIFTH`, `SIXTH`, `SPAWN`, `MAP_CENTER`, `ENEMY_SPAWN`, `ENEMY_NAT`, `ENEMY_THIRD`, `ENEMY_FOURTH`, `ENEMY_RAMP`, `ENEMY_NAT_VISION`, `SUPPLY`, `PRODUCTION`, `UPGRADE`, `BUNKER`. What each resolves to is in [build-orders.md](build-orders.md#build-targets).

### `constants/combat`

Unit speed and damage data read by `unit.realSpeed()` and the damage helpers:

- `speedUpgrade[unitType]` is the upgrade id that raises a unit's speed and `speedIncrease[unitType]` the factor it applies.
- `speedIncreaseOnCreep[unitType]` is the factor on creep. `offCreepSpeedUpgrade` and `offCreepSpeedIncrease` are the same pair for units whose upgrade only works off creep (hydralisk, ultralisk).
- `speedAlteringBuffs[buffId]` is the factor a buff applies (stimpack, charge, fungal growth, time warp, inhibitor zone). `CONCUSSIVE_SLOW_BUFF` (226) is the id of the marauder slow, which 4.10 leaves unnamed.
- `damageBonusPerUpgrade[unitType][WeaponTargetType]` holds a weapon's per-upgrade damage as `{ base?, [Attribute]: bonus }` (type `UpgradeDamageBonus`).

### `constants/detection`

`DETECTOR_RANGES[unitType]`: how far a detector sees cloaked units, as detection radius plus the detector's own radius plus a margin of 1 (observer, observer sieged, photon cannon, raven, missile turret, overseer, overseer sieged, spore crawler). `SCANNER_SWEEP_RANGE` is the same for a scanner sweep (14). [`intel`](combat.md#intel) reads both.

### `constants/aoe`

`AOE_ABILITIES`, a `ReadonlyMap<abilityId, AoeAbility>` with `AoeAbility = { radius, range, effectId?, buffId? }`, for the area spells the [AoE behaviors](behaviors.md) cast: blinding cloud, corrosive bile, anti-armor missile, EMP, fungal growth, KD8 charge, parasitic bomb, psionic storm and nuke. The effect or buff id is how a behavior tells that the spell is already active at a spot. It is a `Map` because the behaviors try abilities in table order, which an integer-keyed object would reorder.

### `constants/influence`

The tables for [`influence`](map.md#influence), also exported from the root, are documented with the [influence constants](map.md#influence-constants).

## Small modules

### `constants/color`

Default export: named RGB colors for debug drawing (`Color.RED`, `Color.LIME_GREEN`, ...), each `{ r, g, b }`. Also `Color` in `constants/index`.

### `constants/time`

`GAME_LOOPS_PER_SECOND`, `22.4`: game loops per real second at Faster speed. `frame.time()` divides the game loop by it, and `gameTimeLimit` is measured with it.
