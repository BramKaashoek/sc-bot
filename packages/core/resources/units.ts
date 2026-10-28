import filterArr from 'lodash.filter';
import { distance } from '../utils/geometry/point.ts';
import {
    addonHost,
    combatTypes,
    constructionAbilities,
    gatheringAbilities,
    mineralFieldTypes,
    vespeneGeyserTypes,
    gasMineTypes,
    researcherEquivalents,
} from '../constants/groups.ts';
import { UnitType } from '../constants/index.ts';
import { trainedFrom } from '../constants/dicts/trained-from.ts';
import { researchedFrom } from '../constants/dicts/researched-from.ts';
import { Alliance } from '../constants/enums.ts';
import { WorkerRace } from '../constants/race-map.ts';
import { NodeSC2Error } from '../engine/errors.ts';
import { Units } from './units-collection.ts';
import type { Point2D, ResourceDefinition, Unit, UnitResource, World } from '../types.ts';

interface LoopCaches {
    previousArmy: Unit[];
    morphedEnemyTags: Set<string>;
}

const freshCaches = (): LoopCaches => ({ previousArmy: [], morphedEnemyTags: new Set() });

const cachesByUnits = new WeakMap<UnitResource, LoopCaches>();

const createdTypeByAbilityCache = new WeakMap<object, Map<number, number>>();

// data-storage's findUnitTypesWithAbility maps to producers; an order needs the unit type it creates
export function createdTypeByAbility(world: World): Map<number, number> {
    const unitData: SC2APIProtocol.UnitTypeData[] = world.data.get('units');
    let createdTypes = createdTypeByAbilityCache.get(unitData);
    if (!createdTypes) {
        createdTypes = new Map();
        for (const data of Object.values(unitData)) {
            if (data.available && data.abilityId && !createdTypes.has(data.abilityId))
                createdTypes.set(data.abilityId, data.unitId!);
        }
        createdTypeByAbilityCache.set(unitData, createdTypes);
    }
    return createdTypes;
}

export function forgetUnit(units: UnitResource, alliance: number, tag: string): void {
    units._units[alliance].delete(tag);
}

export function storeUnit(units: UnitResource, alliance: number, tag: string, unit: Unit): void {
    units._units[alliance].set(tag, unit);
}

export function beginUnitLoop(units: UnitResource, previousLoop: number | undefined): void {
    const caches = cachesByUnits.get(units)!;
    // update() Object.assigns onto the stored unit; orders/pos are replaced, never mutated, so only labels needs its own copy
    caches.previousArmy = [...units._units[Alliance.SELF].values()]
        .filter((unit) => unit.lastSeen === previousLoop && unit.isCombatUnit())
        .map((unit) => ({ ...unit, labels: new Map(unit.labels) }));
    caches.morphedEnemyTags.clear();
}

export function markEnemyMorphed(units: UnitResource, tag: string): void {
    cachesByUnits.get(units)!.morphedEnemyTags.add(tag);
}

export function setAvailableAbilities(unit: Unit, abilityIds: number[], loop: number | undefined): void {
    unit._availableAbilities = abilityIds;
    unit._availableAbilitiesLoop = loop;
}

function createUnits(world: World): UnitResource {
    const units: UnitResource = {
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
        getPreviousArmy() {
            return Units.from(cachesByUnits.get(this)!.previousArmy);
        },
        getMorphedEnemyTags() {
            return cachesByUnits.get(this)!.morphedEnemyTags;
        },
        getLarva() {
            return this.getAlive(Alliance.SELF).filter((unit) => unit.unitType === UnitType.LARVA);
        },
        getStructures(filter = { alliance: Alliance.SELF }) {
            return this.getAlive(filter).filter((unit) => unit.isStructure());
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
            return this.getById(addonHost[unitTypeId] ?? trainedFrom[unitTypeId] ?? []);
        },
        getUpgradeFacilities(upgradeId) {
            const researcher = researchedFrom[upgradeId];
            return this.getById(researcherEquivalents[researcher] ?? researcher ?? []);
        },
        getArmyValue(alliance = Alliance.SELF, { includePending = false, includeGhosts = true } = {}) {
            if (alliance !== Alliance.SELF && alliance !== Alliance.ENEMY)
                throw new NodeSC2Error(`getArmyValue supports SELF or ENEMY, got alliance ${alliance}`);

            const unitData: SC2APIProtocol.UnitTypeData[] = world.data.get('units');
            const army =
                alliance === Alliance.ENEMY
                    ? world.resources.get().memory.getEnemies({ includeGhosts })
                    : this.getAlive(Alliance.SELF);
            let value = army
                .filter((unit) => unit.isCombatUnit())
                // calculateCost is the net morph cost; a morphed unit is worth its full cost (ares parity)
                .reduce((total, unit) => {
                    const { mineralCost = 0, vespeneCost = 0 } = unitData[unit.unitType!] ?? {};
                    return total + mineralCost + vespeneCost;
                }, 0);

            if (alliance === Alliance.SELF && includePending) {
                const createdTypes = createdTypeByAbility(world);
                const pendingOrders = this.getAlive(Alliance.SELF).flatMap((unit) => {
                    if (unit.unitType === UnitType.EGG) return unit.orders!.slice(0, 1);
                    if (!unit.isStructure() || !unit.isFinished() || unit.isTownhall()) return [];
                    return unit.orders!.slice(0, unit.hasReactor() ? 2 : 1);
                });
                value += pendingOrders
                    .map((order) => createdTypes.get(order.abilityId!))
                    .filter((unitType): unitType is number => unitType !== undefined && combatTypes.includes(unitType))
                    .reduce((total, unitType) => {
                        const { minerals, vespene } = world.agent.calculateCost(unitType);
                        return total + minerals + vespene;
                    }, 0);
            }

            return value;
        },
    };
    cachesByUnits.set(units, freshCaches());
    return units;
}

export const unitsResource: ResourceDefinition<'units'> = {
    name: 'units',
    create: (world) => createUnits(world),
    reset: (units) => {
        Object.values(units._units).forEach((store) => store.clear());
        cachesByUnits.set(units, freshCaches());
    },
};
