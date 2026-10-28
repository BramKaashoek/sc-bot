# Glossary

What the words mean across the API, and which members use them. Behaviour lives on the linked pages.

- [Structure and building](#structure-and-building)
- [Gas geyser and gas mine](#gas-geyser-and-gas-mine)
- [Townhall, base and expansion](#townhall-base-and-expansion)
- [Unfinished, pending and in progress](#unfinished-pending-and-in-progress)
- [Near and at](#near-and-at)
- [Earmark, role, label](#earmark-role-label)
- [Opening, task, target](#opening-task-target)
- [Known deviations](#known-deviations)

## Structure and building

A **structure** is a unit with the `STRUCTURE` attribute, and "structure" is the word for the unit category: `unit.isStructure()`, `units.getStructures()`, `units.getEnemyStructures()`, `agent.structureTypeBuildProgress`, `buildStructure`, `TrackedBuild.structureTag`. **`buildings`** is not a category; it is the resource that tracks structures being built: `buildings.build`, `buildings.buildGas`, `buildings.pending`. See [units](docs/units.md#unit) and [buildings](docs/macro.md#buildings).

## Gas geyser and gas mine

A **gas geyser** is the neutral vespene geyser on the map: `units.getGasGeysers`, `map.freeGasGeysers`, `TrackedBuild.geyserTag`, the `geyser` option of `buildings.buildGas`. A **gas mine** is your own extractor, refinery or assimilator on a geyser: `units.getGasMines`, `unit.isGasMine()`, `actions.buildGasMine`. A worker mines it with `actions.mine(workers, gasMine)`. See [units](docs/units.md#units-resource) and [map](docs/map.md#map-resource).

## Townhall, base and expansion

A **townhall** is a unit of a townhall type (Command Center, Nexus, Hatchery and their upgrades): `unit.isTownhall()`, `OwnedExpansion.townhall`, `BaseThreat.townhall`, `townhallPosition`. A **base** is a townhall used as a place or as a unit: `units.getBases`, `expansion.getBase`, the `base` option of controllers and `mapAnalysis.getBaseChokes`. An **expansion** is a location where a townhall can stand, with or without one built: the `Expansion` type, `map.getExpansions`, `map.getAvailableExpansions`, `map.getOccupiedExpansions`, `buildings.getNextExpansion`, `expansionController`. See [map](docs/map.md#expansion).

## Unfinished, pending and in progress

**Unfinished** is a unit with `buildProgress < 1`: `units.getUnfinished`. **In progress** is the same, restricted to your units of one type: `units.inProgress`. **Pending** is wider: something ordered or tracked that may not exist as a unit yet.

- `agent.alreadyPending`: orders, unfinished units and tracked builds not yet ordered.
- `buildings.pending`: active tracked builds not adopted from a unit.
- `units.getPendingAt`: unfinished units plus workers ordered to build near a point.
- `includePending` (`units.getArmyValue`): units still in production orders.
- `maxPending`: a cap, on `agent.alreadyPending` in `expansionController` and on `buildings.pending` in `gasBuildingController`.

See [macro](docs/macro.md#agent-macro-helpers) and [units](docs/units.md#units-resource).

## Near and at

**Near** is approximate: the result is somewhere close, and the search finds the exact spot. **At** is exact: nothing is searched. `near` is an anchor in `actions.findPlacement(type, near)`, `mining.selectWorker(near)` and the build task option `opts.near` (a unit type whose first unit anchors placement); `nearPosition` is the anchor of `WarpInOptions`. `at` is the target in `BuildOptions.at` and the build task option `opts.at` (a [build target](docs/build-orders.md#build-targets)). The `*Near*` and `*In*` names (`groundNearBase`, `unitsInRange`) are distance thresholds, not anchors.

## Earmark, role, label

An **earmark** is a named amount of minerals and gas that [`canAfford`](docs/agents.md#cost-supply-and-affordability) leaves alone for other spenders: `Earmark`, `data.addEarmark`, `data.settleEarmark`, `BuildOptions.earmark`, `buildOptions.earmarks`, `earmarkDelay`. See [earmarks](docs/resources.md#earmarks).

A **role** is the one job a unit has, held by the `roles` resource, not on the unit: `UnitRole`, `roles.assign`, `roles.roleOf`, `behaviors.run` `opts.role`. See [roles](docs/combat.md#roles).

A **label** is a named flag with a value, held on the unit: `unit.addLabel`, `unit.labels`, `units.withLabel`, `Expansion.labels`, unit systems' `labels`. Roles are not labels. See [labels](docs/units.md#labels).

## Opening, task, target

An **opening** is a named build order with options: `OpeningDefinition`, `openings`, `switchOpening`, `getOpening`. See [openings](docs/build-orders.md#openings).

A **task** is one step of a build order, an object made by `taskFunctions` (`BuildTaskI`): build, train, upgrade, ability, scout or add-on swap. See [tasks](docs/build-orders.md#tasks).

A **target** is what a command or step is aimed at, and its type depends on where it appears:

- A `Unit` or `Point2D` for commands and behaviors: `actions.move`, `AbilityOptions.target`, the `target` of combat behaviors.
- A `BuildTarget` constant name such as `RAMP` for build-order steps: `opts.at`, `waypoints`.
- A unit type picking the unit to aim at in the ability task option `opts.target`.
- A `Point2D` where a tracked build goes: `TrackedBuild.target`.

## Known deviations

No renames; these are where the names above disagree.

- Structure and building: `actions.swapBuildings` handles structures but says "buildings"; the `BUILDING` role is a worker that is building; `buildStructure` takes `structureType` while `buildings.build` takes `unitType`.
- Gas: `buildings.buildGas`, `actions.buildGasMine` and `gasBuildingController` name the same thing three ways; `map.freeGasGeysers` and `units.getGasGeysers` carry "Gas", while the `vespeneGeysers` field and `vespeneGeyserTypes` carry "vespene"; `MiningAssignment.kind` is `'gas'`.
- Townhall, base and expansion: `units.getBases` is townhalls; `expansion.getBase` returns a townhall; `townhallPosition` is the expansion's location; `upgradeCCs` names the Command Center; `townhallTag` on `MiningAssignment`.
- Pending: the five meanings above; `maxPending` means a different count in each controller.
- Near: `near` is a position in `findPlacement` and `selectWorker` but a unit type in `opts.near`; `getPendingAt` takes `maxDistance` instead of a near anchor.
- Target: the four meanings above; `opts.target` is a unit type while every other `target` is a position or unit.
- Earmark: `canAfford(unitType, earmarkName)` is a name, `BuildOptions.earmark` is a name, `buildOptions.earmarks` is a delay in loops, and the task field `earmarked` is a boolean.
