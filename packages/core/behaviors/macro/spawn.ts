import { REQUIRES_TECHLAB } from '../../utils/economy.ts';
import { Race } from '../../constants/enums.ts';
import { reactorTypes, techLabTypes } from '../../constants/groups.ts';
import { WorkerRace } from '../../constants/race-map.ts';
import { GATEWAY, NEXUS } from '../../constants/unit-type.ts';
import { WARPGATERESEARCH } from '../../constants/upgrade.ts';
import { trainedFrom } from '../../constants/dicts/trained-from.ts';
import { NodeSC2Error } from '../../engine/errors.ts';
import { ownUnitCount } from './helpers.ts';
import type { ArmyComposition, Behavior, Point2D } from '../../types.ts';

type SpawnOptions = {
    composition: ArmyComposition;
    freeflow?: boolean;
    ignoreProportionsBelowUnitCount?: number;
    overProduceOnLowTech?: boolean;
    maximum?: number;
    spawnTarget?: Point2D;
};

type CompositionEntry = [string, { proportion: number; priority: number }];

function validate(entries: CompositionEntry[]) {
    entries.forEach(([unitType, { priority }]) => {
        if (!Number.isInteger(priority) || priority < 0 || priority > 10) {
            throw new NodeSC2Error(`Priority for unit type ${unitType} must be an integer 0-10, got ${priority}`);
        }
    });
    const sum = entries.reduce((total, [, { proportion }]) => total + proportion, 0);
    if (Math.abs(sum - 1) > 1e-6) throw new NodeSC2Error(`Army composition proportions must sum to 1, got ${sum}`);
}

export function spawnController({
    composition,
    freeflow = false,
    ignoreProportionsBelowUnitCount = 0,
    overProduceOnLowTech = true,
    maximum = 20,
    spawnTarget,
}: SpawnOptions): Behavior {
    const entries = Object.entries(composition) as CompositionEntry[];
    if (!freeflow) validate(entries);
    const types = entries
        .map(([unitType, info]) => ({ unitType: Number(unitType), ...info }))
        .sort((a, b) => a.priority - b.priority);

    return {
        name: 'spawnController',
        async execute(ctx) {
            const { agent } = ctx.world;
            const { units } = ctx.world.resources.get();
            if (
                agent.upgradeIds?.includes(WARPGATERESEARCH) &&
                units.getById(GATEWAY).some((gateway) => gateway.buildProgress === 1 && gateway.isIdle())
            ) {
                return false;
            }
            const counts = new Map(types.map(({ unitType }) => [unitType, ownUnitCount(ctx.world, unitType)]));
            const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
            const ignoreProportions = freeflow || total < ignoreProportionsBelowUnitCount;
            const amountFor = (unitType: number, limit: number) => {
                let count = limit;
                while (count > 0 && !agent.canAfford(unitType, { count, supply: true })) count -= 1;
                return count;
            };

            const hasIdleProducer = (unitType: number) =>
                units.getById(trainedFrom[unitType]).some((producer) => {
                    const addon = producer.addOnTag ? units.getByTag(producer.addOnTag) : undefined;
                    const finishedAddon = addon?.buildProgress === 1 ? addon : undefined;
                    const slots =
                        1 + Number(finishedAddon !== undefined && reactorTypes.includes(finishedAddon.unitType!));
                    const hasTechlab = finishedAddon !== undefined && techLabTypes.includes(finishedAddon.unitType!);
                    const powered =
                        agent.race !== Race.PROTOSS || producer.unitType === NEXUS || Boolean(producer.isPowered);
                    return (
                        producer.buildProgress === 1 &&
                        powered &&
                        (producer.orders ?? []).length < slots &&
                        (hasTechlab || !REQUIRES_TECHLAB.includes(unitType))
                    );
                });

            const techReady: number[] = [];
            const readyToBuild: number[] = [];
            const trainedOf = new Map<number, number>();
            let trained = 0;
            for (const { unitType, proportion } of types) {
                if (agent.techRequirementProgress(unitType) < 1) continue;
                techReady.push(unitType);
                if (!trainedFrom[unitType]?.length || !hasIdleProducer(unitType)) continue;

                if (!agent.canAfford(unitType)) {
                    if (ignoreProportions) continue;
                    break;
                }
                readyToBuild.push(unitType);

                if (!ignoreProportions && counts.get(unitType)! / (total + 1e-16) > proportion) continue;

                const amount = amountFor(unitType, maximum);
                if (amount <= 0) continue;
                const done = await agent.train(unitType, { count: amount, near: spawnTarget });
                trainedOf.set(unitType, done);
                trained += done;
            }

            if (techReady.length === 1 && overProduceOnLowTech && readyToBuild.length > 0 && maximum > 1) {
                const [unitType] = readyToBuild;
                const amount = amountFor(unitType, Math.max(maximum - (trainedOf.get(unitType) ?? 0), 0));
                if (amount > 0) trained += await agent.train(unitType, { count: amount, near: spawnTarget });
            }

            return trained > 0;
        },
    };
}

export function buildWorkers({ toCount }: { toCount: number }): Behavior {
    return {
        name: 'buildWorkers',
        execute(ctx) {
            const { agent } = ctx.world;
            const workerType = WorkerRace[agent.race as number];
            const missing = toCount - agent.supplyWorkers;
            if (!workerType || missing <= 0 || !agent.canAfford(workerType)) return false;
            return spawnController({
                composition: { [workerType]: { proportion: 1, priority: 0 } },
                maximum: missing,
            }).execute(ctx);
        },
    };
}
