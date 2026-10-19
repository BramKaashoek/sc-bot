import filterArr from 'lodash.filter';
import { distance } from '../utils/geometry/point.ts';
import {
    constructionAbilities,
    gatheringAbilities,
    mineralFieldTypes,
    vespeneGeyserTypes,
    gasMineTypes,
} from '../constants/groups.ts';
import { UnitType } from '../constants/index.ts';
import { Alliance, Attribute } from '../constants/enums.ts';
import { WorkerRace } from '../constants/race-map.ts';
import { Units } from './units-collection.ts';
import type { Point2D, Unit, UnitResource, World } from '../types.ts';

function getClosest(pos: Point2D, units: Unit[], n?: number): Units;
function getClosest(pos: Point2D, units: SC2APIProtocol.PowerSource[], n?: number): SC2APIProtocol.PowerSource[];
function getClosest(
    pos: Point2D,
    units: Unit[] | SC2APIProtocol.PowerSource[],
    n = 1,
): Units | SC2APIProtocol.PowerSource[] {
    const closest = Array.from(units, (unit: Unit | SC2APIProtocol.PowerSource) => ({
        unit,
        distance: distance(pos, { x: unit.pos!.x!, y: unit.pos!.y! }),
    }))
        .sort((a, b) => a.distance - b.distance)
        .map((entry) => entry.unit)
        .slice(0, n);
    return Units.from(closest as Unit[]);
}

