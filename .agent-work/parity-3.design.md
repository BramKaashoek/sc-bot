# parity-3 design

Author: technical-architect (2026-10-26). Covers ares-gap ranked #2 (combat sim), #3 (roles + squads), #7 (intel: threats near bases, rush/strategy detection). Builds on core-arch (registry, executor, `as()`) and parity-2 (onStep D1, memory, spatial). All paths are under packages/core/ and were checked against the worktree. ares paths are relative to ares-sc2/src/ares/.

## Current state (verified)
- Per-pair damage exists: `unit.calculateDamageVsTarget(target, ignoreArmor, includeOverkill)` returns `[damage, weaponSpeed, range]`, and `calculateDpsVsTarget` (engine/create-unit.ts:415, :563) is built on it. It handles upgrades, armor, shields, guardian shield, bunker (enemy: assumes 4 marines), BC and stim. Unfinished attackers return 0. Weapon `speed` and `movementSpeed` in data.json are both normal-speed values (marine 0.861 / 2.25), so one time base is consistent.
- Roles: nothing. Labels exist (create-unit.ts:133), but unit systems treat any labelled unit specially (systems/unit-plugin.ts:31-40: labelled units are excluded from the type buckets, and `hasNoLabels` drives idle dispatch). bot/ uses no labels.
- `as()` override: resources/actions.ts:624 runs `fn` in `{ ...currentCommander(), ...context }`. Arbiter: resources/command-arbiter.ts `arbitrate(proposals, committed, isRepeat)`. Flush: actions.ts `flushQueuedActions`.
- Own dead units stay in `units._units[SELF]` with the `'dead'` label (systems/frame.ts:103-106). Cargo (units loaded in a medivac or bunker) isn't current but is alive.
- Intel: nothing. `map.getMain()/getNatural()/getEnemyNatural()`, `map.getLocations().enemy[0]`, `frame.time()` (loop / 22.4) and `units.getBases()` exist. Phase 2 provides `memory.getEnemies()` (ghosts included) and `spatial.unitsInRange(from, d, 'enemyGround' | 'enemyAir')`.
- Events written during `resources.step` (P0: after engine systems, before agent) reach the agent and agent systems in the same dispatch.

## Q0. Resources vs functions
- roles, squads and intel are registered resources with `onStep` where they keep per-step state.
- The combat sim is stateless, so it is a pure exported function, not a resource. This follows D5 (army value is a query).

## Q1. Scaffolding (blocks Q3–Q6)
types.ts:
```ts
export type UnitRole = (typeof UnitRoles)[keyof typeof UnitRoles];          // import type * as UnitRoles from './constants/unit-role.ts'
export type EngagementResult = (typeof EngagementResults)[keyof typeof EngagementResults];
export interface ResourceContainer { ...; roles: RolesResource; squads: SquadsResource; intel: IntelResource }
export type CommandResult = { ...; reason?: 'outranked' | 'repeat' | 'not-owner' };   // + 'not-owner'
// + every interface/type below (RolesResource, RoleSettings, Squad, SquadsResource, IntelResource, IntelSettings, IntelFlag, BaseThreat, FightOptions, FightSimulation)
```
- constants/unit-role.ts (new): one `export const X = 'X'` per ares UnitRole (consts.py:492-561, all 56 names, the same pattern as unit-type.ts). Re-exported as `UnitRole` from constants/index.ts.
- constants/engagement-result.ts (new, created by Q2): `VICTORY_EMPHATIC = 10` … `LOSS_EMPHATIC = 0` (ares consts.py:265), so results compare numerically (`r >= VICTORY_CLOSE`). Re-exported as `EngagementResult`.
- engine/create-world.ts: add `roles`, `squads`, `intel` to CORE_RESOURCES after `pathing`, in that order. The order matters for onStep: memory forgets first, then roles, then intel reads spatial.
- Stub resources/roles.ts, squads.ts, intel.ts whose methods throw `NodeSC2Error('not implemented')`. They follow the parity-2 P0 pattern.
- index.ts: export `canWinFight`, `simulateFight` from utils/combat/combat-sim.ts.
- Tests: the existing create-world tests pass; the three names resolve from `resources.get()`.
- Follow: parity-2 P0.

