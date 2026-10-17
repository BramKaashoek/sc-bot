import filterArr from 'lodash.filter';
import { distance } from '../utils/geometry/point.ts';
import {
    constructionAbilities,
    gatheringAbilities,
    mineralFieldTypes,
    vespeneGeyserTypes,
    gasMineTypes,
} from '../constants/groups.ts';
import { Alliance, Attribute } from '../constants/enums.ts';
import { WorkerRace } from '../constants/race-map.ts';
import type { Point2D, Unit, UnitResource, World } from '../types.ts';

function createUnits(world: World): UnitResource & { getIdle(): Unit[] } {
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
                const mapping: [string, Unit] = [unit.tag!, JSON.parse(JSON.stringify(unit))];
                return mapping;
            });

            // const cloneOfEntries = currentEntries.map(([tag, unit]) => [tag, { ...unit }]);
            return new Map(cloneOfEntries);
        },
        withCurrentOrders(abilityId) {
            return this.getAlive(Alliance.SELF)
                .filter(u => u.orders!
                    .some(o => o.abilityId! === abilityId)
                );
        },
        // TODO(ts): overloads can't be satisfied by one implementation; PowerSource has no `pos` (runtime reads it anyway)
        getClosest: ((pos: Point2D, units: Unit[], n = 1) => {
            return units.map(unit => ({ unit, distance: distance(pos, unit.pos!) }))
                .sort((a, b) => a.distance - b.distance)
                .map(u => u.unit)
                .slice(0, n);
        }) as UnitResource['getClosest'],
        getMineralFields(filter) {
            return this.getAlive(filter)
                .filter(unit => mineralFieldTypes.includes(unit.unitType!));
        },
        getGasGeysers(filter) {
            return this.getAlive(filter)
                .filter(unit => vespeneGeyserTypes.includes(unit.unitType!));
        },
        getGasMines(filter = Alliance.SELF) {
            return this.getAlive(filter)
                .filter(unit => gasMineTypes.includes(unit.unitType!));
        },
        getStructures(filter = { alliance: Alliance.SELF }) {
            return this.getAlive(filter)
                .filter((unit) => {
                    return world.data.getUnitTypeData(unit.unitType!).attributes!.includes(Attribute.STRUCTURE);
                });
        },
        inProgress(unitTypeId) {
            return this.getAlive(Alliance.SELF)
                .filter(u => u.buildProgress! < 1)
                .filter(u => u.unitType! === unitTypeId);
        },
        getUnfinished(filter) {
            return this.getAlive(filter).filter(u => u.buildProgress! < 1);
        },
        getBases(filter = { alliance: Alliance.SELF }) {
            return this.getAlive(filter).filter(u => u.isTownhall());
        },
        getAll(filter) {
            if (typeof filter === 'object') {
                let theUnits;
                
                if (filter.alliance) {
                    theUnits = Array.from(this._units[filter.alliance].values());
                } else {
                    theUnits = this.getAll();
                }

                return filterArr(theUnits, filter);
            } else if (typeof filter === 'function') {
                return this.getAll().filter(filter);
            } else if (typeof filter === 'number') {
                return Array.from(this._units[filter].values());
            } else {
                return [
                    ...Array.from(this._units[Alliance.SELF].values()),
                    ...Array.from(this._units[Alliance.ENEMY].values()),
                    ...Array.from(this._units[Alliance.NEUTRAL].values()),
                ];
            }
        },
        getAlive(filter) {
            return this.getAll(filter).filter(u => u.isCurrent());
        },
        getById(unitTypeIds, filter = { alliance: Alliance.SELF }) {
            const typeIds = Array.isArray(unitTypeIds) ? unitTypeIds : [unitTypeIds];

            return this.getAlive(filter).filter(u => typeIds.includes(u.unitType!));
        },
        // @ts-ignore overloads are hard apparently
        getByTag(unitTags) {
            const getUnitByTag = (tag: string) => this._units[Alliance.SELF].get(tag) || this._units[Alliance.NEUTRAL].get(tag) || this._units[Alliance.ENEMY].get(tag) || tag;

            if (Array.isArray(unitTags)) {
                return unitTags.map(unitTag => getUnitByTag(unitTag));
            } else {
                return getUnitByTag(unitTags);
            }
        },
        getCombatUnits(filter = Alliance.SELF) {
            return this.getAlive(filter)
                .filter(u => u.isCombatUnit());
        },
        getRangedCombatUnits() {
            return this.getCombatUnits()
                .filter(u => world.data.getUnitTypeData(u.unitType!).weapons!.some(w => w.range! > 1));
        },
        getWorkers(includeBusy = false) {
            const { agent } = world;

            const workers = this.getAlive(Alliance.SELF)
                .filter(u => u.unitType! === WorkerRace[agent.race!]);

            if (includeBusy) {
                return workers;
            } else {
                return workers.filter(u => !u.labels.has('command'));
            }
        },
        getIdle() {
            return this.getAlive(Alliance.SELF).filter(u => u.noQueue);
        },
        getIdleWorkers() {
            return this.getWorkers().filter(w => w.noQueue);
        },
        getMineralWorkers() {
            return this.getWorkers()
                .filter(u => u.orders!.length === 1 && gatheringAbilities.includes(u.orders![0].abilityId!))
                .filter(u => [...u.labels.keys()].length <= 0);
        },
        getConstructingWorkers() {
            return this.getWorkers(true)
                .filter(u => u.orders!.some(o => constructionAbilities.includes(o.abilityId!)));
        },
        withLabel(component) {
            return this.getAlive().filter(u => u.labels.has(component));
        },
        getByType(unitIds) {
            const unitTypeIds = Array.isArray(unitIds) ? unitIds : [unitIds];

            return this.getAlive().filter((unit) => {
                // find units whose unitType match any of the given unitTypes.. and isn't dead
                return unitTypeIds.includes(unit.unitType!);
            });
        },
        getProductionUnits(unitTypeId) {
            // get the ability needed to produce the unit
            const abilityId = world.data.getUnitTypeData(unitTypeId).abilityId!;
            
            // find the unitTypeId(s) of the unit(s) that produce(s) it
            let producerUnitTypeIds = world.data.findUnitTypesWithAbility(abilityId);

            // if it's bogus, check what ability it remaps to
            if (producerUnitTypeIds.length <= 0) {
                const alias = world.data.getAbilityData(abilityId).remapsToAbilityId!;
                producerUnitTypeIds = world.data.findUnitTypesWithAbility(alias);
            }

            // get all units with those unitTypes
            return this.getByType(producerUnitTypeIds);
        },
        getUpgradeFacilities(upgradeId) {
            // get the ability needed to produce the upgrade
            const abilityId = world.data.getUpgradeData(upgradeId).abilityId!;
            const remapsToAbilityId = world.data.getAbilityData(abilityId).remapsToAbilityId!;

            // find the unitTypeId(s) of the unit(s) that upgrade(s) it - or the remapped one
            const upgraderUnitTypeIds = [
                ...world.data.findUnitTypesWithAbility(abilityId),
                ...world.data.findUnitTypesWithAbility(remapsToAbilityId),
            ];

            // get all units with those unitTypes
            return this.getByType(upgraderUnitTypeIds);
        },
    };
}

export default createUnits;