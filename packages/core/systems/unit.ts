import createSystem from './create-system.ts';
import createUnit from '../engine/create-unit.ts';
import { perWorld } from '../engine/per-world.ts';
import { Alliance } from '../constants/enums.ts';
import { UnitType } from '../constants/index.ts';
import { morphSource } from '../constants/dicts/morph-source.ts';
import { beginUnitLoop, markEnemyMorphed, setAvailableAbilities, storeUnit } from '../resources/units.ts';
import type { Unit, UnitSystem, World } from '../types.ts';

// python's on_unit_created fires once per tag per game, even if the unit later leaves the observation (e.g. loaded)
const seenUnitTags = perWorld(() => new Set<string>());
// forgotten ghosts leave the units store, so a re-seen enemy would otherwise look new
const seenEnemyTags = perWorld(() => new Set<string>());

const isSpentTumor = (unit: Unit) =>
    unit.unitType === UnitType.CREEPTUMORBURROWED &&
    unit.buildProgress! >= 1 &&
    unit._availableAbilitiesLoop !== undefined &&
    unit._availableAbilities.length === 0;

const unitSystem: UnitSystem = {
    name: 'UnitSystem',
    type: 'engine',
    async onGameStart(world: World) {
        seenUnitTags.clear(world);
        seenEnemyTags.clear(world);
        return this.onStep(world);
    },
    // @TODO: Figure out if units should be compared to the internal data cache, OR to the 'last frame' recieved
    // @TODO: add 'touched' metadata, either as a label or a unit prop, for advanced user-defined events
    async onStep(world: World) {
        const { events, units, frame, actions } = world.resources.get();
        const previousLoop = frame.getPrevious()?._gameLoop;

        beginUnitLoop(units, previousLoop);

        const { units: rawUnits } = frame.getObservation().rawData!;

        const isFinished = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return incData.alliance === Alliance.SELF && incData.buildProgress! >= 1 && currentUnit.buildProgress! < 1;
        };

        const isIdle = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return incData.orders!.length <= 0 && !currentUnit.noQueue;
        };

        const isDamaged = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return incData.shield! < currentUnit.shield! || incData.health! < currentUnit.health!;
        };

        const isTransforming = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return currentUnit.unitType !== incData.unitType;
        };

        const hasBurrowed = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return incData.isBurrowed && !currentUnit.isBurrowed;
        };

        const hasEngaged = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return currentUnit.engagedTargetTag === '0' && incData.engagedTargetTag !== '0';
        };

        const hasDisengaged = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return currentUnit.engagedTargetTag !== '0' && incData.engagedTargetTag === '0';
        };

        const hasSwitchedTargets = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return (
                currentUnit.engagedTargetTag !== '0' &&
                incData.engagedTargetTag !== '0' &&
                currentUnit.engagedTargetTag !== incData.engagedTargetTag
            );
        };

        const seenTags = new Set<string>();
        const unitTags = seenUnitTags.get(world);
        const enemyTags = seenEnemyTags.get(world);

        const writePythonStyleEvents = (
            incData: SC2APIProtocol.Unit,
            unit: Unit,
            previous?: { isStructure: boolean; buildProgress: number },
        ) => {
            if (incData.alliance !== Alliance.SELF) return;

            if (!unit.isStructure()) {
                if (!unitTags.has(incData.tag!)) {
                    unitTags.add(incData.tag!);
                    events.write({ name: 'unitSpawned', data: unit, type: 'all' });
                }
                return;
            }

            if (!previous?.isStructure) {
                events.write({
                    name: incData.buildProgress! < 1 ? 'structureConstructionStarted' : 'structureConstructionComplete',
                    data: unit,
                    type: 'all',
                });
            } else if (previous.buildProgress < 1 && incData.buildProgress! >= 1) {
                events.write({ name: 'structureConstructionComplete', data: unit, type: 'all' });
            }
        };

        rawUnits!.forEach((unitData) => {
            seenTags.add(unitData.tag!);
            if (units._units[unitData.alliance!].has(unitData.tag!)) {
                const currentUnit = units._units[unitData.alliance!].get(unitData.tag!)!;
                if (isFinished(unitData, currentUnit)) {
                    events.write({
                        name: 'unitFinished',
                        data: currentUnit,
                        type: 'all',
                    });

                    if (unitData.orders!.length === 0) {
                        events.write({
                            name: 'unitIdle',
                            data: currentUnit,
                            type: 'all',
                        });
                    }
                }

                if (isIdle(unitData, currentUnit)) {
                    events.write({
                        name: 'unitIdle',
                        data: currentUnit,
                        type: 'all',
                    });
                }

                if (
                    unitData.alliance === Alliance.ENEMY &&
                    !unitData.isHallucination &&
                    (unitData.unitType! in morphSource || unitData.unitType === UnitType.HELLIONTANK)
                )
                    markEnemyMorphed(units, unitData.tag!);

                if (isTransforming(unitData, currentUnit)) {
                    events.write({
                        name: 'unitIsTransforming',
                        data: currentUnit,
                        type: 'all',
                    });
                }

                if (hasBurrowed(unitData, currentUnit)) {
                    events.write({
                        name: 'unitHasBurrowed',
                        data: currentUnit,
                        type: 'all',
                    });
                }

                if (hasEngaged(unitData, currentUnit)) {
                    events.write({
                        name: 'unitHasEngaged',
                        data: currentUnit,
                        type: 'all',
                    });
                }

                if (hasDisengaged(unitData, currentUnit)) {
                    events.write({
                        name: 'unitHasDisengaged',
                        data: currentUnit,
                        type: 'all',
                    });
                }

                if (hasSwitchedTargets(unitData, currentUnit)) {
                    events.write({
                        name: 'unitHasSwitchedTargets',
                        data: currentUnit,
                        type: 'all',
                    });
                }

                if (unitData.alliance === Alliance.SELF) {
                    if (isDamaged(unitData, currentUnit)) {
                        events.write({
                            name: 'unitTookDamage',
                            data: {
                                unit: currentUnit,
                                amount:
                                    currentUnit.health! - unitData.health! + (currentUnit.shield! - unitData.shield!),
                            },
                            type: 'all',
                        });
                    }

                    if (isTransforming(unitData, currentUnit)) {
                        events.write({
                            name: 'unitTypeChanged',
                            data: { unit: currentUnit, previousType: currentUnit.unitType },
                            type: 'all',
                        });
                    }
                }

                if (unitData.alliance === Alliance.ENEMY && currentUnit.lastSeen !== previousLoop) {
                    events.write({
                        name: 'enemyUnitEnteredVision',
                        data: currentUnit,
                        type: 'all',
                    });
                }

                const previous =
                    unitData.alliance === Alliance.SELF
                        ? { isStructure: currentUnit.isStructure(), buildProgress: currentUnit.buildProgress! }
                        : undefined;
                currentUnit.update(unitData);
                writePythonStyleEvents(unitData, currentUnit, previous);
            } else {
                const newUnit = createUnit(unitData, world);

                if (unitData.alliance === Alliance.SELF) {
                    events.write({
                        name: 'unitCreated',
                        data: newUnit,
                        type: 'all',
                    });

                    if (unitData.orders!.length === 0) {
                        events.write({
                            name: 'unitIdle',
                            data: newUnit,
                            type: 'all',
                        });
                    }
                } else if (unitData.alliance === Alliance.ENEMY) {
                    if (!enemyTags.has(unitData.tag!)) {
                        enemyTags.add(unitData.tag!);
                        events.write({
                            name: 'enemyFirstSeen',
                            data: newUnit,
                            type: 'all',
                        });
                    }

                    events.write({
                        name: 'enemyUnitEnteredVision',
                        data: newUnit,
                        type: 'all',
                    });
                }

                storeUnit(units, unitData.alliance!, unitData.tag!, newUnit);
                writePythonStyleEvents(unitData, newUnit);
            }
        });

        units._units[Alliance.ENEMY].forEach((enemy) => {
            if (enemy.lastSeen === previousLoop && !seenTags.has(enemy.tag!)) {
                events.write({
                    name: 'enemyUnitLeftVision',
                    data: enemy,
                    type: 'all',
                });
            }
        });

        const gameLoop = frame.getGameLoop();
        if (world.agent.settings?.skipAvailableAbilitiesQuery) {
            units._units[Alliance.SELF].forEach((unit) => {
                if (unit._availableAbilitiesLoop !== gameLoop)
                    setAvailableAbilities(unit, [], unit._availableAbilitiesLoop);
            });
            return;
        }

        const ownUnitTags = Array.from(units._units[Alliance.SELF].values())
            .filter((unit) => !isSpentTumor(unit))
            .map((unit) => unit.tag!);
        return actions
            .sendQuery({
                abilities: ownUnitTags.map((tag) => ({
                    unitTag: tag,
                })),
            })
            .then((res) => {
                res.abilities!.forEach((abilObj) => {
                    const unit = units.getByTag(abilObj.unitTag!)!;
                    setAvailableAbilities(
                        unit,
                        abilObj.abilities!.map((a) => a.abilityId!),
                        gameLoop,
                    );
                });
            });
    },
};

export default () => createSystem(unitSystem);
