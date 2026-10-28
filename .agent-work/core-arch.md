# core-arch: resource registry + step-end command executor

Source: user request "plan fixing 1 and 2" (.agent-work/core-arch.decisions.md, 2026-10-26), gap analysis .agent-work/ares-gap.md §1 and ranked item 8.
Design: .agent-work/core-arch.design.md (technical-architect). Scope: packages/core only.

Status: FINAL. Q1–Q7 answered (decisions.md 2026-10-26): all recommendations except Q4 = void + commandResults event next step (design "Q4 delta"). Q8 (T02 parallel with T01) goes to the user with the plan.

## Problem Statement

1. Resources are a closed set. The resource container type can't be extended outside core, and adding a resource means editing four places (type, manager init list, world creation, per-game reset), plus two more per-game resets hidden in the engine. Forgetting one leaks state between games.
2. Nothing arbitrates unit commands. Agent handlers and agent systems run concurrently; every high-level action sends immediately; the last request to reach SC2 wins. Only identical repeats of a unit's current order are dropped, and only on the opt-in batched path.

## Solution

1. A resource registry: each resource is a definition (name, create, optional reset). The world registers the core definitions; the registry resets every registered resource between games, keeping object identity. Bots/plugins extend the container type by module augmentation and register their own resource from a system's setup.
2. A step-end command executor: every unit command becomes a proposal tagged with its commander (owner, priority, rank), captured automatically from the system or agent handler that issued it. After agent systems finish, the executor picks one winning owner per unit, drops the others' commands (releasing the builder of a dropped or rejected build), removes repeats of current orders, merges identical single commands across units, and sends one request. The next step, systems receive a commandResults event saying per command whether it won, was dropped (outranked or a repeat) or was rejected by SC2.

## Non-goals

- No roles, squads, behaviors, behavior executor, MacroPlan/CombatManeuver. The design only keeps them unblocked (a role layer later sets the commander via the explicit override and can add an ownership filter to arbitration).
- No influence grids, combat sim, or other ares gap items.
- No change to bot/ code. Breakages are listed as migration notes for the user.
- No command result tickets/promises settled at flush (Q4: results come as a next-step event instead).
- No rework of swapBuildings, toggleAutocast, chat (stay raw/immediate; Q7).
- Earmarks stay in data storage, not a resource.

## User Stories

