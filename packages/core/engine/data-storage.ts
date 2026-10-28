'use strict';

import createDebug from 'debug';
import { AbilitiesByUnit } from '../constants/index.ts';
import { unitAbilities } from '../constants/dicts/unit-abilities.ts';
import type { Cost, DataStorage, Earmark, StorageBlueprint } from '../types.ts';

const debugEarmark = createDebug('sc2:debug:earmark');

export const generalAbility = (data: DataStorage, abilityId: number): number =>
    data.getAbilityData(abilityId)?.remapsToAbilityId || abilityId;

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
            const abilityData: Record<number, SC2APIProtocol.AbilityData> | null = this.get('abilities');
            const generated = Object.entries(unitAbilities).filter(([, abilities]) =>
                abilities.some(
                    (ability) => ability === abilityId || abilityData?.[ability]?.remapsToAbilityId === abilityId,
                ),
            );
            // the hand-captured map covers abilities the fixtures never recorded; only trust it where the game data says available, or before that data loads
            const stale =
                !abilityData || abilityData[abilityId]?.available
                    ? Object.entries(AbilitiesByUnit).filter(([, abilities]) => abilities.includes(abilityId))
                    : [];
            return [...new Set([...generated, ...stale].map(([unitType]) => parseInt(unitType, 10)))].sort(
                (a, b) => a - b,
            );
        },
        getUnitTypeData(unitTypeId) {
            return this.get('units')[unitTypeId];
        },
        getUpgradeData(upgradeId) {
            return this.get('upgrades')[upgradeId];
        },
        getAbilityData(abilityId) {
            return this.get('abilities')?.[abilityId];
        },
        getEffectData(effectId) {
            return this.get('effects')[effectId];
        },
        mineralCost(unitTypeId) {
            return this.getUnitTypeData(unitTypeId).mineralCost!;
        },
        addEarmark(earmark) {
            const earmarks: Earmark[] = this.get('earmarks');

            const existing = earmarks.find((em: Earmark) => em.name === earmark.name);

            if (existing && existing.minerals === earmark.minerals && existing.vespene === earmark.vespene) {
                return earmarks;
            }
            debugEarmark(existing ? 'Replaced earmark:' : 'New earmark:', earmark);
            return this.set('earmarks', [...earmarks.filter((em: Earmark) => em.name !== earmark.name), earmark]);
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
