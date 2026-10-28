# core-arch design

Author: technical-architect (recorded verbatim by business-analyst, 2026-10-26).

All paths under packages/core/. Verified against worktree HEAD b1040d7.

## Fix 1: resource registry

### Problem
- `ResourceContainer` is a `type` alias (types.ts:782), so nothing outside types.ts can add a key.
- Adding a resource means editing types.ts:782, `createResourceManager`'s null-init list (engine/create-resource-manager.ts:4), `createWorld` (engine/create-world.ts:21) and `resetGameState` (create-world.ts:33). Two more per-game resets live elsewhere: `frame.resetStepTimes()` and `actions.clearQueuedActions()` at create-engine.ts:447-448.
- Reset must keep object identity: callers hold destructured references (`const { map } = resources.get()`). Today that works through `Object.assign(map, MapManager(world))`.

### API (types.ts)
```ts
export interface ResourceContainer {          // was `type`; now open to declaration merging
    actions: ActionManager; events: EventChannel; frame: FrameResource;
    map: MapResource; units: UnitResource; debug?: Debugger; placer?: Placer;
}

export type ResourceDefinition<K extends keyof ResourceContainer = keyof ResourceContainer> = {
    name: K;
    create(world: World): NonNullable<ResourceContainer[K]>;
    // omitted = recreate in place: Object.assign(existing, create(world))
    reset?(resource: NonNullable<ResourceContainer[K]>, world: World): void;
};

export interface ResourceManager {
    set(resources: IncomingResources): void;           // unchanged; still used for `placer`
    get(): Readonly<ResourceContainer>;                 // unchanged
    register<K extends keyof ResourceContainer>(definition: ResourceDefinition<K>): NonNullable<ResourceContainer[K]>;
    reset(world: World): void;
}
```
- `createResourceManager(world: World)` takes the world, keeps a `Map<name, definition>` in registration order and creates on register. Registering the same definition object again is a no-op that returns the existing instance, so calling it from `system.setup` (which runs every game) is safe. Registering a different definition under an existing name throws `NodeSC2Error`.
- `reset(world)` runs each definition's reset in registration order. A resource added through `set()` (placer) has no definition and is left alone.

### Built-ins (engine/create-world.ts)
`CORE_RESOURCES` array, in today's order: frame, map, debug, units, events, actions.
- frame: `reset: (frame) => frame.resetStepTimes()`
- map, debug, events: default (recreate in place). Same as today.
- units: `reset: (units) => Object.values(units._units).forEach((store) => store.clear())`
- actions: `reset: (actions) => actions.clearQueuedActions()`. Must not recreate, because the factory would build a new proto client.
- `createWorld` registers the array. `resetGameState(world)` becomes `world.resources.reset(world); world.data.set('earmarks', [])`. Earmarks live in DataStorage, not in a resource, so that line stays.
- create-engine.ts:447-448 are deleted (folded into the resets). The first game skips them, which is a no-op on fresh objects.

### Adding a resource
- Core manager: add the key to `ResourceContainer` in types.ts, write the manager file with its definition, add one line to `CORE_RESOURCES`. Nothing needs remembering in reset or the init list.
- Bot or plugin: augment `declare module '@sc-bot/core/types' { interface ResourceContainer { grid: Grid } }` and call `world.resources.register(gridResource)` in a system's `setup`. Augmenting `'@sc-bot/core'` will not merge, because index.ts uses `export type *`.

### Where (T1)
types.ts (ResourceContainer, ResourceDefinition, ResourceManager), engine/create-resource-manager.ts, engine/create-world.ts, engine/create-engine.ts (delete :447-448, `ResourceManager()` call site), engine/create-world.test.ts (add: registered custom resource reset; same-definition re-register no-op; conflicting name throws).
Follow: today's `resetGameState` behaviour; `create-world.test.ts` existing reset test must pass unchanged.
Breaking: none for consumers. `createResourceManager` gains a `world` param (internal).

### Risks
- Augmented keys are typed as present even before `register` runs, so a missing register is undefined at runtime. Accepted (Q2 has the option to avoid it).
- Default recreate-in-place leaves own props that the new object doesn't have (same as today).