1. As a bot author, I want to add my own resource with one registration call, so that I don't edit core to store per-game state.
2. As a bot author, I want my custom resource typed on the resource container, so that destructuring it from the world is type-checked.
3. As a bot author, I want my custom resource reset between games automatically, so that a second game in the same process doesn't inherit stale state.
4. As a bot author, I want registering from a system's setup to be safe when setup runs every game, so that I don't guard against double registration.
5. As a bot author, I want a clear error when two different resources claim one name, so that collisions aren't silent.
6. As a core maintainer, I want adding a core resource to be one type key plus one list entry, so that reset can't be forgotten.
7. As a bot author, I want references I destructured from the resources to stay valid across games, so that long-lived closures keep working.
8. As a bot author, I want two of my systems commanding the same unit in one step to resolve deterministically, so that behaviour doesn't depend on request timing.
9. As a bot author, I want to give a system a command priority, so that e.g. defense overrides economy for the same worker.
10. As a bot author, I want the issuing system identified automatically, so that I don't thread an owner through every action call.
11. As a bot author, I want a unit's queued follow-ups from one system (build then gather, train twice) kept together, so that winning a unit doesn't break multi-step orders.
12. As a bot author, I want a dropped or rejected build to release its builder immediately, so that the worker isn't marked stuck 250 loops later.
13. As a bot author, I want repeats of a unit's current order skipped on every path, so that re-issuing each step doesn't spam SC2 or reset attack animations.
14. As a bot author, I want identical commands to several units sent as one command, so that the action request stays small.
15. As a bot author, I want the action methods to keep rejecting on precondition errors (can't afford, no builder, invalid gather), so that my existing try/catch keeps working.
16. As a bot author, I want a commandResults event the step after a command telling me whether each of my commands won, was dropped (and by whom) or was rejected by SC2, so that I can react without the call throwing or blocking the step.
17. As a bot author, I want an escape hatch to send a raw command immediately, so that timing-sensitive sequences still work; raw-sent units are respected by later arbitration in the same step.
18. As a later role/behavior layer, I want to run code as an explicit commander, so that ownership can be per unit-group rather than per system.
19. As a bot author, I want to ask whether a unit was already ordered this step by anyone, so that macro helpers avoid picking an already-busy worker.

## Implementation Decisions

From the Architect (full contract in core-arch.design.md):

- Resource container becomes an open interface; augmentation target is the core `types` subpath export, not the package root (root re-exports types with `export type *`, which doesn't merge).
- Resource definition = name, create(world), optional reset(resource, world). No reset means recreate in place (assign a fresh instance's props onto the existing object). Resource manager gains register (idempotent for the same definition object, throws a core error for a different definition under a taken name) and reset (registration order; resources added with plain `set`, like the placer, are left alone).
- Core definitions: one ordered list in world creation (frame, map, debug, units, events, actions). Frame resets step times; units clear their stores; actions clear queue and committed set and are never recreated (would create a new proto client). Map, debug, events recreate in place. The two engine-level per-game resets fold into these. (Q1, Q2 answered: as recommended.)
- Commander context = owner, priority, rank, carried by async-local storage. Engine dispatch runs agent handlers as owner `agent`, rank -1, priority from agent settings (default 0); each agent system as its name, its `commandPriority` (system option, default 0) and its registration index as rank. Engine systems get no context. Explicit override via an `as(context, fn)` method on the action manager. Default when no context: owner `unknown`, priority 0, rank Infinity.
- Arbitration (pure function over proposals + the step's committed set), per unit tag: winner = highest priority, tie to lowest rank (Q3); a tag already committed this step by a raw send or an earlier flush is only taken by a strictly higher commander; the winner keeps all its commands for that tag in issue order; losers' commands for the tag are dropped (reason outranked, with the winner); repeats of current order are dropped (reason repeat). Emit: split multi-unit proposals by surviving tags, merge each-tag-only-command proposals with identical ability/target/queue flag, multi-command tags emitted in issue order.
- All high-level unit commands (do, smart, move, patrol, attack, attackMove, gather, mine, build, buildGasMine, train, upgrade, warpIn, stop, holdPosition, repair, returnResource) propose via the queue and resolve once proposed with no value (Q4). Precondition errors still reject. The raw send stays immediate and commits its tags under the current commander. swapBuildings, toggleAutocast, chat stay raw (Q7).
- Command results (Q4): after each flush, one `commandResults` event (default `agent` event type, only when non-empty) carries a list of results: owner, command as proposed, tags covered, outcome won/dropped/rejected, drop reason (outranked/repeat) and winner, SC2 result code, or error if the send itself threw. Merged commands map their result back to every proposal they cover. Systems and the agent handle it via `onCommandResults` the next step. Raw sends are not reported. Not carried across games.
- No spend refund on drop: the next observation overwrites minerals/vespene before any system reads them. Spend stays deducted at proposal time, as today.
- Per-proposal cleanup hook `onNotSent(tags, result)` fires synchronously during flush for dropped and rejected tags, before the event is written. Build uses it to remove the builder's `command` label (new: also on SC2 rejection). Train needs none. Gas follow-up gather becomes a same-owner queued proposal right after the build proposal.
- Macro helpers propose through the queue with no hook; the `batchActions` agent setting is removed (Q5).
- Unit convenience methods that wrap actions change return types accordingly.
- Production conflicts on structures arbitrate like any other tag (Q6).

## Testing Decisions

Seams (highest available, all offline via the fake client + fixtures harness: createTestWorld / stepTo / engine.dispatch, asserting on `client.sent.actions`):

- Registry: the world/reset seam — run setupGame twice across fixtures (prior art: engine/create-world.test.ts existing reset test, which must pass unchanged).
- Arbitration: pure function unit tests (no harness needed).
- Context propagation and results: engine.dispatch with two agent systems commanding the same unit, asserting a single resulting command from the expected owner, and on the following step `onCommandResults` delivering won / dropped (outranked, by) entries. Fake client returning a non-success result for the rejected path. Plus an early standalone check of async-local storage through Bluebird mapping under Bun.
- Action methods: existing resources/actions.test.ts and agent/macro.test.ts, asserting sent actions after a flush or dispatch.
- QA Specialist to confirm seams before T03 starts.

## Out of Scope

See Non-goals. Also: per-bot step size, placement solver, mining manager.

## Further Notes

Migration notes for the user's bot/ (not tickets; user writes bot code):

- Action methods now resolve with no value once proposed. No bot/ site reads the response (architect checked economy, combat/micro/basic, combat/index, offense, scout, wall, production, training), so no compile breaks.
- SC2-rejected commands no longer reject into the system's error log. Handle `onCommandResults` (next step) to see won/dropped/rejected per command; also logged on `sc2:debug:actionManager`.
- Same-unit conflicts between bot systems now resolve by `use()` order (build, economy, combat, military, log) unless a system sets `commandPriority`. Today it's whoever's request lands last. Review which system should win workers (e.g. combat pulling workers vs economy).
- Re-issuing the same order to a unit each step is now a no-op on every path.
- Commands go out after all systems finish, not mid-step (only matters in realtime).
- `batchActions` setting removed: drop it from the bot's agent settings if set (it isn't today).
- To add a bot resource: augment the core `types` module's resource container and register a definition in a system's setup.

## Open questions (user's call)

Q1–Q7 answered (decisions.md). Remaining:

- Q8 Ticket split: run the pure arbitration/context modules (T02) in parallel with the registry (T01) [rec; Architect agrees, with T02 kept off types.ts and actions.ts], or strictly serial T1 → T2a → T2b → T2c.

---

# Tickets

## T01 Resource registry

- Source: decisions.md 2026-10-26 fix 1; design "Fix 1".
- What to build: open resource container, resource definitions, register/reset on the resource manager, core definitions list, per-game reset through the registry.
- API contract: design "Fix 1 / API".
- Acceptance criteria:
  - [ ] Existing resetGameState test passes unchanged.
  - [ ] A custom resource registered via a definition with a reset hook is reset by setupGame of a second game; one without a reset hook is recreated in place and keeps identity.
  - [ ] Registering the same definition twice returns the same instance, no error.
  - [ ] Registering a different definition under a taken name throws a core error.
  - [ ] Frame step times and the action queue are reset between games without the engine's separate reset lines.
  - [ ] A resource added via plain `set` (placer) survives reset untouched.
  - [ ] Module augmentation of the container from outside core type-checks (a type-level test or test file augmenting the `types` subpath).
  - [ ] lint, tsc, tests green.
- Implementation plan:
  - Where: types.ts (ResourceContainer → interface, ResourceDefinition, ResourceManager.register/reset); engine/create-resource-manager.ts (takes world, Map of definitions, register/reset); engine/create-world.ts (CORE_RESOURCES, createWorld registers, resetGameState = resources.reset + earmarks); engine/create-engine.ts (delete per-game resetStepTimes/clearQueuedActions lines ~447-448, update ResourceManager() call site if any); engine/create-world.test.ts (new cases).
  - Interfaces: as design "Fix 1 / API".
  - Follow: current resetGameState semantics; NodeSC2Error from engine/errors.ts.
  - Don't touch: resources/actions.ts, systems/create-system.ts, dispatch() body of create-engine.ts (T03). Migration is one-shot (no expand/contract): get()/set() signatures unchanged.
- Stack: core.
- Blocked by: None.
- Slice siblings: none.

## T02 Command context + arbiter (pure modules)

- Source: design "Fix 2 / Ownership context", "Proposal and arbitration".
- What to build: the commander context module (run-as, current) and the pure arbitration function, both new files, with unit tests. Plus a standalone test proving async-local context survives Bluebird mapping and awaits under Bun (de-risks design Risk 1 before integration).
- API contract: design `CommandContext`, `runAsCommander`, `currentCommander`, `Proposal`, `Committed`, `arbitrate`.
- Acceptance criteria:
  - [ ] Higher priority wins a tag; equal priority goes to lower rank.
  - [ ] Winner keeps all its commands for a tag in issue order, including queued ones.
  - [ ] Every losing owner's command for the tag is dropped (queued or not) and reported with the tags lost, reason `outranked` and `by` = winner.
  - [ ] A committed tag is only taken by a strictly higher commander.
  - [ ] Tags for which the injected repeat check returns true are dropped with reason `repeat`.
  - [ ] Dropped output uses an arbiter-local `Dropped = { proposal, tags, reason, by? }` shape (no types.ts import).
  - [ ] Multi-unit proposals split by surviving tags; identical single commands across tags merge; multi-command tags never merge.
  - [ ] Context default is owner `unknown`, priority 0, rank Infinity outside any run.
  - [ ] Context set around Bluebird.map over two async functions is seen by each after awaits, and does not leak between them.
  - [ ] tsc, tests green.
- Implementation plan:
  - Where: new resources/command-context.ts, resources/command-arbiter.ts, resources/command-arbiter.test.ts, resources/command-context.test.ts.
  - Interfaces: as design, except `arbitrate(proposals: Proposal[], committed: Committed, isRepeat: (command: SC2APIProtocol.ActionRawUnitCommand, tag: string) => boolean)` (Architect). `CommandContext`, `Proposal`, `Committed` are defined in these new files, not types.ts.
  - Follow: AsyncLocalStorage from node:async_hooks; arbitration rules in design.
  - Don't touch: actions.ts, types.ts (T01 has it open), create-engine.ts.
- Stack: core.
- Blocked by: None.
- Slice siblings: T03, T04, T05.

## T03 Executor integration

- Source: design "Fix 2 / ActionManager changes", "'command' label and spend accounting", "Caller migration".
- What to build: route every high-level unit command through the queue as a proposal under the current commander; flush = arbitrate + one send + record committed + write the commandResults event; raw send commits; `as()` override; `onNotSent` cleanup hook (build clears the builder label); commander context in engine dispatch; system `commandPriority` option; unit convenience return types.
- API contract: design "ActionManager changes" + "Ownership context" + "Q4 delta" (CommandResult, commandResults, onNotSent replaces onDrop, no refund).
- Acceptance criteria:
  - [ ] Two agent systems commanding the same unit in one dispatch produce exactly one command, from the higher priority / earlier-registered system.
  - [ ] Agent handlers (owner `agent`, rank -1) beat agent systems at equal priority.
  - [ ] `commandPriority` on a system option overrides registration order.
  - [ ] A dropped or SC2-rejected build removes the worker's `command` label during the flush. No refunds.
  - [ ] The step after a conflict, a system with `onCommandResults` receives `won` for the winner's command and `dropped` (reason `outranked`, `by` = winner) for the loser's.
  - [ ] A repeat of a unit's current order is reported `dropped` with reason `repeat` and not sent.
  - [ ] A fake client non-success result yields `rejected` with SC2's result code; a throwing send yields `rejected` with `error`.
  - [ ] A merged command's result is reported against every proposal it covers, with that proposal's owner and tags; one entry per (proposal, outcome) group, so a partly outranked proposal yields two entries.
  - [ ] If the send throws, every proposal in that flush is reported `rejected` with `error`.
  - [ ] No event is written when a flush has no proposals; raw `sendAction` produces no result entry.
  - [ ] Gas build + follow-up gather from one owner both go out, in order.
  - [ ] patrol sends a move plus a queued patrol from one owner.
  - [ ] A unit raw-sent this step is not re-commanded by an equal-or-lower commander at flush.
  - [ ] Precondition errors (BuildError, TrainError, GatherError, ActionManagerError) still reject.
  - [ ] A non-success flush result is logged on `sc2:debug:actionManager`, does not throw.
  - [ ] `unitTagsReceivedAction` reports tags proposed or committed this observation.
  - [ ] Identical orders to several units go out as one command.
  - [ ] swapBuildings, toggleAutocast, chat still send immediately.
  - [ ] Existing actions.test.ts and builder-plugin tests pass after adapting to flush/dispatch.
  - [ ] lint, tsc, tests green.
- Implementation plan:
  - Where: resources/actions.ts (all listed methods → queueAction; queueAction opts.onNotSent; flushQueuedActions uses arbitrate, maps the response back to proposals, fires onNotSent, writes `commandResults`; Committed keyed like orderedThisObservation; sendAction commits; as(); clearQueuedActions clears Committed; keep repeatsCurrentOrder in actions.ts and pass it to arbitrate as isRepeat; build onNotSent clears the `command` label; gas follow-up gather moved after build proposal; patrol as two proposals); types.ts (import CommandContext from command-context.ts; add CommandResult; ActionManager signatures ~458-499, SystemOptions.commandPriority ~41, SystemWrapper.commandPriority ~120, Unit method return types ~229-232, ~281); systems/create-system.ts (copy commandPriority to wrapper); engine/create-engine.ts dispatch (~562-593: wrap agent handlers and each agent system in runAsCommander); engine/create-unit.ts (~109,114,119,130,583 return types); resources/actions.test.ts (flush before asserting); new dispatch-level test (e.g. engine/create-engine.test.ts or a new resources/command-executor.test.ts) covering conflict + onCommandResults next step + rejected path.
  - Interfaces: as design + Q4 delta.
  - Follow: existing queueAction / flushQueuedActions / repeatsCurrentOrder (actions.ts ~61-80, ~647-670); engine dispatch structure.
  - Don't touch: agent/macro.ts, types.ts AgentSettings.batchActions (T04); builder-plugin.ts; create-world.ts; docs (T05).
- Stack: core.
- Blocked by: T01 (shares types.ts, create-engine.ts), T02.
- Slice siblings: T02, T04, T05.

## T04 Macro helpers on the executor

- Source: design "Caller migration" (macro.ts, batchActions).
- What to build: macro helpers propose through the queue (no hook, no refund: Q4 delta §3); remove the `batchActions` setting and its branch.
- Acceptance criteria:
  - [ ] Macro commands go out in the post-step batch by default; a queued producer isn't ordered twice (existing batchActions test, rewritten as the default-path test).
  - [ ] Macro commands carry the calling system's commander (owner visible in commandResults).
  - [ ] `batchActions` no longer exists on agent settings.
  - [ ] lint, tsc, tests green.
- Implementation plan:
  - Where: agent/macro.ts (`issue` → `actions.queueAction(command)`; drop the batchActions branch); types.ts (remove AgentSettings.batchActions ~174); agent/macro.test.ts (~431).
  - Follow: existing `issue` in macro.ts.
  - Don't touch: actions.ts, engine.
- Stack: core.
- Blocked by: T03.
- Slice siblings: T02, T03, T05.

## T05 Docs + changelog

- Source: design "docs" row; .agent-work/docs-plan.md §2 "Phase 1" and §3 (amended 2026-10-26 to match the docs plan).
- What to build: document the resource registry (core + plugin registration, augmentation target), the command executor (proposal model, arbitration rules, `commandPriority`, `as()`, raw send, return-value change, `commandResults` event and `onCommandResults` handler), removal of `batchActions`; create the changelog's `## Unreleased` section and its phase-1 entry with the bot migration notes above.
- Acceptance criteria:
  - [ ] readme.md batching/actions sections (~243, 256, 324, 718, 768-786) no longer describe batching as opt-in, and say command methods resolve with no value once proposed.
  - [ ] readme.md Events table lists `onCommandResults` (next step, won/dropped/rejected); Systems documents `commandPriority` and the tie-break (`use()` order, agent handlers first).
  - [ ] readme.md Resources has a "Custom resources" subsection (definition, `register` from a system's setup, module augmentation, reset keeps identity); "Several games on one engine" (~160) and "Changes compared to node-sc2" (~995) describe per-resource reset; "Changes compared to node-sc2" has an entry for the action return/rejection change.
  - [ ] docs/api.md: Agent settings (~159), macro helpers (~250), `createSystem` (~257), EventConsumer (~297), World `resources.register`/`reset` (~346), `unit.useAbility` (~443) and every `actions.*` return type (~743-810) match the code; the `actions` section uses the docs-plan §3.2 heading format.
  - [ ] docs/internals.md World › Resources describes the registry and per-game reset (no "will likely remain undocumented"), and where the step-end flush and `commandResults` happen in a dispatch.
  - [ ] docs/changelog.md has `## Unreleased` (in its TOC) with a `### core-arch` entry: Added/Changed/Removed and `Migrating bot/`.
  - [ ] Every new example type-checks; `grep batchActions` over readme.md and docs/ is empty.
- Implementation plan:
  - Where: packages/core/readme.md, docs/api.md, docs/changelog.md, docs/internals.md.
  - Follow: docs-plan.md §3 conventions.
  - Don't touch: code.
- Stack: core (docs).
- Blocked by: T01, T03, T04.
- Slice siblings: T02, T03, T04.