function createUnits(world: World): UnitResource {
    return {
        _units: {
            [Alliance.SELF]: new Map(),
            [Alliance.ALLY]: new Map(),
            [Alliance.ENEMY]: new Map(),
            [Alliance.NEUTRAL]: new Map(),
        },
        // @TODO: figure out if this is needed at all, ever, for anything
        clone() {
            const currentValues = [
                ...Array.from(this._units[Alliance.SELF].values()),
                ...Array.from(this._units[Alliance.ENEMY].values()),
                ...Array.from(this._units[Alliance.NEUTRAL].values()),
            ];

            const cloneOfEntries = currentValues.map((unit) => {
                /*  @FIXME: FIX THIS NONSENSE IMMEDIATELY, if we ever move unit
                 *  datainto labels this terrible junk will no longer be needed */
                const { labels, ...data } = unit;
                const copy: Unit = { ...JSON.parse(JSON.stringify(data)), labels: new Map(labels) };
                const mapping: [string, Unit] = [unit.tag!, copy];
                return mapping;
            });

            return new Map(cloneOfEntries);
        },
        withCurrentOrders(abilityId) {
            return this.getAlive(Alliance.SELF).filter((u) => u.orders!.some((o) => o.abilityId! === abilityId));
        },
        getClosest,
        getMineralFields(filter) {
            return this.getAlive(filter).filter((unit) => mineralFieldTypes.includes(unit.unitType!));
        },
        getGasGeysers(filter) {
            return this.getAlive(filter).filter((unit) => vespeneGeyserTypes.includes(unit.unitType!));
        },
        getGasMines(filter = Alliance.SELF) {
            return this.getAlive(filter).filter((unit) => gasMineTypes.includes(unit.unitType!));
        },
        getEnemyUnits() {
            return this.getAlive(Alliance.ENEMY).filter((unit) => !unit.isStructure());
        },
        getEnemyStructures() {
            return this.getAlive(Alliance.ENEMY).filter((unit) => unit.isStructure());
        },
        getDestructables() {
            return this.getAlive(Alliance.NEUTRAL).filter(
                (unit) =>
                    unit.unitType !== UnitType.XELNAGATOWER &&
                    !mineralFieldTypes.includes(unit.unitType) &&
                    !vespeneGeyserTypes.includes(unit.unitType),
            );
        },
        getWatchtowers() {
            return this.getAlive(Alliance.NEUTRAL).filter((unit) => unit.unitType === UnitType.XELNAGATOWER);
        },
        getLarva() {
            return this.getAlive(Alliance.SELF).filter((unit) => unit.unitType === UnitType.LARVA);
        },
        getStructures(filter = { alliance: Alliance.SELF }) {
            return this.getAlive(filter).filter((unit) => {
                return world.data.getUnitTypeData(unit.unitType!).attributes!.includes(Attribute.STRUCTURE);
            });
        },
        inProgress(unitTypeId) {
            return this.getAlive(Alliance.SELF)
                .filter((u) => u.buildProgress! < 1)
                .filter((u) => u.unitType! === unitTypeId);
        },
        getUnfinished(filter) {
            return this.getAlive(filter).filter((u) => u.buildProgress! < 1);
        },
        getBases(filter = { alliance: Alliance.SELF }) {
            return this.getAlive(filter).filter((u) => u.isTownhall());
        },
        getAll(filter) {
            if (typeof filter === 'object') {
                let theUnits;

                if (filter.alliance) {
                    theUnits = Array.from(this._units[filter.alliance].values());
                } else {
                    theUnits = this.getAll();
                }

                return Units.from(filterArr(theUnits, filter));
            } else if (typeof filter === 'function') {
                return Units.from(this.getAll().filter(filter));
            } else if (typeof filter === 'number') {
                return Units.from(this._units[filter].values());
            } else {
                return Units.from([
                    ...Array.from(this._units[Alliance.SELF].values()),
                    ...Array.from(this._units[Alliance.ENEMY].values()),
                    ...Array.from(this._units[Alliance.NEUTRAL].values()),
                ]);
            }
        },
        getAlive(filter) {
            return this.getAll(filter).filter((u) => u.isCurrent());
        },
        getById(unitTypeIds, filter = { alliance: Alliance.SELF }) {
            const typeIds = Array.isArray(unitTypeIds) ? unitTypeIds : [unitTypeIds];

            return this.getAlive(filter).filter((u) => typeIds.includes(u.unitType!));
        },
        // @ts-ignore overloads are hard apparently
        getByTag(unitTags) {
            const getUnitByTag = (tag: string) =>
                this._units[Alliance.SELF].get(tag) ||
                this._units[Alliance.NEUTRAL].get(tag) ||
                this._units[Alliance.ENEMY].get(tag);

            if (Array.isArray(unitTags)) {
                return Units.from(
                    unitTags.map((unitTag) => getUnitByTag(unitTag)).filter((unit) => unit !== undefined),
                );
            } else {
                return getUnitByTag(unitTags);
            }
        },
        getCombatUnits(filter = Alliance.SELF) {
            return this.getAlive(filter).filter((u) => u.isCombatUnit());
        },
        getRangedCombatUnits() {
            return this.getCombatUnits().filter((u) =>
                world.data.getUnitTypeData(u.unitType!).weapons!.some((w) => w.range! > 1),
            );
        },
        getWorkers(includeBusy = false) {
            const { agent } = world;

            const workers = this.getAlive(Alliance.SELF).filter((u) => u.unitType! === WorkerRace[agent.race!]);

            if (includeBusy) {
                return workers;
            } else {
                return workers.filter((u) => !u.labels.has('command'));
            }
        },
        getIdle() {
            return this.getAlive(Alliance.SELF).filter((u) => u.noQueue);
        },
        getIdleWorkers() {
            return this.getWorkers().filter((w) => w.noQueue);
        },
        getMineralWorkers() {
            return this.getWorkers()
                .filter((u) => u.orders!.length === 1 && gatheringAbilities.includes(u.orders![0].abilityId!))
                .filter((u) => [...u.labels.keys()].length <= 0);
        },
        getConstructingWorkers() {
            return this.getWorkers(true).filter((u) =>
                u.orders!.some((o) => constructionAbilities.includes(o.abilityId!)),
            );
        },
        getPendingAt(unitTypeIds, pos, maxDistance = 1) {
            const typeIds = Array.isArray(unitTypeIds) ? unitTypeIds : [unitTypeIds];
            const abilityIds = typeIds.map((typeId) => world.data.getUnitTypeData(typeId).abilityId);
            const isNear = (point: Point2D) => distance(point, pos) < maxDistance;

            const ordered = this.getConstructingWorkers().filter((worker) =>
                worker.orders!.some(
                    (order) =>
                        abilityIds.includes(order.abilityId) &&
                        order.targetWorldSpacePos !== undefined &&
                        isNear(order.targetWorldSpacePos as Point2D),
                ),
            );
            return this.getById(typeIds)
                .filter((unit) => unit.buildProgress! < 1 && isNear(unit.pos))
                .concat(ordered);
        },
        withLabel(component) {
            return this.getAlive().filter((u) => u.labels.has(component));
        },
        getByType(unitIds) {
            const unitTypeIds = Array.isArray(unitIds) ? unitIds : [unitIds];

            return this.getAlive().filter((unit) => {
                return unitTypeIds.includes(unit.unitType!);
            });
        },
        getProductionUnits(unitTypeId) {
            const abilityId = world.data.getUnitTypeData(unitTypeId).abilityId!;
            let producerUnitTypeIds = world.data.findUnitTypesWithAbility(abilityId);

            if (producerUnitTypeIds.length <= 0) {
                const alias = world.data.getAbilityData(abilityId).remapsToAbilityId!;
                producerUnitTypeIds = world.data.findUnitTypesWithAbility(alias);
            }

            return this.getById(producerUnitTypeIds);
        },
        getUpgradeFacilities(upgradeId) {
            const abilityId = world.data.getUpgradeData(upgradeId).abilityId!;
            const remapsToAbilityId = world.data.getAbilityData(abilityId).remapsToAbilityId!;

            const upgraderUnitTypeIds = [
                ...world.data.findUnitTypesWithAbility(abilityId),
                ...world.data.findUnitTypesWithAbility(remapsToAbilityId),
            ];

            return this.getById(upgraderUnitTypeIds);
        },
    };
}

export default createUnits;
