# Map

Everything about where things are: the [`map`](#map-resource) resource (start locations, expansions, ramps, grids, local pathing), the [`Expansion`](#expansion), [`Ramp`](#ramp) and [`PixelMap`](#pixelmap) types it hands out, and four resources built on top of it:

- [`mapAnalysis`](#mapanalysis) splits the map into regions joined by chokes and answers where to hold a base.
- [`influence`](#influence) builds per-step danger grids from enemy units and effects.
- [`pathing`](#pathing) runs A* over those grids, so paths go around danger.
- [Points](#points) are the plain geometry helpers exported from `@sc-bot/core`.

Two path finders exist on purpose. `map.path` is a synchronous A* over the static pathing graph and ignores enemies; use it for map structure (expansion order, placement, regions). `pathing.findPath` and friends read the influence grids, which change every step; use them for unit movement that should react to threats. `map.queryPathing` asks SC2 itself.

Coordinates are `Point2D` (`{ x, y }`); a cell is addressed by its floored coordinates and grids are indexed `[y][x]`. The grids follow structures as they appear, die, lift off and land, so `isPlaceable`, `isPathable` and `path` see the world as it is now. Units and their queries are in [units.md](units.md); building placement in [macro.md](macro.md#placement).

## `map` resource

#### `map.getLocations() => { self: Point2D | undefined; enemy: Point2D[] }`

Your start location (`undefined` before the game starts) and the possible enemy start locations.

#### `map.getExpansions(alliance?: Alliance) => Expansion[]`

Every expansion, as a copy of the list, ordered by ground path length from your start location, or from the enemy's with `Alliance.ENEMY`. An expansion that can't be reached from the start comes last.

```ts
import { Alliance } from '@sc-bot/core/constants/enums';
import type { World } from '@sc-bot/core';

export async function onGameStart({ resources }: World) {
    const { map } = resources.get();
    const [main, natural] = map.getExpansions();
    const [enemyMain] = map.getExpansions(Alliance.ENEMY);
    console.log(main.townhallPosition, natural.townhallPosition, enemyMain.townhallPosition);
}
```

#### `map.getMain() => Expansion | undefined`

#### `map.getNatural() => Expansion | undefined`

#### `map.getThirds() => Expansion[]`

#### `map.getEnemyMain() => Expansion | undefined`

#### `map.getEnemyNatural() => Expansion | undefined`

#### `map.getEnemyThirds() => Expansion[]`

Shortcuts into `getExpansions()` (and `getExpansions(Alliance.ENEMY)`): the first, the second, and the third and fourth. The single-expansion getters are `undefined` when the list is too short, as on some custom maps. `getThirds` and `getEnemyThirds` return up to two expansions, fewer on maps with fewer than four bases; on most maps the third and fourth are interchangeable, and the closer one comes first.

```ts
const natural = map.getNatural();
if (!natural) return;
```

#### `map.getClosestExpansion(point: Point2D) => Expansion`

The expansion with the shortest `map.path` from `point` to a cell 3 off its townhall position on both axes (`add(townhallPosition, 3)`); a point on an unpathable cell starts from `closestPathable(point)`. Throws like `closestPathable` when there is no pathable cell near `point`. Falls back to the straight-line closest when no expansion is reachable.

#### `map.getAvailableExpansions() => Expansion[]`

Expansions with no known base (or whose base died), in `getExpansions()` order. A spot a pending townhall build is heading to still counts as available here; `buildings.getNextExpansion` skips it (see [macro.md](macro.md#buildings)).

#### `map.getOccupiedExpansions(alliance: Alliance = Alliance.SELF) => Expansion[]`

Expansions whose base is alive and belongs to `alliance`.

#### `map.getExpansionLocations() => Point2D[]`

The townhall center of every expansion, in `getExpansions()` order.

#### `map.freeGasGeysers() => Unit[]`

Geysers within 15 of one of your townhalls that have no gas building on them.

#### `map.getCombatRally() => Point2D`

A gathering point on the `map.path` from your natural towards the map center, 5% further along per base you own. It is the map center on a custom map (see `isCustom`). Use it as a rally point for units that have nowhere to be yet; use [`mapAnalysis.getDefensivePosition`](#mapanalysis) to hold a choke against an attack.

#### `map.isCustom() => boolean`

Whether the map has no expansions (a custom map without mineral clusters).

#### `map.getRamps() => Ramp[]`

#### `map.getMainBaseRamp() => Ramp | undefined`

Every [ramp](#ramp), and the one leading out of your main, or `undefined` on maps where none is found (some custom maps).

#### `map.getVisionBlockers() => Point2D[]`

The cells of vision-blocking terrain.

#### `map.isPathable(point: Point2D) => boolean`

Pathing as the map system tracks it: structures (your own and, from the step they are seen, the enemy's), minerals, geysers and rocks block cells. Lowered supply depots, and the corner cells of townhalls and nydus canals, stay pathable.

For a point off the grid, `isPathable`, `isPlaceable`, `isVisible` and `hasCreep` return `false` and `getHeight` returns `0`.

#### `map.isPlaceable(point: Point2D, opts?: MapPathOptions) => boolean`

#### `map.isPlaceableAt(unitType: number, position: Point2D, opts?: MapPathOptions) => boolean`

Placement as the map system tracks it, for one cell or for every cell of the unit type's footprint at `position`. Both are cheap lookups, not an SC2 query; for a placement SC2 agrees with, use [`actions.canPlace`](commands.md#actions). With `opts.graph` (a `PathFinding.js` grid, see `getGraph`) they test that graph's walkability instead.

#### `map.inPathingGrid(point: Point2D) => boolean`

#### `map.inPlacementGrid(point: Point2D) => boolean`

The static grids from the game info at game start: terrain only, no structures or rocks.

#### `map.isVisible(point: Point2D) => boolean`

Whether the cell is visible this step.

#### `map.hasCreep(point: Point2D) => boolean`

#### `map.getCreep() => Point2D[]`

Creep on one cell, and every creep cell on the map (scans the whole grid).

#### `map.isRamp(point: Point2D) => boolean`

Whether the cell is one of the ramp cells found on the minimap grid.

#### `map.getHeight(point: Point2D) => number`

node-sc2's height: the height grid value at the cell divided by 10.

#### `map.getTerrainHeight(point: Point2D) => number`

#### `map.getTerrainZHeight(point: Point2D) => number`

The raw height-map value (0 to 255) and that value as world z (`-16 + 32 * value / 255`). Both read the start grids, so they throw before game start.

#### `map.getSize() => { x: number; y: number }`

Map width and height in cells.

#### `map.getCenter(pathable = false) => Point2D`

The map center; with `pathable`, the closest pathable cell within 5 of it (`undefined` when there is none).

#### `map.closestPathable(point: Point2D, radius = 3) => Point2D`

The closest pathable cell within `radius`. Throws when there is none.

#### `map.getEffects() => SC2APIProtocol.Effect[]`

Active effects (storms, biles, liberator zones, ...) as of this step.

#### `map.getGrids() => Grids`

The live grids, indexed `[y][x]`: `{ height, placement, pathing, miniMap }`. In `pathing` a cell is `0` when pathable and `1` when blocked; in `placement` a nonzero cell is placeable; `height` values are the raw game-info heights (`getHeight` divides them by 10). `miniMap` is an experimental grid of minimap-like data. They are the grids behind `isPathable` and `isPlaceable`, so mutate them only through the engine.

#### `map.path(start: Point2D, end: Point2D, opts?: MapPathOptions) => number[][]`

A synchronous A* over the static pathing graph, as `[x, y]` cells from `start` to `end`; `[]` when there is no path. Only unpathable cells (structures, minerals, geysers, rocks, xel'naga towers) block it, so an `end` on such a cell, or a `start` surrounded by them (such as the `townhallPosition` of an occupied base), gives an empty path; start from a unit's `pos` or `map.closestPathable(point)`. Lowered depots, burrowed creep tumors and townhall and nydus corners are walkable, because the map system never blocks their cells (`pathingCells` in `utils/geometry/units.ts` leaves them out). Cells next to walls cost more, so paths keep off cliff edges.

Results are cached per start and end cell until the pathing grid changes, and the cached array is returned as is, so don't mutate it. `MapPathOptions` is `{ graph?, force?, diagonal? }`: `force` skips the cache, `graph` searches a graph you pass (never cached), `diagonal` is `true` by default. It can't know about anything the map system hasn't been told: no enemy units, no unseen structures.

#### `map.queryPathing(start: Point2D | Unit, end: Point2D) => Promise<number | null>`

SC2's own path length from a point or unit, `null` if unreachable.

#### `map.getGraph() => PF.Grid`

#### `map.newGraph(grid: number[][]) => PF.Grid`

`getGraph` returns a clone of the path graph, `newGraph` builds a map-sized `PathFinding.js` grid from a `0` = walkable, `1` = blocked matrix. They exist to feed `path`'s and `isPlaceable`'s `graph` option; the type is `any`.

The `set*` members on the type (`setPathable`, `setPlaceable`, `setGrids`, ...) are written by the engine's map system and are not part of what a bot calls.

```ts
import type { World } from '@sc-bot/core';
import { PYLON } from '@sc-bot/core/constants/unit-type';

export async function onGameStart({ resources }: World) {
    const { map, units, actions } = resources.get();

    const ramp = map.getMainBaseRamp();
    if (!ramp) return;
    console.log(ramp.topCenter, ramp.cornerDepots, ramp.barracksCorrectPlacement);

    const pylonSpot = ramp.protossWallPylon;
    if (pylonSpot) await actions.build(PYLON, pylonSpot);

    const natural = map.getNatural()!;
    const [worker] = units.getWorkers();
    const groundDistance = await map.queryPathing(worker, natural.townhallPosition);
    const localPath = map.path(worker.pos, natural.townhallPosition);

    console.log(groundDistance, localPath.length, map.getExpansionLocations().length);
    console.log(map.getTerrainZHeight(natural.townhallPosition), map.inPlacementGrid(natural.townhallPosition));
}
```

## `Expansion`

An area where a townhall can be placed and its resources mined: a simple region decomposition computed at game start.

```text
townhallPosition: Point2D       // the optimal townhall placement
zPosition: number               // z-height of the expansion
centroid: Point2D               // average of all the expansion's cells
base?: string                   // tag of the townhall on it, set once one is seen within 4.5 of townhallPosition
cluster: {
    centroid: Point2D           // average of the mineral fields
    mineralFields: Unit[]
    vespeneGeysers: Unit[]
}
areas: {
    areaFill: Point2D[]         // every cell of the expansion
    placementGrid: Point2D[]    // cells free to place on (1x1)
    mineralLine: Point2D[]
    behindMineralLine: Point2D[]
    hull: Point2D[]             // the outline of the expansion area
    wall?: Point2D[]            // cells of a wall-off; only computed for your natural, [] when none fits
}
pathFromMain: number[][]        // map.path from this expansion (+3 on x) to your start (+3 on x)
pathFromEnemy: number[][]       // map.path from this expansion (+3 on x) to the enemy start (+3 on x)
labels: Map<string, any>
```

`cluster.mineralFields` and `cluster.vespeneGeysers` are a snapshot: filled once at game start from the units seen then and never refreshed. The `Unit` objects in them update in place, but a depleted field stays in the array, labelled `dead` (`isCurrent()` is `false`); use `expansion.getMineralFields()` and `getVespeneGeysers()` for what is left. A `pathFrom*` that has no path, or no known start to path to (no enemy start location, say), is a placeholder array of length 999 with no cells.

#### `expansion.getBase() => Unit | undefined`

The townhall currently occupying the expansion, if any.

#### `expansion.getMineralFields() => Units`

#### `expansion.getVespeneGeysers() => Units`

The expansion's mineral fields and geysers that are still current, so a mined-out field drops out. Unlike `cluster.mineralFields` and `cluster.vespeneGeysers`, these are not the game-start snapshot.

#### `expansion.getAlliance() => Alliance`

Who owns the expansion: the alliance of its base, `NEUTRAL` when nobody does or its base died.

#### `expansion.getWall() => Point2D[]`

`areas.wall`, or `[]` when there is none.

## `Ramp`

`Ramp` is exported from `@sc-bot/core`; `map.getRamps()` and `map.getMainBaseRamp()` return them. A ramp has `points` (its cells), `upper` and `lower` (the cells at the highest and lowest height), `topCenter`, `bottomCenter` and `size` (the number of points), plus wall positions that are `null` (or `[]`) when a ramp doesn't fit the standard wall shapes:

```text
upper2ForRampWall: Point2D[]
depotInMiddle, barracksInMiddle: Point2D | null
cornerDepots: Point2D[]                    // the two depots of a terran wall
barracksCanFitAddon: boolean
barracksCorrectPlacement: Point2D | null   // leaves room for an add-on when possible
protossWallPylon, protossWallWarpin: Point2D | null
protossWallBuildings: Point2D[]
```

As in python-sc2, `barracksCanFitAddon` throws on a ramp without the standard shape (read `barracksCorrectPlacement` instead), and `cornerDepots` throws on a ramp with a single upper cell. On a standard-sized ramp whose upper cells are too far apart for the wall math, `barracksInMiddle` and what is built on it (`barracksCorrectPlacement`, the Protoss wall positions) throw where python-sc2 asserts, while `depotInMiddle` is `null` and `cornerDepots` `[]`.

## `PixelMap`

`PixelMap` is exported from `@sc-bot/core`. It wraps an SC2 image: `new PixelMap(imageData)` takes an `ImageData` such as `startRaw.pathingGrid` as it is, with a 1-bit or 8-bit `data: Uint8Array`. The constructor throws a `TypeError` when `bitsPerPixel`, `size.x`, `size.y` or `data` is missing, and an `Error` when `size` doesn't match the data length.

#### `pixelMap.get(point: Point2D) => number`

#### `pixelMap.set(point: Point2D, value: number) => void`

#### `pixelMap.isSet(point: Point2D) => boolean`

#### `pixelMap.isEmpty(point: Point2D) => boolean`

The pixel value, writing one, and whether it is nonzero (or zero). Points must be integer and inside the map; otherwise these throw a `TypeError` or `RangeError`.

#### `pixelMap.copy() => PixelMap`

#### `pixelMap.floodFill(start: Point2D, predicate: (value: number) => boolean) => Point2D[]`

#### `pixelMap.floodFillAll(predicate: (value: number) => boolean) => Point2D[][]`

The 8-connected group of cells matching `predicate` around `start`, and every such group on the map. `width`, `height` and `bitsPerPixel` are readable properties.

```ts
import { PixelMap } from '@sc-bot/core';
import type { World } from '@sc-bot/core';

export async function onGameStart({ resources }: World) {
    const { frame, map } = resources.get();
    const pathing = new PixelMap(frame.getGameInfo().startRaw!.pathingGrid!);
    const main = map.getLocations().self!;
    const start = { x: Math.floor(main.x), y: Math.floor(main.y) };
    const island = pathing.floodFill(start, (value) => value !== 0);
    console.log(`${island.length} walkable cells connected to the main`);
}
```

## `mapAnalysis`

`mapAnalysis` splits the map into regions joined by chokes, once per game, and answers where to hold a base. It works on the static pathing grid at game start (minerals and geysers count as walkable, structures are ignored), splitting it with a distance-to-wall watershed: a narrow passage between two wide areas becomes a choke, and every connected stretch of choke between two regions is one `Choke`. Regions are not split by height; ramps are linked through `choke.ramp`.

```text
Choke = {
    id: number
    center: Point2D                 // cell centre
    sides: [Point2D, Point2D]       // the two ends
    points: Point2D[]               // the cells, integer coordinates
    width: number
    regions: [number, number]       // ids of the two regions it joins
    ramp?: Ramp                     // set when the choke touches a ramp
}
Region = { id: number; area: number; center: Point2D; chokes: Choke[]; expansions: Expansion[] }
BaseChoke = { choke: Choke; pathDistance: number }       // ground distance from the base to the choke centre
DefensivePosition = BaseChoke & { position: Point2D }
```

By default the analysis runs in the first step, before your game-start handler. With `features.eagerMapAnalysis` set to `false` (see [the config file](running-games.md#config-file)) it runs on the first query instead. Accessors throw `MapDecompositionError` when the map has no start grids (some custom maps); the eager run never throws and only logs on `sc2:debug:mapAnalysis`.

#### `mapAnalysis.getChokes() => Choke[]`

Every choke, as a copy, ordered by `regions` then `center`.

#### `mapAnalysis.getRegions() => Region[]`

Every region, as a copy. Region ids are `0..n-1`.

#### `mapAnalysis.getRegion(point: Point2D) => Region | undefined`

The region of a point; `undefined` on an unwalkable cell or off the map.

#### `mapAnalysis.isInChoke(point: Point2D) => boolean`

Whether the point is on a choke cell.

#### `mapAnalysis.getBaseChokes(base: Expansion | Point2D) => BaseChoke[]`

The chokes of the region that holds `base`, ordered by ground distance from the base. A point that isn't walkable is moved to the nearest walkable cell within 4. Unreachable chokes are left out; `[]` when `base` resolves to no cell.

#### `mapAnalysis.getDefensivePosition(base: Expansion | Point2D, opts?: { towards?: Point2D; offset?: number }) => DefensivePosition | undefined`

The choke of `base`'s region on the shortest ground route between the base and `towards` (default: the first possible enemy start, else the map center), and `position`: that choke's center moved up to `offset` cells (default `defenseOffset`) back towards the base. `undefined` when the base's region has no reachable choke. Use it to hold a choke; for a rally point that moves with your expansions, use `map.getCombatRally()`.

#### `mapAnalysis.getDefensiveThird() => Expansion | undefined`

The one of `map.getThirds()` with the longest `pathFromEnemy` (a missing path counts as longest); `undefined` when there are no thirds.

#### `mapAnalysis.getPerimeter(region: Region) => Point2D[]`

The region's cells that are next to an unwalkable or off-map cell, as cell centres ordered by angle around `region.center`. Cached per region; a copy is returned.

#### `mapAnalysis.getEnemyMainRamp() => Ramp | undefined`

The ramp of the choke guarding the enemy main on the way to your start. `undefined` without an enemy main expansion, or when that choke isn't a ramp.

#### `mapAnalysis.getOverlordSpots() => Point2D[]`

The overlord spots not yet taken, computed on the first call; a copy is returned.

#### `mapAnalysis.takeOverlordSpot(near: Point2D) => Point2D`

Removes the spot closest to `near` from the remaining ones and returns it; the map centre when none is left. Each call consumes a spot, which is how `ENEMY_NAT_HG_SPOT` resolves.

#### `mapAnalysis.configure(settings: Partial<MapAnalysisSettings>) => void`

Changes the settings; the analysis is recomputed on the next query. A new game keeps the settings but not the analysis; see [per-game reset](resources.md#per-game-reset). The config file's `resources.mapAnalysis` section is passed here.

| Setting | Default | Meaning |
|---|---|---|
| `maxChokeWidth` | `14` | A passage wider than this is not a choke |
| `peakRatio` | `2.2` | How narrow a passage must be, relative to the two areas it joins, to split them. Higher merges more (fewer regions); lower splits more. |
| `minRegionArea` | `150` | Smaller regions are merged into a neighbour |
| `defenseOffset` | `4` | Default `offset` of `getDefensivePosition` |

If a map is split badly, tune these.

#### `mapAnalysis.drawDebug() => void`

Draws every choke cell (`C<id>`) and region center (`R<id>`) through the `debug` resource; does nothing without it.

```ts
import type { World } from '@sc-bot/core';
import { Alliance } from '@sc-bot/core/constants/enums';

export async function onStep({ resources }: World) {
    const { map, mapAnalysis, units, actions } = resources.get();

    const defence = mapAnalysis.getDefensivePosition(map.getNatural()!);
    if (!defence) return;

    const outside = units.getAlive(Alliance.ENEMY).filter(enemy => !mapAnalysis.getRegion(enemy.pos));
    console.log(`holding choke ${defence.choke.id} (width ${defence.choke.width.toFixed(1)}), ${outside.length} enemies outside any region`);

    const army = units.getCombatUnits();
    if (army.length > 0) await actions.attackMove(army, defence.position);
}
```

## `influence`

Danger grids, built on the first `getGrid` of each game loop. There are four layers (`InfluenceLayer`): `'ground'`, `'air'`, `'groundAvoidance'` and `'airAvoidance'`. A cell is `1` when free and `Infinity` when blocked (unpathable for the ground layers, outside the playable area for air). Enemy threats add cost on top, so a cell is safe when its value is at most `1`. The avoidance layers start as copies of the ground and air layers and only collect the sources that list them (see [constants](#influence-constants)).

What is stamped, each loop:

- Units from `memory.getEnemies()` (ghosts included), skipping changelings and unfinished structures. A type in `WEIGHT_COSTS` adds its air and ground cost within its range plus `rangeBuffer`. A static defence type uses its `STATIC_DEFENSE` entry (a photon cannon only while powered, an auto-turret not as a snapshot, a missile turret with a longer range after 9 minutes). Anything else that can attack adds its DPS within weapon range plus `rangeBuffer` (`rangeBuffer` alone for a unit with range under 2). Types in `UNIT_AVOIDANCE` add to the avoidance layers.
- Effects while present, from `DEFAULT_EFFECT_COSTS` or your `effects` override, each radius plus `effectsRangeBuffer`. Your own liberator zones are skipped.

`costMultiplier` scales every built-in source's weight. Cells never go below `1`.

#### `influence.getGrid(layer: InfluenceLayer) => InfluenceGrid`

The grid of this game loop. An `InfluenceGrid` has `layer`, `width`, `height`, `data` (a `Float32Array` indexed `y * width + x`; read-only by contract) and `get(point)`, which floors the point and gives `Infinity` out of bounds.

#### `influence.getCleanGrid(layer: InfluenceLayer) => InfluenceGrid`

A fresh grid with terrain only (free `1`, blocked `Infinity`) and no threats. You own it: `addCost` on it persists in that object.

#### `influence.addCost(target: InfluenceLayer | InfluenceLayer[] | InfluenceGrid, center: Point2D, radius: number, weight: number) => void`

Adds a cost circle (cells at exactly `radius` included) to one or more layers, or to a grid you hold. On a layer it lasts for the rest of this game loop. Cells never drop below `1`; `Infinity` stays blocked; `costMultiplier` doesn't apply.

#### `influence.configure(settings: Partial<InfluenceSettings>) => void`

```text
InfluenceSettings = {
    rangeBuffer: 4
    effectsRangeBuffer: 1
    costMultiplier: 1                          // scales the built-in sources only, not addCost
    effects: { [effectId]: { cost, range } }   // merged over DEFAULT_EFFECT_COSTS
}
```

A new game keeps these settings; see [per-game reset](resources.md#per-game-reset).

#### `influence.drawDebug(target: InfluenceLayer | InfluenceGrid, opts: { threshold = 1 }) => void`

Draws the cells above `threshold` with their value through `debug.setDrawCells`; does nothing without the `debug` resource.

```ts
import type { World } from '@sc-bot/core';

export async function onStep({ resources }: World) {
    const { influence, map } = resources.get();
    influence.addCost('ground', map.getEnemyNatural()!.townhallPosition, 8, 50);
    const grid = influence.getGrid('ground');
    console.log('natural is safe:', grid.get(map.getNatural()!.townhallPosition) <= 1);
}
```

### Influence constants

The default tables the grids are built from are exported from `@sc-bot/core` and `@sc-bot/core/constants/influence`. Override a threat's cost through `influence.configure({ effects })` (effects) or `addCost`; the tables are the defaults.

#### `INFLUENCE_DEFAULTS`

`{ rangeBuffer: 4, effectsRangeBuffer: 1, costMultiplier: 1 }`, the starting `InfluenceSettings`.

#### `WEIGHT_COSTS: Record<number, WeightCost>`

Per unit type, `WeightCost = { airCost, groundCost, airRange, groundRange }`: the cost stamped on the air and ground layers within that range (plus `rangeBuffer`); a zero range stamps nothing. Ported from ares; covers the units ares weighs (adept to widow mine).

#### `STATIC_DEFENSE: Record<number, StaticDefenseSource>`

Per structure type, `StaticDefenseSource = InfluenceSource & { requiresPower?, upgradedRange?: { range, afterSeconds } }`. `InfluenceSource` is `{ weight, range, buffer?: 'rangeBuffer' | 'effectsRangeBuffer', layers }`: the weight stamped within `range` plus the named buffer, on the listed layers. Covers auto-turret, bunker, missile turret, photon cannon, planetary fortress, spine crawler (not in ares) and spore crawler.

#### `UNIT_AVOIDANCE: Record<number, InfluenceSource>`

Extra avoidance sources: banelings (`groundAvoidance`) and phased disruptor balls (ground and `groundAvoidance`).

#### `DEFAULT_EFFECT_COSTS: Record<number, { cost: number; range: number }>`

#### `EFFECT_INFLUENCE: Record<number, EffectInfluence>`

Per effect id: the default `{ cost, range }` (psionic storm 600 / 3.5, corrosive bile 100 / 3, liberator zones 500 / 6, lurker spines 600 / 1, blinding cloud 300 / 3.5, nuke 1000 / 8), and which layers it stamps (`EffectInfluence = { layers, perPosition? }`; `perPosition` stamps every position of the effect instead of their average, as lurker spines do). Liberator zones only stamp the ground layer.

## `pathing`

Paths over an influence layer (`'ground'` by default, or any `InfluenceGrid`, as `layer`), with an 8-connected A* that doesn't cut corners; diagonals cost the square root of 2 times a cell. Entering a cell costs its value, so paths go around danger when that is cheaper. A blocked goal is moved to the closest open cell within 3, and out-of-bounds points are clamped to the map. See the top of this page for when to use it instead of `map.path`.

`PathOptions` is `{ layer?, sensitivity?, maxExpanded?, smoothing? }`.

#### `pathing.findPath(start: Point2D, goal: Point2D, opts?: PathOptions) => Point2D[]`

Cell centers from `start` (excluded) to `goal`, or `[]` when there is no path or `maxExpanded` runs out. `sensitivity` (default `1`) keeps every nth point. `smoothing` (default `false`) straightens the path first, with the SC2MapAnalysis algorithm, so it never cuts through a blocked cell.

#### `pathing.nextPoint(start: Point2D, goal: Point2D, opts?: PathOptions & { senseDanger = true, dangerDistance = 20, dangerThreshold = 5 }) => Point2D`

The point to move to next: the `sensitivity`th point of the path (default `5`, smoothed first when `smoothing` is set), or the last one if the path is shorter, or `goal` when there is no path. With `senseDanger` it returns `goal` without searching when no cell within `dangerDistance` of `start` reaches `dangerThreshold`.

#### `pathing.findLowPriorityPath(start: Point2D, goal: Point2D, opts?: { layer? }) => Point2D[]`

A coarse path for units that don't need precision: eight points spread evenly along the path, then `goal`. `[goal]` when there is no path or it is shorter than about 40 cells. Never smoothed.

#### `pathing.closestSafeSpot(from: Point2D, opts?: { layer?, radius = 11 }) => Point2D | undefined`

The cell center with the lowest cost within `radius`, closest first on ties; `undefined` when every cell there is blocked.

#### `pathing.findLowestCostPoints(from: Point2D, opts?: { layer?, radius = 11 }) => Point2D[]`

Every cell center within `radius` that shares the lowest finite cost.

#### `pathing.findFurthestSafeSpot(from: Point2D, opts?: { layer?, radius = 15 }) => Point2D | undefined`

The furthest of the lowest-cost cell centers within `radius`.

#### `pathing.isPositionSafe(point: Point2D, opts?: { layer?, limit = 1 }) => boolean`

Whether the cell's cost is at most `limit`.

```ts
import type { World } from '@sc-bot/core';
import { MARINE } from '@sc-bot/core/constants/unit-type';

export async function onStep({ resources }: World) {
    const { actions, map, pathing, units } = resources.get();
    const target = map.getEnemyNatural()!.townhallPosition;
    for (const marine of units.getById(MARINE)) {
        if (!pathing.isPositionSafe(marine.pos)) {
            const spot = pathing.closestSafeSpot(marine.pos);
            if (spot) await actions.move(marine, spot);
            continue;
        }
        await actions.move(marine, pathing.nextPoint(marine.pos, target));
    }
}
```

## Points

Plain functions on `Point2D`, exported from `@sc-bot/core`.

#### `distance(a: Point2D, b: Point2D) => number`

#### `distanceSquared(a: Point2D, b: Point2D) => number`

The straight-line distance between two points; its square.

#### `towards(from: Point2D, to: Point2D, step: number) => Point2D`

The point `step` from `from` in the direction of `to`; a copy of `from` when the two are equal.

#### `avgPoints(points: Point2D[]) => Point2D`

The mean of the points; `NaN` coordinates for an empty list.

#### `closestPoint(pos: Point2D, points: Point2D[]) => Point2D | undefined`

The point nearest `pos`; `undefined` for an empty list.

```ts
import { avgPoints, closestPoint, distance, towards } from '@sc-bot/core';
import type { World } from '@sc-bot/core';

export async function onStep({ resources }: World) {
    const { map } = resources.get();
    const bases = map.getExpansionLocations();
    const center = avgPoints(bases);
    const nearest = closestPoint(center, bases)!;
    console.log(distance(center, nearest), towards(nearest, center, 4));
}
```