## Q2. Combat sim: utils/combat/combat-sim.ts (pure) + constants/engagement-result.ts
```ts
export type FightOptions = {
    timingAdjust?: boolean;        // true: each unit starts shooting once it could reach its closest hittable target
    workersDoNoDamage?: boolean;   // false
    maxSeconds?: number;           // 60 (normal-speed seconds, the data's time base)
};
export type FightSimulation = { ownWins: boolean; ownHealthLeft: number; enemyHealthLeft: number; ownHealthStart: number; enemyHealthStart: number; seconds: number };
export function simulateFight(own: Unit[], enemy: Unit[], opts?: FightOptions): FightSimulation;
export function canWinFight(own: Unit[], enemy: Unit[], opts?: FightOptions): EngagementResult;
```
Model: a deterministic time-stepped focus-fire sim on typed arrays, built on `calculateDpsVsTarget`.
1. HP = health + shield, on both sides. ares counts own health only (a Protoss bug).
2. DPS matrix: cache per call keyed by (side, unitType, attackUpgradeLevel, stim buff) → (side, unitType, armorUpgradeLevel, isFlying). The value is `representativeAttacker.calculateDpsVsTarget(representativeTarget, false, true)`, with the first unit of each key as the representative. With `workersDoNoDamage`, worker rows are 0. Typically ≤ 10×10 entries.
3. Start time per unit: with timingAdjust, `max(0, dist − radiusA − radiusT − range) / realSpeed()` to the closest enemy it has DPS > 0 against. A static unit out of range (speed 0) never fires. Without timingAdjust, the start time is 0.
4. Ticks of dt = 0.25s:
   - Each side's targets are sorted by current HP ascending, ties by input index.
   - Each attacker that is active (t ≥ start, alive) walks that list to the first target with `hp − pending > 0` that it has DPS > 0 against, and adds `dps × dt` to that target's pending damage. Lowest-HP focus without overkill, so a big army spreads its fire.
   - Damage applies to both sides simultaneously at the end of the tick.
5. Stop when a side is dead, when neither side can deal damage any more, or at maxSeconds.
   - Winner: the side with units left while the other has none.
   - Both sides dead: TIE.
   - Otherwise (timeout or stalemate): the higher remaining-HP fraction wins, and equal fractions are a TIE.
   - Empty enemy gives VICTORY_EMPHATIC, empty own gives LOSS_EMPHATIC, both empty gives TIE.
6. `canWinFight` buckets exactly as ares (combat_sim_manager.py:100-170):
   - Win, by own HP left / own start: ≥.9 EMPHATIC, ≥.75 OVERWHELMING, ≥.6 DECISIVE, >.4 CLOSE, >.2 MARGINAL, else TIE.
   - Loss, by enemy HP left / enemy start: ≥.9 LOSS_EMPHATIC, ≥.75 LOSS_OVERWHELMING, >.6 LOSS_DECISIVE, >.4 LOSS_CLOSE, >.2 LOSS_MARGINAL, else TIE.
- No allocation per tick: the arrays are sized once per call.
- Not modelled (documented as known limitations): splash, healing (medivac/transfuse/repair), spells, terrain and chokes, own bunker passengers, and micro. ares' `good_positioning` only affects splash in sc2_helper, so it is not offered.
- Tests: utils/combat/combat-sim.test.ts uses `createTestWorld` with `rawUnit` units (fixtures/data.json gives real weapons). Scripted fixtures with their expected outcomes:
  - 10 marines vs 4 zerglings → ≥ VICTORY_DECISIVE.
  - 4 marines vs 8 zerglings at range 0 → loss.
  - 1 marine vs 1 marine → TIE.
  - Identical 8v8 mixed armies → TIE.
  - 5 vikings (fighter, air-only) vs 5 marines → LOSS_EMPHATIC (the vikings deal 0).
  - A sieged tank vs 4 zealots at distance 12 → win with timingAdjust, worse or a loss without it.
  - 20 SCVs vs 1 mutalisk with workersDoNoDamage → loss.
  - +1 attack flips a mirror 8v8 marine fight to a win.
  - The empty-side cases.
  - Perf: 60 marines vs 60 zerglings, median of 20 runs ≤ 3ms (`performance.now()`).
