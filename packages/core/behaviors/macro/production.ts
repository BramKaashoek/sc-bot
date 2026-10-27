import { Race } from '../../constants/enums.ts';
import { trainedFrom } from '../../constants/dicts/trained-from.ts';
import { unitAlias } from '../../constants/dicts/unit-alias.ts';
import { GATEWAY, WARPGATE } from '../../constants/unit-type.ts';
import { distance } from '../../utils/geometry/point.ts';
import { notStarted, ownUnitCount } from './helpers.ts';
import { buildStructure } from './structures.ts';
import { techUp } from './tech.ts';
import type { ArmyComposition, Behavior, BehaviorContext, Point2D } from '../../types.ts';

type ProductionOptions = {
    composition: ArmyComposition;
    base: Point2D;
    addProductionAtBank?: [number, number];
    alpha?: number;
    unitPendingProgress?: number;
    maxProductionStructures?: number;
};

const FLYING_RANGE = 19;

export function productionController({
    composition,
    base,
    addProductionAtBank = [400, 400],
    alpha = 0.9,
    unitPendingProgress = 0.75,
    maxProductionStructures = 12,
}: ProductionOptions): Behavior {
    const entries = Object.entries(composition)
        .map(([unitType, info]) => ({ unitType: Number(unitType), ...info! }))
        .sort((a, b) => a.priority - b.priority);

    const flyingNearby = ({ world }: BehaviorContext, producers: number[]) => {
        const { flying, units } = world.resources.get();
        return flying.getPlans().some(({ tag }) => {
            const unit = units.getByTag(tag);
            return !!unit && producers.includes(unitAlias[unit.unitType]) && distance(unit.pos, base) < FLYING_RANGE;
        });
    };

    const canAlreadyProduce = ({ world }: BehaviorContext, producers: number[]) => {
        const structures = world.resources.get().units.getById(producers);
        if (structures.some((s) => s.unitType === WARPGATE && s.buildProgress! < 1)) return true;
        return structures.some(
            (s) =>
                (s.buildProgress === 1 && s.isIdle()) ||
                (s.orders?.[0]?.progress ?? 0) >= unitPendingProgress ||
                (s.buildProgress! >= 0.9 && s.buildProgress! < 1),
        );
    };

    return {
        name: 'productionController',
        async execute(ctx) {
            const { world } = ctx;
            const { agent } = world;
            if (agent.race === Race.ZERG) return false;
            const { frame, units } = world.resources.get();
            const score = frame.getScore()?.scoreDetails;
            const rateMinerals = (score?.collectionRateMinerals ?? 0) + 1;
            const rateVespene = (score?.collectionRateVespene ?? 0) + 1;
            const totalUnits = entries.reduce((sum, { unitType }) => sum + ownUnitCount(world, unitType), 0);

            for (const { unitType, proportion: target } of entries) {
                const current = ownUnitCount(world, unitType) / (totalUnits + 1e-16);
                const trainFrom = trainedFrom[unitType] ?? [];
                const producer = trainFrom.includes(WARPGATE) ? GATEWAY : trainFrom[0];
                if (producer === undefined) continue;
                const existing = units.getById(trainFrom);

                const tech = techUp({ desired: { unit: unitType }, base, ignoreExistingTechlabs: current <= target });
                if (await tech.execute(ctx)) return true;
                if (agent.techRequirementProgress(producer) < 0.95) continue;

                if (notStarted(world, producer) > 0 || existing.length >= maxProductionStructures) continue;

                const build = () =>
                    buildStructure({ structureType: producer, base, flags: ['production'] }).execute(ctx);
                const cost = agent.calculateCost(unitType);

                if ((agent.minerals ?? 0) >= addProductionAtBank[0] && (agent.vespene ?? 0) >= addProductionAtBank[1]) {
                    const affordMinerals = Math.floor((rateMinerals / (cost.minerals + 1)) * alpha * target);
                    const affordVespene = cost.vespene
                        ? Math.floor((rateVespene / (cost.vespene + 1)) * alpha * target)
                        : affordMinerals;
                    const production =
                        existing.filter((s) => s.buildProgress === 1).length + world.agent.alreadyPending(producer);
                    if (production < affordMinerals && production < affordVespene && (await build())) return true;
                }

                if (target <= 0.15 && trainFrom.some((type) => world.agent.alreadyPending(type) > 0)) continue;
                if (
                    existing.length >= Math.floor((rateMinerals + rateVespene) / ((cost.minerals + cost.vespene) * 4.5))
                ) {
                    continue;
                }
                if (agent.race === Race.TERRAN && flyingNearby(ctx, trainFrom)) continue;
                if (current * 1.2 >= target) continue;
                if (canAlreadyProduce(ctx, trainFrom)) continue;
                if (world.agent.alreadyPending(producer) >= Math.floor((rateMinerals + rateVespene) / 1000)) continue;
                if (await build()) return true;
            }
            return false;
        },
    };
}
