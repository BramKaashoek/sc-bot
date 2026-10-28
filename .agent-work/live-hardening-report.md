# Live hardening report

Logs: /tmp/claude-1000/-home-bram-code-other-sc-bot-core-arch/04392267-2dfa-4dcb-bdfd-9b007e57092a/scratchpad/live-hardening/logs/ (b*, r*, p*, n*). 18 games. No code changed. No SC2 left running by me.
Time limit 600 game-s on harness games; bot/ games ran to Victory (no limit). Result 3 = time-limit tie.
Maps: A=Acropolis, B=Blueshift, E=Ephemeron, S=Simple64. Status = supply used/cap, workers, army at end.

## Games
| id | script | opponent | map | result | end (supply / workers / army) |
|---|---|---|---|---|---|
| b01 | behaviors | Medium Zerg | S | tie@600, all bases dead (supply 4/0) | 4/0, 4, 0 |
| b02 | behaviors | Medium Terran | A | tie@600 | 69/111, 64, 4 |
| b03 | behaviors | Medium Protoss | B | tie@600, bases=0, 40 idle workers from 540s | 40/64, 40, 0 |
| b04 | behaviors | Hard Zerg | A | tie@600 | 56/63, 52, 1 |
| b05 | behaviors | Hard Terran | B | tie@600, supply 28/8 | 28/8, 28, 0 |
| b06 | behaviors | Hard Protoss | E | tie@600 | 68/126, 58, 4 |
| b07 | behaviors | VeryHard Zerg | B | tie@600 | 69/126, 58, 3 |
| b08 | behaviors | VeryHard Terran | E | tie@600 | 67/126, 58, 2 |
| b09 | behaviors | VeryHard Protoss | A | DEFEAT @431s (loop 9660) | 11/8, 11, 0 |
| r01 | build-runner terran | Medium Protoss | A | DEFEAT @525s | 27/0, 27, 0 |
| r02 | build-runner protoss | Medium Zerg | B | DEFEAT @446s | 15/0, 15, 0 |
| r03 | build-runner zerg | Medium Terran | E | tie@600 | 17/30, 14, 0 |
| p01 | managing-production | Medium Protoss | A | tie@600 | 126/135, 46, 52 |
| p02 | managing-production | Hard Zerg | E | tie@600 | 119/127, 46, 45 |
| x01,x02 | (build-runner terran, mislabelled, my script bug, ignore) | Hard | B/A | tie | see logs |
| n01 | bot/index.ts | Hard Zerg | B | VICTORY 17:45 | 156/159, 21, 114 |
| n02 | bot/index.ts | Hard Protoss | A | VICTORY 20:08 | 200/200, 57, 140 |

## Handler errors (only these, 4 total, all bot/ games)
`sc2:debug:system System onStep error: onStep in Economy` (n01 twice, n02 twice):
- n01.log:108 and :658, n02.log:126: `You can not (currently) afford to build unitTypeId 19` at packages/core/resources/actions.ts:422 (`build`) from bot/systems/economy.ts:41 (supplyDepot). The depot guard is `agent.canAfford(SUPPLYDEPOT)` at economy.ts:39, then build throws.
- n02.log:259: `cannot afford training unit: 45` at actions.ts:544 (`train`) from bot/systems/economy.ts:53 via units-collection.ts:41 map.
- Cause: `agent.canAfford` and `actions.build/train` disagree. Most likely canAfford ignores earmarks while build/train respect them (earmarks are re-enabled in bot/). The throw aborts the rest of Economy's onStep that frame (svc skipped after the supplyDepot throw). Core API inconsistency; bot would just need try/catch or an earmark-aware check. No stack from the new isGroundReachable filter in bot/systems/combat/utils.ts: no errors seen.

## Suspected bugs
1. **Protoss build-runner stalls 5 game-min on unpowered core placement (core).** Repro: r02, build-runner RACE=protoss, Blueshift, vs Medium Zerg, from ~0:50 to ~6:00 game time. Evidence: r02.log has 1532 `actionManager command not accepted, result 50 (CantBuildTooFarFromBuildPowerSource)` for abilityId 894 (BUILD_CYBERNETICSCORE) at (17.5,26.5), one per frame, never relocating; the STATUS lines show supply flat at 22/31, workers 20, minerals climbing to 4380 from t=120 to t=360. Core slot `core @ ramp` apparently is not covered by the ramp pylon (or pylon not done / died); the runner retries the same point indefinitely. Suspect the build-runner build task retry/fallback in packages/core (build runner task code, not located by line) plus ramp-wall placement for Protoss. I did not confirm pylon position.
2. **Refinery retry spam on invalid geyser (core).** Repro: b04, behaviors-bot vs Hard Zerg, Acropolis, ~540-570s (370 rejections). Evidence: b04.log:137-534 `result 3: abilityId 320 (BUILD_REFINERY) targetUnitTag 8642429075`, same worker and target every frame. Likely geyser at a lost or enemy-contested base, or one that already has a refinery; gasBuildingController keeps issuing. Suspect gasBuildingController / actions.build target validity (not located by line).
3. **Gas never spent; workers stay on gas (behaviors-bot tuning, possibly core controller).** All behaviors games: gas 1500-3800 unused while minerals near 0 at times and army stays 1-4 (b01-b05). gasBuildingController toCount 4 with a composition that barely uses gas (marine/marauder/medivac). Example tuning, but nothing pulls workers off gas when banked gas is high.
4. **behaviors-bot army collapses and does not defend (example tuning, partly core spawn/production).** army 4 at t=300 then 0-4 through 600s in 8 of 9 games with 700-2600 minerals banked in b04/b06/b07/b08 (minerals 2540/2660 at end); Medium/Hard AI kills bases in b01, b03, b05 (bases=0, 25-40 workers idle with no town hall, supply cap 0). Possibly productionController/spawnController not building enough production (b06-b08 bank 2400+ minerals), unconfirmed. I did not probe production buildings (PROBE harness added but not run).
5. **Idle workers after losing last base (core/behaviors, low).** b03 540s: idleW=40, b09, r01 (27 idle), r02 (20 idle): workers have nowhere to mine and nothing sends them to rebuild a town hall or flee. Expected for a lost base, but nothing rebuilds.
6. **Build-runner examples stop after build order (example design).** r01/r02 terran/protoss stay at 15-27 supply with 4000+ minerals after `buildComplete: true`; r03 zerg sits at 17 supply, 14 workers, 5360 minerals from ~t=120. BuildRunner state is dumped every frame (~1500-2900 lines per game) as noise. Not a core bug, but the examples are not a usable macro bot.
7. **Rare extra noise:** b01.log one `command not accepted, result 9` BUILD_BARRACKS at (24.5,53.5); b06.log one for BUILD_BARRACKS at (104.5,15.5). Single occurrences, likely money race.

## Flaky / harness notes
- No crashes, no handler stacks in any example game; engine step delay ~1-1.8 ms.
- My first bot/ run (x01, x02) accidentally ran build-runner because run.sh did not export env; fixed, n01/n02 are the real bot/ runs. TMO=330 hit the timeout (exit 124) after both bot/ games already printed Victory, no impact.
- Not done: examples/ares/build-runner.ts with more maps, bot/ beyond 2 games, probing production (PROBE in harness.ts untested), idle-worker timelines.