- Follow: ares combat_sim_manager.py (buckets only); create-unit.ts:415-566 (damage).
- Don't touch: create-unit.ts.

## Q3. Roles: resources/roles.ts
```ts
export type RoleSettings = {
    defaultRole: (unit: Unit) => UnitRole | undefined;   // default: worker (not MULE) → GATHERING, else none (ares unit_role_manager.py:149)
    exclusive: UnitRole[];                               // default []; see Q5
};
export interface RolesResource {
    assign(units: Unit | Unit[] | string | string[], role: UnitRole): void;     // replaces any previous role
    clear(units: Unit | Unit[] | string | string[]): void;
    switchRole(from: UnitRole, to: UnitRole): void;
    get(roles: UnitRole | UnitRole[], opts?: { types?: number | number[]; excludeTypes?: number | number[] }): Units;
    roleOf(unit: Unit | string): UnitRole | undefined;
    getTags(role: UnitRole): ReadonlySet<string>;
    as<T>(role: UnitRole, fn: () => T, opts?: { priority?: number }): T;        // actions.as({ owner: `role:${role}`, priority }, fn); priority defaults to the current commander's
    mayCommand(owner: string, tag: string): boolean;                           // Q5 filter
    configure(settings: Partial<RoleSettings>): void;
}
```
- State: `Map<tag, UnitRole>` plus `Map<UnitRole, Set<tag>>` (insertion order = assignment order), plus a `seen: Set<tag>`.
- Roles are not stored as labels, so unit systems' label filtering is unaffected (see Current state).
- `get` returns only current, non-dead own units (like `getAlive`). Cargo keeps its role and reappears on unload.
- onStep:
  1. Drop tags whose unit is missing from `_units[SELF]` or labelled `'dead'`, and drop them from `seen`.
  2. For each current, finished own unit whose tag is not in `seen`: add it to `seen`, then assign `defaultRole(unit)` if that is defined. The resolver therefore runs once per unit, and a role cleared by the bot is not re-defaulted.
- reset: clear the per-game state and keep the settings (D10).
- Tests:
  - assign/batch/clear/switch;
  - get with types and excludeTypes;
  - a new SCV gets GATHERING, a MULE and a marine get none;
  - a cleared SCV stays roleless next step;
  - a dead unit's tag is removed;
  - cargo (not current) keeps its role and is absent from `get`;
  - `as()` proposals carry owner `role:ATTACKING` (assert through the `commandResults` owner);
  - settings survive reset.
- Follow: ares managers/unit_role_manager.py:149-392; core-arch `as()`.

## Q4. Squads: resources/squads.ts
```ts
export type Squad = { id: string; role: UnitRole; units: Units; tags: ReadonlySet<string>; position: Point2D; isMain: boolean };
export interface SquadsResource {
    getSquads(role: UnitRole, opts?: { radius?: number; types?: number | number[] }): Squad[];   // radius 6
    getMainSquad(role: UnitRole, opts?: { radius?: number; types?: number | number[] }): Squad | undefined;
    getMainSquadPosition(role: UnitRole, opts?: { types?: number | number[] }): Point2D;           // last main position, else map.getMain().townhallPosition
}
```
- Lazy: clustering runs on the first `getSquads` call per (role, sorted types) key per game loop. Repeat calls in the same loop return the cached result, so the one-merge-per-update rule can't run twice.
- State per key: `Map<id, { tags: Set<string>; created: number }>`.
- Algorithm, ported from ares squad_manager.py:187-516, run on `roles.get(role, { types })`:
  1. Prune tags no longer in the role's units, and remove empty squads. This replaces ares' remove-tag-on-assign.
  2. Strays: a unit farther than `radius` from its squad's previous centroid leaves the squad.
  3. Merge at most one pair per update: the first squad (in creation order) whose centroid is within `radius` of another squad's centroid merges. Deviation from ares: the smaller squad merges into the larger one, and on equal size the newer into the older, so the main squad keeps its id.
  4. Each unassigned unit joins the squad with the closest centroid within `radius`, else starts a new squad. Ids are `${role}-${n}` from a per-key counter, which makes them deterministic.
  5. Recompute units and centroid (mean position).
  6. Main squad = most units, ties to the lowest `created`. Store its position for `getMainSquadPosition`.
