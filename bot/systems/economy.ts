import { type Agent, createSystem, type ResourceManager } from '@sc-bot/core';
import { BUILD_SUPPLYDEPOT } from '@sc-bot/core/constants/ability';
import { SCV, SUPPLYDEPOT } from '@sc-bot/core/constants/unit-type';
import { buildAnchor } from './anchor.ts';

export default createSystem({
    name: 'Economy',
    async onUnitCreated({ resources }, unit) {
        if (unit.isWorker()) {
            return resources.get().actions.gather(unit, undefined, { queue: true });
        }
    },
    async onUnitFinished({ resources }, building) {
        if (building.isGasMine()) {
            const { units, actions } = resources.get();
            const workers = units.getMineralWorkers().closestNUnits(building.pos, 3);
            return actions.mine(workers, building, { queue: true });
        }
    },
    async onUnitIdle({ resources }, unit) {
        if (unit.isWorker()) {
            return resources.get().actions.gather(unit, undefined, { queue: true });
        }
    },
    async onStep({ agent, resources }) {
        await supplyDepot(agent, resources);
        await svc(agent, resources);
    },
});

const supplyDepot = async (agent: Agent, resources: ResourceManager) => {
    const { units, actions, map } = resources.get();

    const supplyLeft = (agent.foodCap ?? 0) - (agent.foodUsed ?? 0);
    const depotPending =
        units.getById(SUPPLYDEPOT).some((depot) => depot.buildProgress! < 1) ||
        units.getWorkers(true).some((worker) => worker.orders?.some((order) => order.abilityId === BUILD_SUPPLYDEPOT));

    if (supplyLeft < 6 && (agent.foodCap ?? 0) < 200 && !depotPending && agent.canAfford(SUPPLYDEPOT)) {
        const position = await actions.findPlacement(SUPPLYDEPOT, buildAnchor(map, 6));
        if (position && agent.canAfford(SUPPLYDEPOT)) await actions.build(SUPPLYDEPOT, position);
    }
};

const svc = async (agent: Agent, resources: ResourceManager) => {
    const { units, actions } = resources.get();

    const bases = units.getBases().filter((base) => base.isFinished());
    const needsWorkers = bases.some((base) => (base.assignedHarvesters ?? 0) < (base.idealHarvesters ?? 0));

    if (needsWorkers) {
        for (const base of bases) {
            if (base.noQueue && agent.canAfford(SCV)) await actions.train(SCV, base);
        }
    }
};