## Fix 2: step-end command executor

### Problem (verified)
- Agent handlers run concurrently, then agent systems run concurrently (create-engine.ts:562-589). Every high-level `actions.*` method sends immediately through `sendAction` (actions.ts:105-702). Only `queueAction` defers, and the engine flushes it at :591.
- Conflicts go to whichever system's request reaches SC2 last. The only dedupe is `repeatsCurrentOrder` (actions.ts:66), and only on the queued path.
- `unitTagsReceivedAction` (actions.ts:652) is a cooperative first-come check, used only by macro.ts (:241, :540, :639).
- Results: `do/smart/move/patrol/gather/build/train/upgrade/warpIn` throw when `result[0] !== 1`. Nobody reads the `ResponseAction` value. builder-plugin maps throw to `ERROR` and resolve to `COMMAND_SENT`/`SUCCESS`. bot/ only awaits.

### Model
Every unit command becomes a proposal. Once per step, after agent systems (where `flushQueuedActions` already runs), the executor arbitrates the proposals per unit tag and sends one `RequestAction`.

`queueAction` stays the proposal primitive, and every high-level method switches from `this.sendAction(...)` to `this.queueAction(...)`. That keeps the public surface and the existing batching docs, and makes batching the only mode.

### Ownership context (new resources/command-context.ts)
```ts
export type CommandContext = { owner: string; priority: number; rank: number };
export function runAsCommander<T>(context: CommandContext, fn: () => T): T;   // AsyncLocalStorage.run
export function currentCommander(): CommandContext;                          // default { owner: 'unknown', priority: 0, rank: Infinity }
```
- engine `dispatch` (create-engine.ts:562-589): agent handlers run in `{ owner: 'agent', priority: settings.commandPriority ?? 0, rank: -1 }`. Each agent system `i` runs in `{ owner: system._system.name, priority: wrapper.commandPriority, rank: i }` (in `agent.use` order). Engine systems issue no commands (unit.ts:276 is a query only) and get no context.
- types.ts: `SystemOptions.commandPriority?: number`, `SystemWrapper.commandPriority: number`. create-system.ts copies the option onto the wrapper. No other create-system change: handlers inherit the ALS context through await.
- Explicit override for later layers: `actions.as<T>(context: Partial<CommandContext>, fn: () => T): T`.

### Proposal and arbitration (new resources/command-arbiter.ts, pure functions)
```ts
export type Proposal = {
    command: SC2APIProtocol.ActionRawUnitCommand;   // single command, may carry N tags
    owner: string; priority: number; rank: number; seq: number;
    onDrop?: (tags: string[]) => void;
};
export type Committed = Map<string, { owner: string; priority: number; rank: number }>;
export function arbitrate(proposals: Proposal[], committed: Committed): {
    commands: SC2APIProtocol.ActionRawUnitCommand[];
    dropped: { proposal: Proposal; tags: string[]; by: string }[];
};
```
Per tag:
1. Pick the winner owner by highest priority, ties to lowest rank (registration order); this is Q3. Against a tag already committed this step by an early flush or a raw `sendAction`, a challenger has to strictly outrank the committed owner.
2. The winner keeps all its commands for that tag, in `seq` order (queued follow-ups such as gas build → gather or reactor train ×2 keep working). All other owners' commands for that tag, queued or not, are dropped.
3. Apply `repeatsCurrentOrder` (moved unchanged from actions.ts:66).

Then emit:
- Split multi-tag proposals by surviving tags.
- Merge commands that are each tag's only command this step and have identical (abilityId, target, queueCommand) into one multi-tag command, as ares does at custom_bot_ai.py:297.
- Tags with several commands are emitted unmerged, in `seq` order.