- onStep: none. reset: clear the state.
- Tests:
  - two separated groups give two squads;
  - one unit drifting out of radius leaves its squad while the squad keeps its id;
  - one unit joining keeps the id;
  - two squads converging merge, keeping the bigger squad's id;
  - main squad and position;
  - two calls in one loop return identical results;
  - a role change removes the tag;
  - with no squads, the position is the main base.
- Follow: ares squad_manager.py.
- Don't touch: roles.ts.

## Q5. Role-exclusive arbitration: command-arbiter.ts + actions.ts
- `arbitrate(proposals, committed, isRepeat, mayCommand?: (owner: string, tag: string) => boolean)`. Before step 1 (pick the winner), proposals with `mayCommand(owner, tag) === false` are dropped for that tag with `reason: 'not-owner'` and `by: 'role:<ROLE>'`.
- `roles.mayCommand(owner, tag)` returns false only when the tag's role is in `settings.exclusive` and `owner !== \`role:${role}\``.
- actions.ts `flushQueuedActions` passes `world.resources.get().roles.mayCommand`. The CommandResult mapping already copies `reason` and `by`.
- Raw `sendAction`/`swapBuildings` are not filtered. That is documented (same as reporting).
- Opt-in (exclusive defaults to `[]`), so default behaviour is unchanged.
- Tests:
  - arbiter: a not-owner proposal is dropped while the owner's own proposal survives, and without `mayCommand` nothing changes;
  - executor: an exclusive ATTACKING unit commanded by a system outside `roles.as` gets 'dropped'/'not-owner', and inside `roles.as('ATTACKING')` it wins.
- Follow: core-arch design "Roles/behaviors later".

## Q6. Intel: resources/intel.ts
```ts
export type IntelFlag = 'workerRush' | 'lingRush' | 'roachRush' | 'ravagerRush' | 'marineRush' | 'marauderRush'
    | 'fourGate' | 'proxyZealot' | 'proxy' | 'reaper' | 'expanded' | 'baseOutsideNatural' | 'greedy' | 'rushed';
export type BaseThreat = { townhall: Unit; ground: Units; air: Units; groundSupply: number; airSupply: number };
export type IntelSettings = {
    groundNearBase: number;     // 15 (ares config.yml Distances)
    airNearBase: number;        // 20
    groundLeavingBase: number;  // 24
    airLeavingBase: number;     // 22
    greedyTwoBaseBefore: number;    // 65 s, T/P 2nd townhall start time (no ares source)
    greedyThreeHatchBefore: number; // 90 s, zerg 3rd hatchery start time (no ares source)
};
export interface IntelResource {
    getBaseThreats(): BaseThreat[];                       // own townhalls with ≥1 tracked enemy
    getMainThreat(kind: 'ground' | 'air'): BaseThreat | undefined;   // most supply of that kind
    has(flag: IntelFlag): boolean;                        // sticky for the game
    detectedAt(flag: IntelFlag): number | undefined;      // game loop
    getProxies(): Units;                                  // proxy rule below
    configure(settings: Partial<IntelSettings>): void;
}
```
onStep:

1. Threats (ares enemy_to_base_manager.py:170-330). Per own townhall (`units.getBases()`):
   - Add the tags of current (visible) enemies from `spatial.unitsInRange(th, groundNearBase, 'enemyGround')` to that townhall's ground set, and the same for air.
   - Then, per townhall and kind, clear the whole set when there is no townhall any more, when no enemy of that kind is within the leaving distance (spatial, ghosts included), or when the closest one is beyond it or a ghost. That is ares' hysteresis, quirk included.
   - `getBaseThreats` resolves the sets to current units. Supply is the sum of `data().foodRequired`.
