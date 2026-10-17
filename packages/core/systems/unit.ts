import createSystem from './create-system.ts';
import createUnit from '../engine/create-unit.ts';
import { Alliance } from '../constants/enums.ts';
import type { Unit, UnitSystem, World } from '../types.ts';

const unitSystem: UnitSystem = {
    name: 'UnitSystem',
    type: 'engine',
    async onGameStart(world: World) {
        return this.onStep(world);
    },
    /**
     * Unit event creation happens here because it's convenient, not because
     * it's necessarily the proper ownership model...
     *
     * But how else to do an entire extra clone and/or iteration just for events
     * without a large perf hit... haven't quite figured that one out yet.
     *
     * @TODO: Figure out if units should be compared to the internal data cache,
     * OR to the 'last frame' recieved, OR to some mix of both.
     * 
     * @TODO: I would also really like to add 'touched' metadata, either as a label
     * or a unit prop. This would allow for advanced user-defined events, by providing
     * an iterator of 'touched' units, along with a diff. It would be off by default
     * for perf - but initial testing shows that it would be possible to do without
     * an untenable perf hit. 
     */
    async onStep(world: World) {
        const { events, units, frame, actions } = world.resources.get();

        const { units: rawUnits } = frame.getObservation().rawData!;

        const isFinished = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return (
                incData.alliance === Alliance.SELF &&
                incData.buildProgress! >= 1 &&
                currentUnit.buildProgress! < 1
            );
        };

        const isIdle = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return incData.orders!.length <= 0 && !currentUnit.noQueue;
        };

        const isDamaged = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return (
                incData.shield! < currentUnit.shield! ||
                incData.health! < currentUnit.health!
            );
        };

        const isTransforming = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return currentUnit.unitType !== incData.unitType;
        };

        const hasBurrowed = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return incData.isBurrowed && !currentUnit.isBurrowed;
        };

        const hasEngaged = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return (
                currentUnit.engagedTargetTag === '0' &&
                incData.engagedTargetTag !== '0'
            );
        };

        const hasDisengaged = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return (
                currentUnit.engagedTargetTag !== '0' &&
                incData.engagedTargetTag === '0'
            );
        };

        const hasSwitchedTargets = (incData: SC2APIProtocol.Unit, currentUnit: Unit) => {
            return (
                currentUnit.engagedTargetTag !== '0' &&
                incData.engagedTargetTag !== '0' &&
                currentUnit.engagedTargetTag !== incData.engagedTargetTag
            );
        };

        rawUnits!.forEach(unitData => {
            // unit tag from frame exists in the internal store
            if (units._units[unitData.alliance!].has(unitData.tag!)) {
                const currentUnit = units._units[unitData.alliance!].get(unitData.tag!)!;
                if (isFinished(unitData, currentUnit)) {
                    events.write({
                        name: "unitFinished",
                        data: currentUnit,
                        type: 'all',
                    });

                    if (unitData.orders!.length === 0) {
                        events.write({
                            name: "unitIdle",
                            data: currentUnit,
                            type: 'all',
                        });
                    }
                }

                if (isIdle(unitData, currentUnit)) {
                    events.write({
                        name: "unitIdle",
                        data: currentUnit,
                        type: 'all',
                    });
                }

                if (isTransforming(unitData, currentUnit)) {
                    events.write({
                        name: "unitIsTransforming",
                        data: currentUnit,
                        type: 'all',
                    });
                }

                if (hasBurrowed(unitData, currentUnit)) {
                    events.write({
                        name: "unitHasBurrowed",
                        data: currentUnit,
                        type: 'all',
                    });
                }

                if (hasEngaged(unitData, currentUnit)) {
                    events.write({
                        name: "unitHasEngaged",
                        data: currentUnit,
                        type: 'all',
                    });
                }

                if (hasDisengaged(unitData, currentUnit)) {
                    events.write({
                        name: "unitHasDisengaged",
                        data: currentUnit,
                        type: 'all',
                    });
                }

                if (hasSwitchedTargets(unitData, currentUnit)) {
                    events.write({
                        name: "unitHasSwitchedTargets",
                        data: currentUnit,
                        type: 'all',
                    });
                }

                if (
                    unitData.alliance === Alliance.SELF &&
                    isDamaged(unitData, currentUnit)
                ) {
                    events.write({
                        name: "unitDamaged",
                        data: currentUnit,
                        type: 'all',
                    });
                }

                currentUnit.update(unitData);

                // unit tag has never been seen before
            } else {
                const newUnit = createUnit(unitData, world);

                if (unitData.alliance === Alliance.SELF) {
                    events.write({
                        name: "unitCreated",
                        data: newUnit,
                        type: 'all',
                    });

                    if (unitData.orders!.length === 0) {
                        events.write({
                            name: "unitIdle",
                            data: newUnit,
                            type: 'all',
                        });
                    }
                } else if (unitData.alliance === Alliance.ENEMY) {
                    events.write({
                        name: "enemyFirstSeen",
                        data: newUnit,
                        type: 'all',
                    });
                }

                units._units[unitData.alliance!].set(unitData.tag!, newUnit);
            }
        });

        const ownUnitTags = Array.from(units._units[Alliance.SELF].keys());
        return actions.sendQuery({
            abilities: ownUnitTags.map(tag => ({
                unitTag: tag,
            })),
        }).then((res) => {
            res.abilities!.forEach((abilObj) => {
                const unit = units._units[Alliance.SELF].get(abilObj.unitTag!)!;
                unit._availableAbilities = abilObj.abilities!.map(a => a.abilityId!);
                units._units[Alliance.SELF].set(abilObj.unitTag!, unit);
            });
        });
    },
};

export default () => createSystem(unitSystem);
