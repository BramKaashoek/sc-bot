'use strict';

import createDebug from 'debug';
import { Race, Attribute } from '../constants/enums.ts';
import { AbilitiesByUnit } from '../constants/index.ts';
import type { Cost, DataStorage, Earmark, StorageBlueprint } from '../types.ts';

const debugEarmark = createDebug('sc2:debug:earmark');

function createDataManager(): DataStorage {
    const data = new Map<string, any>([
        ['earmarks', []],
        ['abilities', null],
        ['units', null],
        ['upgrades', null],
        ['buffs', null],
        ['effects', null],
    ]);

    const StorageBlueprint: StorageBlueprint & ThisType<DataStorage> = {
        register(name, fn) {
            (this as unknown as Record<string, unknown>)[name] = fn;
        },
        findUnitTypesWithAbility(abilityId) {
            return Object.entries(AbilitiesByUnit)
                .filter(([ignored, abilities]) => {
                    return abilities.some((ability) => ability === abilityId);
                })
                .map((unitAbility) => parseInt(unitAbility[0], 10));
        },
        getUnitTypeData(unitTypeId) {
            const unitData: SC2APIProtocol.UnitTypeData = this.get('units')[unitTypeId];

            if (unitData.race === Race.ZERG && unitData.attributes!.includes(Attribute.STRUCTURE)) {
                return {
                    ...unitData,
                    mineralCost: unitData.mineralCost! - 50,
                };
            } else {
                return unitData;
            }
        },
        getUpgradeData(upgradeId) {
            return this.get('upgrades')[upgradeId];
        },
        getAbilityData(abilityId) {
            return this.get('abilities')[abilityId];
        },
        getEffectData(effectId) {
            return this.get('effects')[effectId];
        },
        mineralCost(unitTypeId) {
            return this.getUnitTypeData(unitTypeId).mineralCost!;
        },
        addEarmark(earmark) {
            const earmarks: Earmark[] = this.get('earmarks');

            const exists = earmarks.find((em: Earmark) => em.name === earmark.name);

            if (exists) {
                return earmarks;
            } else {
                debugEarmark('New earmark:', earmark);
                return this.set('earmarks', [...earmarks, earmark]);
            }
        },
        getEarmarkTotals(earmarkName) {
            return this.get('earmarks')
                .filter((em: Earmark) => em.name !== earmarkName)
                .reduce(
                    (totals: Cost, em: Earmark) => {
                        return { minerals: totals.minerals + em.minerals, vespene: totals.vespene + em.vespene };
                    },
                    { minerals: 0, vespene: 0 },
                );
        },
        settleEarmark(earmarkName) {
            const newEarmarks = this.get('earmarks').filter((em: Earmark) => em.name !== earmarkName);

            this.set('earmarks', newEarmarks);
            return this.get('earmarks');
        },
    };

    const dataMap: DataStorage = Object.assign(data, StorageBlueprint);

    return dataMap;
}

export default createDataManager;