2. Flags. They are computed from `memory.getEnemies()` (ghosts included, like ares' enemy army dict) with t = `frame.time()`. Each rule is ported from intel_manager.py:145-409 with ares' constants; distances are given as plain values, not squared:
   - lingRush: (t<150 and >2 lings within 50 of own start), or (t<180 and >7 lings), or (t<90 and >4 lings).
   - roachRush: (t<240 and ≥6 roaches within 50 of own start), or (t<180 and ≥3 roaches).
   - ravagerRush: t<240 and ≥1 ravager.
   - marineRush: requires t≤210, enemy townhalls <2 and no enemy factory. Then (t<180 and ≥3 barracks), or (t<300 and the number of marines farther than 60 from the enemy start is ≥ max(3, floor(t/45))).
   - marauderRush: requires t≤240. Then (an enemy techlab within 55 of the own natural), or (t<210 and ≥2 marauders), or (t<160 and ≥1 marauder).
   - fourGate: requires t≤210 and enemy townhalls <2. Then t<200 and ≥3 gateways.
   - proxyZealot: requires t≤240. Then (≥2 gateways within 100 of the own start and farther than 60 from the enemy start), or (t<150 and ≥1 zealot within 65 of the own start).
   - workerRush: t<180 and >6 enemy workers within 15 of the own start or within 16 of the own natural.
   - reaper: any reaper.
   - expanded: an enemy townhall farther than 6 from the enemy start.
   - baseOutsideNatural: an enemy townhall farther than 6 from both the enemy start and the enemy natural.
   - proxy: t<240 and `getProxies()` is non-empty. The proxy rule: enemy structures, ghosts included, within 100 of the own start and farther than 60 from the enemy start, excluding creep tumors and gas buildings.
   - greedy (new, because ares declares it but never sets it): an enemy townhall's start time is `t − buildProgress × buildTime`. Greedy when a 2nd non-zerg townhall started before greedyTwoBaseBefore, or a 3rd hatchery before greedyThreeHatchBefore.
   - rushed (ares get_did_enemy_rush, ported exactly): lingRush or workerRush or (marauderRush and not expanded) or proxyZealot or ravagerRush or (marineRush and no enemy structure within 15 of the own natural) or fourGate or roachRush or (t<240 and ≥3 roaches) or (t<105 and ≥1 ling) or (t<120 and ≥2 barracks).
   - The rules gate on unit types, not on enemy race. Only one race has those types, and enemy race on first sighting is a phase-6 item.
   - The first time a flag turns true:
     - record the game loop;
     - write the event `{ name: 'enemyStrategyDetected', data: { flag, gameLoop } }`. Agents and systems handle it with `onEnemyStrategyDetected(world, data)`, in the same step.
- The enemy start is `map.getLocations().enemy[0]`, as in ares. Own start: `map.getMain().townhallPosition`; own/enemy natural: `getNatural()` / `getEnemyNatural()` `.townhallPosition`.
- reset: clear flags and sets, keep settings.
- Tests (createTestWorld + stepTo with synthetic observations, like parity-2 P1):
  - a zergling near a CC is tracked as ground, and is cleared when it walks beyond 24 or becomes a ghost;
  - an overlord at 18 counts as air but not ground;
  - the main threat is the base with the most supply;
  - each flag gets one positive fixture and one negative fixture (time window passed / under threshold);
  - the event fires once;
  - flags are sticky;
  - settings survive reset;
  - perf: intel + roles onStep on the blueshift fixture with ~40 enemies, median over 50 steps ≤ 1ms.
- Follow: ares enemy_to_base_manager.py, intel_manager.py.
- Don't touch: memory.ts, spatial.ts.

## Q7. Docs (per docs-plan.md §2 phase 3)
- readme.md:
  - TOC and `resources.get()` destructure line: `roles`, `squads`, `intel`.
  - New `### roles`, `### squads`, `### intel` under Resources, after pathing (registration order). Each gets a method table, defaults and one example.
  - roles: the default role, exclusive ownership through `roles.as`, and that roles are not labels.
  - New top-level `## Utilities` (after Resources, before Constants) with `canWinFight`/`simulateFight`, the EngagementResult scale and a "Fights" example: engage when `>= VICTORY_CLOSE`.
  - Events table: `onEnemyStrategyDetected`. Add `'not-owner'` to the `commandResults` reasons.
  - Constants: `UnitRole`, `EngagementResult`.
  - "Where this library differs from ares-sc2":
    - own Lanchester-style sim instead of sc2_helper, own HP including shields, no good_positioning;
    - squads merge smaller into larger, with deterministic ids;
    - rush rules gate on unit types, not race;
    - greedy is defined here, where ares never sets it;
    - roles are not labels.
  - Known limitations: what the combat sim does not model.
- docs/api.md: `### roles`, `### squads`, `### intel` under Resources; `## Utilities` (created here unless parity-2 T01 already exported a utility) with both functions and FightOptions; EventConsumer `onEnemyStrategyDetected`; CommandResult reason.
- docs/internals.md: the Resources list gains roles, squads, intel.
- docs/changelog.md: `Unreleased › Phase 3: combat sim, roles, squads, intel` with Added, Changed (`CommandResult.reason` gains `'not-owner'`) and Migrating bot/ (optional adoption: `roles.configure({ defaultRole })` for army → ATTACKING; replace hand-rolled engage checks with canWinFight; read intel flags).

## Order / file ownership
- Q2 combat sim: new files only (utils/combat/combat-sim.ts + test, constants/engagement-result.ts). Unblocked now.
- Q1 scaffolding: types.ts, create-world.ts, constants/index.ts, constants/unit-role.ts, index.ts, and stubs roles.ts/squads.ts/intel.ts.
  - Blocked by parity-2 T01 (same files) and Q2 (re-export).
  - It is the only phase-3 ticket that edits types.ts, create-world.ts, constants/index.ts or index.ts.
  - Phase-4/6a scaffolding tickets edit the same files, so the PM chains them after it.
- Q3 roles: resources/roles.ts (+test). Blocked by Q1.
- Q4 squads: resources/squads.ts (+test). Blocked by Q3 (its tests need real roles).
- Q5 exclusive arbitration: command-arbiter.ts (+test), actions.ts (flushQueuedActions only), command-executor.test.ts.
  - Blocked by Q3 and by core-arch T03/T04 (actions.ts).
  - It also must not run in parallel with any phase-4 ticket that edits actions.ts.
- Q6 intel: resources/intel.ts (+test). Blocked by Q1 and parity-2 T02 (memory) and T03 (spatial).
- Q7 docs: blocked by Q2–Q6 and parity-2 T09 (docs chain).
- Don't touch: bot/, create-unit.ts, memory.ts, spatial.ts, influence.ts, pathing.ts, map.ts, macro.ts.

## Decisions taken (for the team lead's log)
- P3-D1. The combat sim is pure exported functions, not a resource: it is stateless, as with D5.
- P3-D2. The sim is our own deterministic focus-fire time-step on `calculateDpsVsTarget`, with a per-type DPS cache. There is no native sc2_helper in JS, and per-pair DPS already carries upgrades and armor.
- P3-D3. The sim does not model splash, healing, spells, terrain or micro, and offers no `goodPositioning`. That keeps it small and deterministic; the gaps are documented.
- P3-D4. EngagementResult uses ares' 0–10 scale and buckets, so ares thresholds port.
- P3-D5. Roles live in their own resource, not in labels. unit-plugin gives labelled units special dispatch, which would change behaviour for every defaulted unit.
- P3-D6. The default role is ares': workers except MULE → GATHERING, nothing else; it is configurable via `defaultRole`. This gives ares parity with no surprise ownership. The resolver runs once per tag, so a cleared role is not re-defaulted.
- P3-D7. Role ownership uses `roles.as(role)` = `actions.as({ owner: 'role:<ROLE>' })`, plus an opt-in `exclusive` filter in `arbitrate`. This is roadmap A4: no new ownership mechanism, and the default behaviour is unchanged.
- P3-D8. Squads are a separate lazy resource, clustered once per loop per (role, types). Nothing is paid unless used, and no double merge happens within a loop.
- P3-D9. Squad merge goes smaller into larger and ids are deterministic counters: stable main-squad identity and testable output.
- P3-D10. Intel is a resource with onStep, registered after pathing: its sticky flags and threat hysteresis need every step's observation.
- P3-D11. Rush rules gate on unit types, not enemy race: only one race has the type, and race detection is phase 6.
- P3-D12. `greedy` is defined here with configurable start-time thresholds (65s 2nd T/P base, 90s 3rd hatch). ares never sets it; these numbers are our judgement, not ported.
- P3-D13. A new `enemyStrategyDetected` event fires once per flag, in the same step. It fits core's event model, and it is one write.
- P3-D14. HP includes shields on both sides, which fixes ares' own-shields omission.

Nothing needs the user.
