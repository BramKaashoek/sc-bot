# Documentation plan (packages/core, ares parity)

Source: user, 2026-10-26: "dont forget to plan the updating of the documentation" (core-arch.decisions.md).
Scope: packages/core/readme.md and packages/core/docs/*. Work packages: core-arch (phase 1), parity 2, 3, 4, 5, 6a, 6b (parity-roadmap.md).
Owner of this file: business-analyst. Every phase's ticket file must contain one docs ticket that satisfies §4 for that phase.

## 1. Inventory

| File | Size | What it is | State |
|---|---|---|---|
| readme.md | 72K | The user-facing guide. Sections: Requirements, Quick start, Running games, Agents (Settings, Player data, Cost/supply, Macro helpers), Events (+ Custom events), Systems (Build systems, Unit systems), Resources (units, Units collection, Unit, actions + Batching, map, frame, debug, events and data), Constants, Differs from python-sc2, Changes compared to node-sc2, Testing, Known limitations, Examples, More documentation. Has a hand-written TOC. | Current. Primary doc. |
| docs/api.md | 54K | Signature reference. `## Engine / Agent / System / EventConsumer / World / Unit / Units / Expansion / Resources` with `### <resource>` and one heading per method. | Current, two heading styles mixed (see §3.2). |
| docs/changelog.md | 12K | node-sc2 changelog, last entry v0.8.2 (2019). | Stale: nothing about the fork (package is 0.9.0-beta.1). The fork's history lives in readme "Changes compared to node-sc2". |
| docs/internals.md | 11K | node-sc2 engine internals: Agent, Engine, System, Events, World (Data, Resources list), Other concepts. | Stale. "Resources" says resources are extensible but "will likely remain undocumented" and lists the six built-ins. |
| docs/design.md | 10K | node-sc2 design concept: engine events, systems, custom events, data registers, labels. | Conceptual; still true. |
| docs/overview.md | 9K | node-sc2 intro: event consumers, world, systems, units/map/actions. | Legacy, still mostly true. |
| docs/tutorial.md | 13K | node-sc2 tutorial, build system in 3 parts (JS). | Legacy. |
| examples/*.ts | — | Runnable bots, listed in readme "Examples". | Current. |

No GLOSSARY.md exists; none is created by this plan (terms live in readme sections).

## 2. What each work package changes

Line numbers are as of origin/main b1040d7; ticket authors re-check them.

### Phase 1: core-arch (ticket core-arch T05)
- readme.md
  - Agents › settings block (~243) and Settings (~256): remove `batchActions`.
  - Macro helpers example (~324): drop `batchActions: true`.
  - Events table (~348): add `onCommandResults` / `commandResults` (next step, won/dropped/rejected per command).
  - Systems (~433): `commandPriority` on the system blueprint, tie-break by `use()` order, agent handlers beat systems at equal priority.
  - Resources intro (~550): add a "Custom resources" subsection: definition (name, create, reset), `world.resources.register(def)` from a system's setup, module augmentation of the resource container; reset keeps identity.
  - actions (~718): command methods resolve with no value once proposed (not `ResponseAction`); arbitration rules (one winning owner per unit, repeats dropped, identical commands merged, dropped/rejected build frees the worker, no refund); `as()` commander override; raw immediate path (`sendAction`, `swapBuildings`, `toggleAutocast`, chat).
  - Batching (~782-786): rewrite. Batching is the default path, not opt-in. Keep `queueAction`, `flushQueuedActions`, `clearQueuedActions`, `unitTagsReceivedAction` semantics as they now are.
  - Running games › several games on one engine (~160) and Changes compared to node-sc2 (~995): reset is per registered resource.
  - Changes compared to node-sc2: one entry for the action return/rejection change (it changes a signature and a failure mode, the section's stated scope).
- docs/api.md: Agent settings (~159), macro helpers (~250), System `createSystem` (~257, `commandPriority`), EventConsumer (~297, `onCommandResults`), World (~346, `resources.register` / `reset`), Unit `useAbility` return (~443), every `actions.*` return type (~743-810), Batching (~807).
- docs/internals.md: World › Resources: replace "will likely remain undocumented" with the registry model and the per-game reset; Engine/Events: where the step-end flush and the `commandResults` event happen in a dispatch.
- docs/changelog.md: create the `## Unreleased` section (§3.3) and its phase-1 entry with the bot/ migration notes from core-arch.md "Further Notes".
- tutorial.md / overview.md: none (they use only `resources.get()` and awaited actions, which still work).

### Phase 2: memory, spatial, army value, influence, pathing (ticket parity-2 T09)
- readme.md
  - TOC + Resources destructure line (~555): add `memory`, `spatial`, `influence`, `pathing`.
  - New `### memory`, `### spatial`, `### influence`, `### pathing` subsections under Resources, each with a method table, defaults and one example. Mention D10 (settings survive game reset).
  - units: `getArmyValue` row; "Enemy memory" paragraph (~585): ghosts expire (30s ground/air default), dropped when their position is seen empty, burrowed kept until expiry; point to `memory`.
  - Events table: `onEnemyUnitLeftVision` (~370) "stays in units as memory" → add expiry; re-seen ghost doesn't refire first-seen.
  - units `getClosest` row (~569): point to `spatial` for range queries.
  - map `path` row (~820): say when to use `pathing` (cost-aware, dynamic) vs `map.path` (static).
  - New section "Where this library differs from ares-sc2" (§3.5), first entries: centre-to-centre distances (D4), skipped effects/layers (D8, D9).
  - Known limitations (~1046): remove the spatial-index line; add the skipped effects/layers.
  - Changes compared to node-sc2 (~993): memory now expires.
- docs/api.md: `### memory`, `### spatial`, `### influence`, `### pathing` under Resources; `units.getArmyValue` under units; memory note (~652).
- docs/internals.md: Resources list gains the four resources and the per-step hook (`onStep`, after engine systems, before agent code).
- docs/changelog.md: phase-2 entry, ghost-expiry behavior change under Changed.

### Phase 3: combat sim, roles/squads, intel (ticket parity-3 T07; detail in parity-3.design.md Q7)
- readme.md: TOC + destructure line (`roles`, `squads`, `intel`); `### roles` / `### squads` / `### intel` after pathing (roles are not labels; default role; exclusive ownership via `roles.as`); new `## Utilities` (after Resources, before Constants) with `canWinFight`/`simulateFight` and a "Fights" example; Events table `onEnemyStrategyDetected` and `'not-owner'` reason; Constants `UnitRole`, `EngagementResult`; ares deviations; Known limitations (what the sim doesn't model).
- docs/api.md: `### roles`, `### squads`, `### intel`; `## Utilities`; EventConsumer; CommandResult reason.
- docs/internals.md: Resources list.
- docs/changelog.md: phase-3 entry.

### Phase 4: placement solver, building tracker, mining, flying structures (parity-4 docs ticket)
- readme.md: actions `findPlacement` / `canPlace` (~720-740) and the new placement solver/reservation API and per-map hook; Macro helpers (~299, builder handoff, `distributeWorkers` vs the mining manager: which one owns workers); `swapBuildings` and the "Changes compared to node-sc2" entry about it (~967) if its semantics change; new subsections for tracker and mining resources; Events table for construction reissue/timeout/cancel events if any.
- docs/api.md: actions placement entries (~779-790), new resources, macro helpers.
- docs/internals.md: Resources list.
- docs/changelog.md: phase-4 entry, with migration notes for bots that call `distributeWorkers` or place buildings themselves.

### Phase 5: behaviors and macro controllers (parity-5 docs ticket)
- readme.md: new top-level section "Behaviors and controllers" after Systems (behavior executor, composite plans, the Terran bio behaviors, macro controllers), with its TOC entry; Macro helpers section points to the controllers; Examples: the sample bot the exit criterion asks for, added to `examples/` and listed.
- docs/api.md: new `## Behaviors` and `## Controllers` top-level sections.
- docs/design.md: one paragraph on where behaviors sit relative to systems and the executor (Level 2/3).
- docs/changelog.md: phase-5 entry.

### Phase 6a: chokes and small items (ticket parity-6a T07; detail in parity-6a.design.md "Docs")
- readme.md:
  - Resources: new `### mapAnalysis` (TOC + destructure line; chokes/regions, defensive position/third, settings, one example). The map section (~788) gets only a pointer to it.
  - Running games: new "Config file" subsection after Environment variables (~226): file name, `SC_BOT_CONFIG`, JSON shape and defaults, precedence (STEP_COUNT > inline `createEngine({ config })` > file > defaults), `resources.<name>` → `configure()`, feature toggles. Env table gains `SC_BOT_CONFIG`; the STEP_COUNT row says it overrides config.
  - Events table: `onEnemyRaceDetected`. Player data: `agent.opponent.race` set on first sighting.
  - debug (~887): chat debug commands (own player only, `features.chatDebug`).
  - Macro helpers (~299): `distributeWorkers(resourceRatio, { workersPerGas })`.
  - ares deviations: clearance-watershed chokes instead of map_analyzer (no height-based region split; ramps linked via `choke.ramp`); JSON config instead of YAML; chat debug own player only; workers per gas per call.
  - Known limitations: overlord/scout spots not implemented (deferred, 6a-D10).
- docs/api.md: createEngine options (`config`, `configFile`), World `config`, `### mapAnalysis`, EventConsumer `onEnemyRaceDetected`, Agent `distributeWorkers`, debug chat commands.
- docs/internals.md: Resources list gains `mapAnalysis`; World gains `config`; the registry applies `config.resources` on register and reset.
- docs/changelog.md: `Unreleased › parity-6a` entry.

### Phase 6b: build runner upgrades (ticket parity-6b T07; detail in parity-6b.design.md O7)
- readme.md: Build systems (~453-540): string format (grammar, commands/options, targets, dict scout form), one full ares-style Terran opening, openings (blueprint vs config, `resources.openings`, choices, cycle/winrate, `dataDir`), `switchOpening`/`getOpening`, opening options and fill-workers vs supply-gate mode, persistent builder and scout roles; `### openings` under Resources (TOC, destructure line); ares deviations.
- docs/api.md: build system (`taskFunctions.scout`/`addonSwap`, `opts.at`), `parseBuildOrder` under `## Utilities`, `### openings`, `ResourceDefinition.onGameEnd`, World `resources.endGame`.
- docs/tutorial.md: Part 1 build order (~24-63): a short note pointing to the string format; don't rewrite the tutorial.
- docs/internals.md: Resources list gains `openings`; Engine: game end runs resource game-end hooks.
- docs/changelog.md: phase-6b entry.

### Examples work package (ticket examples T08; detail in examples.md)
- readme.md: "Examples" lists every file in examples/ and examples/ares/ with its run command and what it shows; ares ports with their tutorial name and gaps; "Where this library differs from ares-sc2" gets the example-level gaps not listed yet.
- docs/tutorial.md: line ~227 link `tutorial.js` → `tutorial.ts` only.
- docs/changelog.md: `Unreleased › Examples` entry. Last in the docs chain (after parity-6b T07).

## 3. Conventions

### 3.1 Where things are documented
- readme.md is the guide: every public resource, method, setting and event appears there with what it does, its defaults and its failure mode. Exhaustive signatures go in api.md.
- A new resource gets its own `### <name>` under readme "Resources" (and a TOC line, and a name in the `resources.get()` destructure line), and its own `### <name>` under api.md "Resources". Order: core-arch's registration order (the order in CORE_RESOURCES).
- A new query on an existing resource goes into that resource's table/section, not a new section.
- A new event goes into the readme Events table and api.md EventConsumer, with its payload type.
- A new agent/system setting goes into readme Agents › Settings (or Systems) and api.md Agent/System.
- Behavior that differs from ares-sc2 goes into "Where this library differs from ares-sc2" (§3.5). A gap still left open goes into Known limitations.
- docs/internals.md "World › Resources" lists every core resource in one line each. docs/design.md, overview.md and tutorial.md change only where §2 says.
- No implementation details in the readme (file paths, internal type names other than exported ones).

### 3.2 api.md signature format
- New entries use the format already used for `units`: `#### *\`resource.method(arg: Type, opt?: Type) => ReturnType\`*`, then one paragraph: what it returns, defaults (`opt = 10`), when it throws/rejects. Overloads get one heading line each.
- Exported types used in signatures are named as in types.ts. Settings objects list their fields with defaults in a `ts` block.
- Existing entries in the other style (`#### actions.x(...): Promise<...>;`) are converted only where a ticket changes them anyway (core-arch T05 converts the `actions` section since every return type changes).
- Pure functions exported from the package root go under a new `## Utilities` section, created by the first phase that exports one.

### 3.3 Changelog
- docs/changelog.md gets an `## Unreleased` section at the top (and in its TOC), created by core-arch T05. The node-sc2 entries below stay untouched.
- One `### <phase>: <title>` subsection per work package, appended by that phase's docs ticket, with `#### Added`, `#### Changed`, `#### Removed` (only those that apply), and `#### Migrating bot/`.
- Every behavior change and every breaking type change is listed under Changed with what the bot has to do. `Migrating bot/` repeats the ticket file's migration notes as concrete steps (which setting/call changes). It never contains bot code (CLAUDE.md: the user writes bot/).
- Version numbers: none. The `Unreleased` heading stays until the user picks a version (package is 0.9.0-beta.1).

### 3.4 Examples
- Each new readme subsection has at most one `ts` example, in the style of the existing ones: imports from `@sc-bot/core` and `@sc-bot/core/constants/*`, an `onStep({ resources })` body, Terran unless the feature is race-specific.
- Examples must type-check against the shipped API: the docs ticket's author copies each new example into a scratch file under packages/core and runs tsc on it (not committed).
- Runnable bots in `examples/` only where a phase's exit criterion asks for one (phase 5 sample bot) or the examples work package adds them (examples.md, user 2026-10-27); each one is listed in readme "Examples". Files in examples/ are type-checked by `check-types` (tsconfig includes `**/*.ts`).

### 3.5 ares-sc2 deviations
- New readme section "Where this library differs from ares-sc2", after "Where this library differs from python-sc2", created by parity-2 T09. One bullet per deliberate deviation (bold lead term, what we do, what ares does), same style as the python-sc2 section.

### 3.6 Ticketing rules
- Every phase's ticket file ends with exactly one docs ticket ("Docs + changelog"), blocked by every code ticket of that phase that changes public API or behavior.
- Docs tickets edit the same files, so each is also blocked by the previous docs ticket in this chain: core-arch T05 → parity-2 T09 → parity-3 → parity-4 → parity-6a → parity-5 → parity-6b (6a is designed before 5). The PM may reorder the chain if a later phase finishes first; the edge then moves with it.
- Acceptance criteria name the readme/api.md sections from §2 for that phase, plus: TOC updated, changelog entry with `Migrating bot/`, examples type-checked, no leftover mention of removed API (`grep` for removed names comes back empty in readme.md and docs/).
- A code ticket doesn't edit docs (keeps the docs ticket the single writer and avoids conflicts). Exception: none.

## 4. Docs ticket template (copy into each phase file)

```
## Tnn Docs + changelog
- Source: docs-plan.md §2 (<phase>), design <Pn>.
- What to build: <readme/api/internals sections from §2>; changelog `Unreleased › <phase>` entry with `Migrating bot/`.
- Acceptance criteria:
  - [ ] readme.md: <sections>; TOC and `resources.get()` destructure line list every new resource.
  - [ ] docs/api.md: every public method/type of the phase in the §3.2 format, with defaults.
  - [ ] docs/internals.md Resources list updated (if resources were added).
  - [ ] docs/changelog.md: `Unreleased › <phase>` with Added/Changed/Removed and Migrating bot/.
  - [ ] ares deviations / Known limitations updated.
  - [ ] Every new example type-checks; no mention of removed API remains.