### ActionManager changes (resources/actions.ts, types.ts)
```ts
queueAction(commands: ActionRawUnitCommand | ActionRawUnitCommand[], opts?: { onDrop?: (tags: string[]) => void }): void;
flushQueuedActions(): Promise<SC2APIProtocol.ResponseAction | undefined>;   // arbitrate + one send; records Committed
as<T>(context: Partial<CommandContext>, fn: () => T): T;
// high-level command methods: Promise<ResponseAction> -> Promise<void>
do, smart, move, patrol, attack, attackMove, gather, mine, build, buildGasMine, train, upgrade, warpIn,
stop, holdPosition, repair, returnResource
```
- They stay `async`. Precondition throws (BuildError, TrainError, GatherError, ActionManagerError) still reject, so callers' try/catch keeps working. They resolve once proposed, never at flush.
- Why not resolve at flush: the engine awaits all systems before flushing, so a system that awaits its own command's result would deadlock. Results go nowhere new (Q4).
- In `flushQueuedActions`, a result other than SUCCESS is logged to `sc2:debug:actionManager` per command. SC2's `actionErrors` already reaches `frame._actionErrors` next observation (systems/frame.ts:59).
- `sendAction` stays the raw immediate path, typed unchanged. It commits its tags with the current context.
- `swapBuildings`, `toggleAutocast` and `chatSend` stay on raw sends. swapBuildings relies on 100ms real-time gaps between lift, move and land, and nobody has verified that lift plus queued move/land in one request works in SC2.
- `unitTagsReceivedAction()` keeps its meaning: tags proposed or committed this observation, any owner.
- `clearQueuedActions` also clears `Committed`. The `Committed` reset is keyed like `orderedThisObservation` (actions.ts:52).
- `patrol`: two proposals from the same owner (move, then queued patrol). It no longer chains `.then`.

### 'command' label and spend accounting
- `build` (actions.ts:458) still sets `command` at proposal time, so `units.getWorkers()` (units.ts:171) and macro's builder pick skip that worker for the rest of the step.
- New: `build` passes `onDrop` that removes the label and refunds `mineralCost`/`vespeneCost` to `world.agent`. `train` passes an `onDrop` refund. Without the label removal, a dropped build is never echoed in `observation.actions`, so frame.ts:74-85 marks the worker `stuck` after 250 loops.
- The gas follow-up `await this.gather(builder)` (actions.ts:480) moves from the `.then` to right after the build proposal. It is the same owner, queued, so it is kept with the build.
- `gather`'s force-queue on `command` (actions.ts:244) stays. It covers the cross-step window: build sent, not yet echoed.
- frame.ts label clearing: unchanged.

