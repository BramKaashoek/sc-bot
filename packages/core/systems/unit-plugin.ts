import type { EventReader, System, Unit, UnitSystemObject, World } from '../types.ts';

const NOOP = () => {};

export default function unitPlugin(system: EventReader<System>) {
    const unitSystem = system as unknown as UnitSystemObject;
    const unitsFilter: number[] = Array.isArray(system.units) ? system.units : [system.units];
    const labelsFilter: string[] = Array.isArray(system.labels) ? system.labels : [system.labels];

    const systemOnStep = unitSystem.onStep ? unitSystem.onStep.bind(system) : NOOP;
    const systemOnNewUnit = unitSystem.onNewUnit ? unitSystem.onNewUnit.bind(system) : NOOP;
    const systemOnUnitIdle = unitSystem.onUnitIdle ? unitSystem.onUnitIdle.bind(system) : NOOP;
    const systemOnUnitDestroyed = unitSystem.onUnitDestroyed ? unitSystem.onUnitDestroyed.bind(system) : NOOP;

    function unitHasLabels(unit: Unit) {
        return labelsFilter.some((label) => unit.hasLabel(label));
    }

    system.onStep = async function (world: World) {
        const { units } = world.resources.get();
        const labeledUnits = labelsFilter.reduce(
            (sysLabels, label) => {
                sysLabels[label] = units.withLabel(label).filter((u) => u.isFinished());
                return sysLabels;
            },
            {} as Record<string, Unit[]>,
        );

        const systemUnits = unitsFilter.reduce(
            (sysUnits, unitType) => {
                sysUnits[unitType] = units
                    .getById(unitType)
                    .filter((u) => u.isFinished())
                    .filter((systemUnit) => {
                        const unitTag = systemUnit.tag;
                        const labeledTags = Object.values(labeledUnits)
                            .reduce((pool, arr) => pool.concat(arr), [])
                            .map((lu) => lu.tag);
                        return !labeledTags.includes(unitTag);
                    });
                return sysUnits;
            },
            {} as Record<number, Unit[]>,
        );

        const all = [...Object.values(systemUnits), ...Object.values(labeledUnits)].reduce(
            (units, unit) => units.concat(unit),
            [] as Unit[],
        );

        const data = { all, unlabeled: systemUnits, labeled: labeledUnits };
        return systemOnStep(world, data);
    };

    function reflect(target: Function, ...args: any[]) {
        return Reflect.apply(target, system, args);
    }

    const onIdleFunctions = system.idleFunctions || {};

    system.onUnitIdle = async function (world: World, unit: Unit) {
        const foundLabelFn = labelsFilter.find((label) => {
            if (unit.hasLabel(label)) {
                return !!onIdleFunctions[label];
            }
        });

        if (foundLabelFn) {
            return reflect(onIdleFunctions[foundLabelFn], world, unit);
        } else if (!unit.hasNoLabels() && onIdleFunctions.labeled) {
            return reflect(onIdleFunctions.labeled, world, unit, [...unit.labels.keys()][0]);
        } else if (onIdleFunctions[unit.unitType!]) {
            return reflect(onIdleFunctions[unit.unitType!], world, unit);
        } else {
            return systemOnUnitIdle(world, unit);
        }
    };

    system.onUnitCreated = async function (world: World, unit: Unit) {
        if (unitsFilter.includes(unit.unitType!) || unitHasLabels(unit)) {
            return systemOnNewUnit(world, unit);
        }
    };

    system.onUnitFinished = async function (world: World, unit: Unit) {
        if (unitsFilter.includes(unit.unitType!) || unitHasLabels(unit)) {
            return systemOnNewUnit(world, unit);
        }
    };

    system.onUnitDestroyed = async function (world: World, unit: Unit) {
        if (unitsFilter.includes(unit.unitType!) || unitHasLabels(unit)) {
            return systemOnUnitDestroyed(world, unit);
        }
    };
}
