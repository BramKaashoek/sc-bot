# Units

Everything on the board is a [`Unit`](#unit): your army and buildings, the enemy's, minerals, geysers, rocks and xel'naga towers. The engine keeps one `Unit` object per tag and updates it in place every step, so a reference you hold stays valid for the whole game. Units your own side lost, and neutral ones that died, stay in the store labelled `dead`; enemies are kept as [memory](#memory) after they leave vision.

Four resources cover them:

- [`units`](#units-resource) is the store with the getters. Every getter returns a [`Units`](#the-units-collection) collection.
- `Units` is an `Array<Unit>` subclass with filters, set operations and distance queries, so queries chain.
- [`memory`](#memory) holds enemies that left vision (ghosts).
- [`spatial`](#spatial) answers range queries over enemy and own units.

All four come from `resources.get()`; see [resources.md](resources.md#resourcesget) for the full list. To order units around, see [commands.md](commands.md#actions); for roles and squads, [combat.md](combat.md).

Where a getter takes a `filter`, it is an `Alliance` value (`Alliance.ENEMY`) or a filter object that is matched field by field against each unit (`units.getAlive({ isFlying: true })`). A filter object with an `alliance` field only searches that alliance's units. Distances are always center to center.

## `units` resource

#### `units.getAll(filter?: Alliance | UnitFilter | ((unit: Unit) => boolean)) => Units`

Every unit the engine knows: the current ones, enemies kept as memory, and own and neutral units that died (labelled `dead`) or left the observation. Without a filter that is your own, enemy and neutral units (allied units are left out). Use it with a filter; `getAlive` is what you usually want.

#### `units.getAlive(filter?: Alliance | UnitFilter) => Units`

The units from `getAll` that are current: their data arrived in this step. Enemies out of vision are not current, snapshots seen this step are.

#### `units.getById(unitType: number | number[], filter: UnitFilter = { alliance: Alliance.SELF }) => Units`

Alive units of those types. Passing a `filter` replaces the default, so include `alliance` in it if you still want only your own. `getByType` is the variant for every alliance.

```ts
import type { World } from '@sc-bot/core';
import { Alliance } from '@sc-bot/core/constants/enums';
import { ZEALOT } from '@sc-bot/core/constants/unit-type';

export async function onStep({ resources }: World) {
    const { units } = resources.get();
    const zealots = units.getById(ZEALOT);
    const enemyZealots = units.getById(ZEALOT, { alliance: Alliance.ENEMY });
    console.log(zealots.length, enemyZealots.length);
}
```

#### `units.getByType(unitType: number | number[]) => Units`

Alive units of those types, of any alliance. No filter.

#### `units.getByTag(tag: string) => Unit | undefined`

#### `units.getByTag(tags: string[]) => Units`

One tag gives the `Unit`, or `undefined` for an unknown tag. An array gives the known units as `Units`, leaving out unknown tags. Looks in your own, neutral and enemy units, so a dead unit is found too.

#### `units.getBases(filter: Alliance | UnitFilter = { alliance: Alliance.SELF }) => Units`

Alive townhalls.

#### `units.getWorkers(includeBusy = false) => Units`

Own workers of your race. Unless `includeBusy`, it leaves out workers carrying the `command` label, which `actions.build` sets when it sends a worker off until SC2 reports the order back (or 250 game loops pass).

#### `units.getIdleWorkers() => Units`

`getWorkers()` with an empty order queue.

#### `units.getMineralWorkers() => Units`

`getWorkers()` with exactly one order, a gather order (gas workers included), and no labels at all. A labelled worker (an unacknowledged command, a role marker of yours) does not count.

#### `units.getConstructingWorkers() => Units`

Own workers, busy ones included, with a construction order.

#### `units.getCombatUnits(filter: Alliance | UnitFilter = Alliance.SELF) => Units`

Alive combat units, your whole army by default. A unit is a combat unit when `isCombatUnit()` says so.

#### `units.getRangedCombatUnits() => Units`

Your combat units with a weapon whose range is above 1.

#### `units.getStructures(filter: UnitFilter = { alliance: Alliance.SELF }) => Units`

Alive units with the structure attribute.

#### `units.getUnfinished(filter?: UnitFilter) => Units`

#### `units.inProgress(unitType: number) => Units`

Alive units with `buildProgress < 1` (buildings under construction, morphing or warping in). `inProgress` is your own units of one type.

#### `units.getIdle() => Units`

Your alive units with an empty order queue.

#### `units.getProductionUnits(unitType: number) => Units`

Your alive units that can produce `unitType` (`MARINE` gives your barracks), from `trainedFrom`: gateway units include warp gates, and an add-on type gives only its own host (`BARRACKSTECHLAB`: barracks). Enemy buildings are never included.

#### `units.getUpgradeFacilities(upgradeId: number) => Units`

Your alive units that can research `upgradeId` (`CHARGE` gives your twilight councils), from `researchedFrom`, with lairs and hives for hatchery research and greater spires for spire research.

#### `units.getPendingAt(unitType: number | number[], position: Point2D, maxDistance = 1) => Units`

Your unfinished units of those types closer than `maxDistance` to `position`, plus workers that have a build order for one of those types targeting a spot within `maxDistance`.

#### `units.getMineralFields(filter?: UnitFilter) => Units`

#### `units.getGasGeysers(filter?: UnitFilter) => Units`

#### `units.getGasMines(filter: Alliance | UnitFilter = Alliance.SELF) => Units`

Mineral fields and vespene geysers across the whole map, and gas buildings (own by default).

#### `units.getEnemyUnits() => Units`

#### `units.getEnemyStructures() => Units`

Enemies in the current observation, non-structures and structures. Ghosts are not included; use [`memory.getEnemies`](#memory) for them.

#### `units.getDestructables() => Units`

#### `units.getWatchtowers() => Units`

#### `units.getLarva() => Units`

Neutral units that are not minerals, geysers or xel'naga towers (rocks and the like); xel'naga towers; your larva.

#### `units.withLabel(label: string) => Units`

Alive units carrying the label (see [Labels](#labels)).

#### `units.withCurrentOrders(abilityId: number) => Units`

Your alive units with that ability anywhere in their order queue. Useful to see whether a command already went out in a recent step.

#### `units.getArmyValue(alliance: Alliance.SELF | Alliance.ENEMY = Alliance.SELF, opts: { includePending = false, includeGhosts = true }) => number`

Minerals plus gas of the combat units, each at its type's full cost (a morphed unit is worth its full cost, not the net morph cost). For `ENEMY` it reads [memory](#memory), ghosts included unless `includeGhosts: false`. For `SELF`, `includePending` also counts the units in production: the first order of finished non-townhall structures (two with a reactor) and eggs. `includeGhosts` has no effect for `SELF`, and `includePending` none for `ENEMY`. Throws `NodeSC2Error` for any other alliance.

#### `units.clone() => Map<string, Unit>`

A data-only deep copy of your, enemy and neutral units keyed by tag: no methods, labels copied. It serialises every unit, so avoid it in hot paths.

## The `Units` collection

`Units` is a subclass of `Array<Unit>` and works anywhere a `Unit[]` does. `filter`, `slice`, `concat`, `splice` and `reverse` return `Units` again, as do the selection helpers below, so calls chain. `map` and `flatMap` return a `Units` only when the callback returns units; `units.map(unit => unit.tag)` is a plain `string[]`. `Units` is exported from `@sc-bot/core`; `Units.from(unitArray)` wraps a plain array.

Where a `position` is taken it is a `Unit` or a `Point2D`. Distance cutoffs are strict: `closerThan` keeps units under the distance, `furtherThan` over it, and `inDistanceBetween` over `min` and under `max`.

```ts
import type { World } from '@sc-bot/core';
import { MARAUDER, MARINE } from '@sc-bot/core/constants/unit-type';

export async function onStep({ resources }: World) {
    const { units, map, actions } = resources.get();
    const army = units.getById([MARINE, MARAUDER]).ready;
    const enemies = units.getEnemyUnits().visible;
    if (army.empty) return;

    const front = army.closestTo(map.getEnemyMain().townhallPosition);
    const threats = enemies.closerThan(12, front).sortedByDistanceTo(front);
    const stragglers = army.idle.furtherThan(15, army.center);

    if (threats.exists) {
        await actions.attackMove(army, threats.first.pos);
    } else if (stragglers.exists) {
        await actions.move(stragglers.take(8), front.pos);
    }
}
```

#### Empty collections

These throw `Error` on an empty `Units`, so check `exists` first, or use `randomOr`:

- `first`, `random`, `center`
- `closestTo`, `furthestTo`, `closestDistanceTo`, `furthestDistanceTo`
- `inClosestDistanceToGroup`

`inDistanceOfGroup` and `inClosestDistanceToGroup` also throw when `other` is empty, and `byTag` throws when the tag is missing. Everything else returns an empty collection.

#### Properties

```text
amount: number, empty: boolean, exists: boolean
first: Unit, random: Unit, center: Point2D, tags: Set<string>
```

Each of these returns `Units`:

```text
ready          buildProgress >= 1
notReady       buildProgress < 1
idle           empty order queue
flying         isFlying, including units lifted by a graviton beam
notFlying
structures, notStructures
selected       selected in the SC2 UI
visible        displayType VISIBLE and not a snapshot
mineralFields
gathering      first order is a gather order, MULEs included
returning      first order is a return-cargo order
collecting     gathering or returning
preferIdle     the same units, idle ones first
```

#### Set operations and selection

```text
copy() => Units
union(other), intersection(other), difference(other) => Units    // by tag
findByTag(tag) => Unit | undefined
byTag(tag) => Unit
take(count) => Units
randomGroupOf(count) => Units
randomOr(fallback) => Unit | Fallback
tagsIn(tags), tagsNotIn(tags) => Units
ofType(types), excludeType(types) => Units
sameTech(types), sameUnit(types) => Units
sorted(key: (unit) => Key, reverse = false) => Units
```

`take` and `randomGroupOf` always return a new collection. `take(count)` is empty for a negative `count`; `randomGroupOf(count)` is empty for a `count` below 1. `sameTech` also matches the types' tech aliases from the game data, and `sameUnit` their unit aliases.

#### Distance

```text
closestTo(position) => Unit
furthestTo(position) => Unit
closestDistanceTo(position), furthestDistanceTo(position) => number
closerThan(distance, position), furtherThan(distance, position) => Units
inDistanceBetween(position, min, max) => Units
closestNUnits(position, count), furthestNUnits(position, count) => Units
nClosestToDistance(position, distance, count), nFurthestToDistance(position, distance, count) => Units
inDistanceOfGroup(other: Units, distance) => Units
inClosestDistanceToGroup(other: Units) => Unit
sortedByDistanceTo(position, reverse = false) => Units
inAttackRangeOf(unit, bonusDistance = 0) => Units
```

`nClosestToDistance` and `nFurthestToDistance` sort ascending by how far each unit's distance is from the given `distance`, then take the first or last `count`; `nFurthestToDistance` with a `count` of 0 or below returns an empty collection. `inAttackRangeOf(unit)` keeps the units that `unit.targetInRange` can hit.

**Testing note.** Because the getters (and `map` of their results to units) return `Units` instead of plain arrays, `expect(units.getWorkers()).toStrictEqual([...])` and `assert.deepStrictEqual` fail against a plain array (the prototypes differ). `toEqual` works.

## `Unit`

A `Unit` is the proto `SC2APIProtocol.Unit` (tag, unitType, alliance, pos, health, shield, energy, orders, buffIds, buildProgress, ...) plus the methods below, `noQueue` (empty order queue as of the last update), `lastSeen` (the game loop it was last in an observation) and the [labels](#labels) map. `unit.pos` is a `Point3D`.

The properties `buffDurationRemain` and `buffDurationMax` carry buff time, and `attackUpgradeLevel`, `armorUpgradeLevel` and `shieldUpgradeLevel` carry upgrade levels. Enemy upgrade levels aren't observable.

#### Identity and state

```text
is(unitType) => boolean
isWorker(), isTownhall(), isStructure(), isGasMine(), isMineralField(), isCombatUnit()
isEnemy(), isFinished(), isCurrent(), isIdle(), isCloaked(), isSnapshot(), isMemory()
age() => number                       // seconds since last seen
isMoving(), isAttacking(), isPatrolling(), isRepairing(), isHolding(), isTransforming()
isGathering(type?: 'minerals' | 'vespene'), isReturning(), isCollecting()
isConstructing(), isConstructingScv()
isCarryingMinerals(), isCarryingVespene(), isCarryingResource()
isUsingAbility(abilityIds: number | number[])
isFlyingOrGravitoned()
```

`isCurrent()` is true when the unit was in this step's observation. `isMemory()` is `true` for a unit that is not current and not labelled `dead`: an enemy ghost. `isSnapshot()` is `displayType === SNAPSHOT`; on SC2 versions before 5.0.4 (base build 82457, which includes 4.10) the API misreports `displayType`, so there it falls back to the visibility grid, as python-sc2 does (the `visible` filter follows).

#### Attributes

```text
isLight(), isArmored(), isBiological(), isMechanical(), isMassive(), isPsionic()
```

#### Buffs, add-ons, harvesting

```text
buffs() => Set<number>, hasBuff(buffId) => boolean
hasAddOn(), hasReactor(), hasTechLab() => boolean
addOnPosition(), addOnLandPosition() => Point2D
surplusHarvesters() => number         // assigned minus ideal
```

#### Combat

```text
groundDps(), airDps(), groundRange(), airRange(), sightRange(), movementSpeed() => number
realSpeed() => number                 // with speed upgrades, creep and speed-changing buffs
weaponReady(), canShootUp() => boolean
distanceToWeaponReady() => number     // how far it can move before its weapon is ready again; negative for units that can't attack
targetInRange(target, bonusDistance = 0) => boolean
inAbilityCastRange(abilityId, target: Unit | Point2D, bonusDistance = 0) => boolean
calculateDamageVsTarget(target, ignoreArmor = false, includeOverkillDamage = true) => [damage, weaponSpeed, weaponRange]
calculateDpsVsTarget(target, ignoreArmor = false, includeOverkillDamage = true) => number
isFacing(other, angleError = 0.05) => boolean
distanceTo(target: Unit | Point2D) => number
```

The combat math follows python-sc2: armor and shield armor, upgrade levels, attribute bonuses, guardian shield, shredder missile, stim, and range and attack-speed upgrades. Upgrade-dependent bonuses only apply to your own units. `distanceTo` is the plain center-to-center distance, ignoring radii.

```ts
import type { Unit, World } from '@sc-bot/core';
import { STIMPACK } from '@sc-bot/core/constants/buff';
import { MARINE } from '@sc-bot/core/constants/unit-type';

export async function microMarines({ resources }: World) {
    const { units, actions } = resources.get();
    const enemies = units.getEnemyUnits();
    if (enemies.empty) return;

    for (const marine of units.getById(MARINE)) {
        const targets = enemies.inAttackRangeOf(marine);
        if (targets.empty || !marine.weaponReady()) continue;

        const bestTarget: Unit = targets.sorted(enemy => marine.calculateDpsVsTarget(enemy), true).first;
        const [damage, weaponSpeed, range] = marine.calculateDamageVsTarget(bestTarget);
        console.log(damage, weaponSpeed, range, marine.hasBuff(STIMPACK), marine.realSpeed());
        await actions.attack([marine], bestTarget);
    }
}
```

#### Abilities and commands

```text
availableAbilities() => number[]
abilityAvailable(abilityId) => boolean
fetchAvailableAbilities() => Promise<number[]>
canInject(), canBlink(), canMove() => boolean
useAbility(abilityId, { target?, queue? }) => Promise<void>
inject(target?: Unit) => Promise<void>
blink(target: Point2D, opts?) => Promise<void>
burrow(opts?) => Promise<void>
toggle(opts?) => Promise<void>
```

`availableAbilities()` and `abilityAvailable()` read this step's ability query; `fetchAvailableAbilities()` queries SC2 and caches per game loop. With the agent setting `skipAvailableAbilitiesQuery`, the synchronous accessors only return what `fetchAvailableAbilities()` fetched this step. `useAbility`, `inject`, `blink`, `burrow` and `toggle` propose a command like `actions.do` does, so they go through [command arbitration](commands.md#command-arbitration). `burrow()` burrows any unit that can, and `toggle()` switches any two-way morph (siege mode, depots, burrow, phasing, ...). `inject`, `blink`, `burrow` and `toggle` do nothing (resolve with no value) when the unit can't do it right now. `toggle` defaults to `queue: true`. `inject()` without a target picks the closest idle hatchery among the 3 closest to the queen, and does nothing when none of them is idle.

#### Labels

```text
addLabel(name, value) => Map<string, any>
hasLabel(name) => boolean
getLabel(name) => any
removeLabel(name) => boolean
hasNoLabels() => boolean
labels: Map<string, any>
```

A label is a flag with a value that you or the engine attach to a unit. The engine sets `command` (the game loop of a command SC2 hasn't reported back yet; dropped when it does, or after 250 loops), `dead` (a unit SC2 reported dead) and `stuck` (a worker whose command never came back; dropped once it idles). Only `command` and `stuck` change which worker a build picks; labels of your own don't. Any label keeps a worker out of `units.getMineralWorkers()`.

#### Data

```text
data() => UnitTypeData
typeData(unitType) => UnitTypeData | undefined
getLife() => number                   // health as a percentage
```

`data()` is the game data of this unit's type, `typeData(type)` that of any type.

## `memory`

Enemies that leave vision stay in `units` as ghosts (`unit.isMemory()`) until `memory` forgets them. Each step, a ghost is deleted when it is older than its expiry (`unit.age()` past `expireAir` for flying units, `expireGround` otherwise), or when the four cells around its last position are all visible and it isn't burrowed. A burrowed ghost stays until it expires. Enemies whose death SC2 reports are removed right away. `getAll(Alliance.ENEMY)` includes ghosts, `getAlive` doesn't.

#### `memory.getGhosts() => Units`

Enemies out of vision that are still remembered.

#### `memory.getSnapshots() => Units`

Current enemy snapshots (structures seen through the fog).

#### `memory.getEnemies(opts: { includeGhosts = true, structures = true }) => Units`

Every known enemy, ghosts included unless `includeGhosts: false`, structures included unless `structures: false`.

#### `memory.forget(tag: string) => void`

Deletes a ghost now. If the tag is seen again, `onEnemyUnitEnteredVision` fires but `onEnemyFirstSeen` doesn't.

#### `memory.configure(settings: Partial<{ expireGround: number; expireAir: number }>) => void`

Expiry in game seconds, both `30` by default. A new game keeps these settings; see [per-game reset](resources.md#per-game-reset).

```ts
import type { World } from '@sc-bot/core';

export async function onGameStart({ resources }: World) {
    resources.get().memory.configure({ expireGround: 60 });
}

export async function onStep({ resources }: World) {
    const { memory } = resources.get();
    const remembered = memory.getEnemies({ structures: false });
    console.log(`${remembered.length} enemy units known, ${memory.getGhosts().length} out of vision`);
}
```

## `spatial`

Range queries over enemy and own units. The index is rebuilt on the first query of each game loop, so later queries in the same loop are cheap. Enemies come from `memory.getEnemies()`, so ghosts are included; own units are the alive ones. Each query takes a `kind`: `'enemy'`, `'enemyGround'`, `'enemyAir'`, `'own'`, `'ownGround'` or `'ownAir'` (`SpatialKind`). Ground and air are split by `isFlying` (or a graviton beam), so landed structures count as ground and lifted ones as air.

Result order isn't stable: `unitsInRange` returns units in bucket order, not in the order they were added, and `closest` breaks ties between equal distances by bucket ring order. Sort the result yourself if order matters.

#### `spatial.unitsInRange(from: Point2D | Unit, distance: number, kind: SpatialKind) => Units`

The units of that kind within `distance`.

#### `spatial.anyInRange(from: Point2D | Unit, distance: number, kind: SpatialKind) => boolean`

Whether there is at least one; stops at the first.

#### `spatial.closest(from: Point2D | Unit, kind: SpatialKind, maxDistance?: number) => Unit | undefined`

The closest unit of that kind, within `maxDistance` when given.

```ts
import type { World } from '@sc-bot/core';
import { MARINE } from '@sc-bot/core/constants/unit-type';

export async function onStep({ resources }: World) {
    const { actions, spatial, units } = resources.get();
    for (const marine of units.getById(MARINE)) {
        const target = spatial.closest(marine, 'enemyGround', 6);
        if (target) await actions.attack([marine], target);
    }
}
```