### Caller migration
| Site | Change |
|---|---|
| engine/create-engine.ts:562-593 | wrap agent handlers and each agent system in `runAsCommander`; flush unchanged at :591 |
| systems/create-system.ts | copy `commandPriority` option to wrapper |
| engine/create-unit.ts:109,114,119,130,583 + types.ts:229-232,281 | return types → `Promise<void>` / `Promise<void \| undefined>` |
| agent/macro.ts:268-275 | `issue()` → `actions.queueAction(command, { onDrop: refund })`; drop the `batchActions` branch |
| types.ts:174 `AgentSettings.batchActions` | remove (Q5) |
| systems/builder-plugin.ts:322-544 | no code change needed: awaits resolve after proposal, catch still catches precondition errors. Behaviour change: `COMMAND_SENT`/`SUCCESS` now means proposed. A dropped or SC2-rejected command is recovered by the existing `COMMAND_GIVEN` 250-loop timeout (builder-plugin.ts:270), and train/upgrade/ability tasks retry next step if nothing appears. |
| examples/*.ts | none (they ignore results) |
| docs: readme.md:243,256,324,768-786; docs/api.md:159,250,807; docs/changelog.md | batching is no longer opt-in; arbitration rules; `commandPriority`; `as()` |
| tests: resources/actions.test.ts (13 sites calling methods then asserting `client.sent.actions`) | add `await actions.flushQueuedActions()` or go through `engine.dispatch()` |
| agent/macro.test.ts:431 | the batchActions test becomes the default-path test |

New tests:
- command-arbiter.test.ts: priority wins; tie → rank; same-owner queue kept; losing owner's queued dropped; repeat dropped; merge only single-command tags; committed tag needs strict outrank.
- A Bun ALS + Bluebird propagation test through `engine.dispatch` with two systems.

bot/ call sites (read-only, for sizing; no compile breaks — none read the response):
- bot/systems/economy.ts:10,17,22,41,53
- bot/systems/combat/micro/basic.ts:40,51,65
- bot/systems/combat/index.ts:38
- bot/systems/combat/offense.ts:157
- bot/systems/combat/scout.ts:101,108
- bot/systems/military/wall.ts:35,40,49
- bot/systems/military/production.ts:64,122
- bot/systems/military/training.ts:16 (`actions.train`), :30 (`agent.train`)

Behaviour change for the bot: SC2-rejected commands no longer throw into the system wrapper log, and same-unit conflicts between its 5 systems resolve by `use()` order (build, economy, combat, military, log) unless it sets `commandPriority`.

### Tickets (serial, shared files)
- T1: Fix 1.
- T2a: command-context.ts, command-arbiter.ts, actions.ts (all methods → queueAction, onDrop, as(), Committed), types.ts (ActionManager, SystemOptions, SystemWrapper, Unit method returns), create-system.ts, create-engine.ts dispatch, create-unit.ts, actions.test.ts, new tests. Must be one ticket: changing the return types breaks tsc in create-unit.ts otherwise.
- T2b: macro.ts `issue`/refund, remove `batchActions` (types.ts:174), macro.test.ts.
- T2c: docs + changelog.

Don't touch: bot/ (user-owned). T1 and T2 both edit types.ts and create-engine.ts, so they must not run in parallel.

### Roles/behaviors later (not designed, just not blocked)
A role/behavior layer sets the commander per unit-group via `actions.as({ owner: role, priority })` and proposes through the same methods. "One action per unit per step" is already the arbiter's per-tag rule. A role-ownership policy ("only the role owner may command tag X") slots in as an extra filter in `arbitrate` before step 1, with no caller changes.

### Risks
1. AsyncLocalStorage propagation under Bun through Bluebird-scheduled handlers. Verify first in T2a. Fallback: an explicit `actions.as()` in create-system's wrapper around each handler call (same mechanism, narrower scope); worst case owner 'unknown' = all ties by seq.
2. Context leaks if a system fires a command from a detached callback after its handler resolved, e.g. setTimeout: it is still attributed correctly (ALS) but may land in the next step's flush. Acceptable.
3. Realtime mode: commands leave after all systems finish instead of mid-step (wall-clock only; no game-loop change in step mode).
4. `repeatsCurrentOrder` now applies to every command, so re-issuing the same order to "refresh" it becomes a no-op. This matches python-sc2.
5. Spend is still deducted at proposal time. A proposal SC2 rejects stays over-deducted until the next observation's `Object.assign` (create-agent.ts:285). This is the same as today.

## Open questions (user's call)
- Q1 Where core built-in definitions live: (a) one `CORE_RESOURCES` array in create-world.ts [rec: smallest diff], (b) each resource file exports its definition.
- Q2 How plugins register: (a) explicit `world.resources.register(def)` per world, augmentation in the plugin file [rec]; (b) global `defineResource()` auto-registry that createWorld instantiates. Importing is enough, but it is order-sensitive and `import type` silently skips it. (c) typed key `createResourceKey<T>()` + `resources.use(key)`, no augmentation, but not destructurable from `get()`.
- Q3 Tie-break at equal priority: (a) registration rank, deterministic [rec]; (b) first proposed, timing-dependent; (c) last proposed, today's effective behaviour.
- Q4 What high-level methods return: (a) `Promise<void>`, results only logged and in `frame._actionErrors` [rec, YAGNI]; (b) `Promise<CommandTicket>` with a `settled` promise resolved at flush (deadlocks if awaited inside the step); (c) (a) plus a `commandResults` event next step.
- Q5 `settings.batchActions`: (a) remove [rec, bot doesn't use it]; (b) keep as deprecated no-op.
- Q6 Production commands (train/research on structures) from different owners on the same structure: (a) arbitrate like everything else; the loser retries next step [rec, simple]; (b) treat as additive, never conflicting, which needs an ability classification.
- Q7 swapBuildings: (a) keep on raw send [rec]; (b) convert to one-step lift + queued move/land, after a live check that SC2 accepts it.

Answers: see decisions.md 2026-10-26. All recommendations except Q4 = (c) "void + result event", detailed below.

## Q4 delta: commandResults event, refund removed (technical-architect, 2026-10-26)

Supersedes: refund-on-drop and `onDrop` above (§"'command' label and spend accounting", ActionManager `queueAction` opts, macro.ts `issue()` row in Caller migration).

1. Event shape (types.ts, T03)
```ts
export type CommandResult = {
    owner: string;                                   // proposer, from command context
    command: SC2APIProtocol.ActionRawUnitCommand;    // as proposed
    tags: string[];                                  // tags this outcome covers (a proposal can split)
    outcome: 'won' | 'dropped' | 'rejected';
    reason?: 'outranked' | 'repeat';                 // dropped only
    by?: string;                                     // dropped+outranked: winning owner
    result?: SC2APIProtocol.ActionResult;            // won: SUCCESS; rejected: SC2's code
    error?: string;                                  // rejected because the client.action call threw
};
```
- An event named `commandResults` with `data: CommandResult[]`, written once per flush and only when non-empty.
- Systems handle it with `onCommandResults(world, results: CommandResult[])`.
- Use the default event type (`'agent'`). The agent and all agent/unit/build systems read that type; engine systems don't need it.

2. Where it's written
- Written in `flushQueuedActions` (resources/actions.ts) after the `client.action` response comes back. Each merged command's result is mapped back to the proposals it came from.
- Dropped entries come from `arbitrate()`. T02 change: the arbiter's dropped output now carries `reason` ('outranked' | 'repeat') and `by`, in addition to `{ proposal, tags }`.
- Delivery to readers next step needs no new code. The engine flush runs after all agent systems (create-engine.ts:591), and each system reads its events when its wrapper is entered (create-system.ts:92-94), so they see it on the next `dispatch`.
- An early mid-step `flushQueuedActions()` also writes one; readers see it next step as well.
- Raw `sendAction` is not reported, because it bypasses the executor.
- A game reset rebuilds `events`, so results aren't carried across games.
- Known existing behaviour, not changed: a paused system consumes and loses events (create-system.ts:93-98).

3. Refund: removed
The refund on drop does nothing at step-end flush. The agent overwrites minerals/vespene from the next observation (create-agent.ts:285) before any agent system reads them, so the refund is never seen. Drop it from:
- T03: the `build`/`train` drop callbacks
- T04: `issue()` in macro.ts is now just `actions.queueAction(command)`

Spend stays deducted at proposal time, same as today.

4. Cleanup hook (replaces onDrop)
- Rename it to `onNotSent?: (tags: string[], result: CommandResult) => void`. It fires for both 'dropped' and 'rejected' tags, synchronously during the flush, before the event is written.
- `build` uses it only to remove the `'command'` label from the builder. Change from today: a build SC2 rejects now clears the label immediately, so the worker isn't marked `stuck` 250 loops later (systems/frame.ts:74-85).
- `train` needs no hook.
- The event is informational. Consumers must not undo anything the hook already did.

5. Tests
- T03: assert via `createTestWorld` + `stepTo` that a system with `onCommandResults` gets 'won' for the higher-priority owner and 'dropped' (reason 'outranked', `by`) for the other one, on the step after the conflict.
- T03: a `FakeClient` returning a non-SUCCESS result produces 'rejected' with `result` set, and clears the builder's `'command'` label.
- T02: arbiter tests also check `reason`/`by`.

6. Docs (T05)
Document `commandResults` and `onCommandResults` alongside batching in readme.md and docs/api.md.

### Q4 delta clarifications (technical-architect)
- One `CommandResult` entry per (proposal, outcome) group, not per tag: a proposal split into 3 won + 1 outranked yields two entries.
- `client.action` throwing: every proposal in that flush gets 'rejected' with `error`.
- `result[i]` belongs to merged command `i`; the executor keeps a `commandIndex → proposals[]` map from the merge step and gives each covered proposal that result.
- T02 arbiter returns its own `Dropped = { proposal, tags, reason, by? }` from command-arbiter.ts; T03 maps it onto `CommandResult` (types.ts, next to `ActionManager`).
- Handler signature `onCommandResults(world, results: CommandResult[], event)`, same pascalCase dispatch as `onUnitIdle`; `events.read` also works.
- Folded into T03.