- Implementation plan: Where: the files above. Don't touch: code.
- Stack: core (docs).
- Blocked by: <all public-API tickets of the phase>, <previous phase's docs ticket>.
```

## 5. Check of existing docs tickets

- core-arch T05: covered readme batching/actions and api.md lines, changelog. Missing: Events table, Systems (`commandPriority`), Custom resources subsection, actions return-type paragraph, Unit `useAbility`, World `register`, internals.md (was optional), "Changes compared to node-sc2" entry, creating `## Unreleased`. Amended in core-arch.md.
- parity-2 T09: covered resources, Known limitations, changelog. Missing: TOC/destructure line, Events table memory wording, units "Enemy memory" paragraph and `getClosest`/`map.path` pointers, ares-deviations section creation, internals.md, node-sc2 changes entry, examples rule. Amended in parity-2.md.

## Assumptions (BA, best judgement)
- DA1 docs/changelog.md stays the changelog (not replaced by the readme section), with an `## Unreleased` section; no version number until the user picks one.
- DA2 Legacy node-sc2 docs (overview, tutorial, design) are not rewritten; only the touch points in §2.
- DA3 Docs tickets are serialized across phases because they share three files.
- DA4 No GLOSSARY.md; the readme sections are the vocabulary.
- DA5 Example snippets are type-checked ad hoc, not by a committed test.
