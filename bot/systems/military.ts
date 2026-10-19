import { type Agent, createSystem, type Point2D, type ResourceManager } from '@sc-bot/core';
import { MORPH_SUPPLYDEPOT_LOWER, MORPH_SUPPLYDEPOT_RAISE } from '@sc-bot/core/constants/ability';
import { Alliance } from '@sc-bot/core/constants/enums';
import { BARRACKS, MARINE, SUPPLYDEPOT, SUPPLYDEPOTLOWERED } from '@sc-bot/core/constants/unit-type';
import { buildAnchor } from './anchor.ts';

export default createSystem({
    name: 'Military',
    async onStep({ agent, resources }) {
        await buildWall(agent, resources);
        await buildBaracks(agent, resources);
        await trainMarine(agent, resources);
        await manageWall(agent, resources);
    },
});

const trainMarine = (agent: Agent, resources: ResourceManager) => {
    const { units, actions } = resources.get();

    if ((agent.minerals ?? 0) < 500 || !agent.canFeed(MARINE)) return;

    const idleBarracks = units.getById(BARRACKS, {
        noQueue: true,
        alliance: Alliance.SELF,
    }).ready;
    return Promise.all(idleBarracks.map((barracks) => actions.train(MARINE, barracks)));
};

const buildBaracks = async (agent: Agent, resources: ResourceManager) => {
    const BARRACKS_TARGET = 3;

    const { units, actions, map } = resources.get();

    const barracksCount = units.getById(BARRACKS).ready.length + agent.alreadyPending(BARRACKS);

    if (barracksCount < BARRACKS_TARGET && agent.hasTechFor(BARRACKS) && agent.canAfford(BARRACKS)) {
        const position = await actions.findPlacement(BARRACKS, buildAnchor(map, 10), { addonPlace: true });
        if (position) await actions.build(BARRACKS, position);
    }
};

const buildWall = async (agent: Agent, resources: ResourceManager) => {
    const { units, actions, map } = resources.get();
    const ramp = map.getMainBaseRamp();
    if (!ramp) return;

    const barracksPosition = ramp.barracksCorrectPlacement;
    if (!barracksPosition) return;
    const barracks = units.getById(BARRACKS).closerThan(1, barracksPosition);
    const [leftPosition, rightPosition] = ramp.cornerDepots;
    const allDepots = units.getById([SUPPLYDEPOT, SUPPLYDEPOTLOWERED]);

    const leftDepot = allDepots.closerThan(1, leftPosition);
    if (leftDepot.empty && agent.canAfford(SUPPLYDEPOT) && units.getPendingAt(SUPPLYDEPOT, leftPosition).empty) {
        await actions.build(SUPPLYDEPOT, leftPosition);
    }

    const rightDepot = allDepots.closerThan(1, rightPosition);
    if (rightDepot.empty && agent.canAfford(SUPPLYDEPOT) && units.getPendingAt(SUPPLYDEPOT, rightPosition).empty) {
        await actions.build(SUPPLYDEPOT, rightPosition);
    }

    if (
        barracks.empty &&
        agent.canAfford(BARRACKS) &&
        agent.hasTechFor(BARRACKS) &&
        units.getPendingAt(BARRACKS, barracksPosition).empty
    ) {
        await actions.build(BARRACKS, barracksPosition);
    }
};

const manageWall = async (_agent: Agent, resources: ResourceManager) => {
    const RAISE_DISTANCE = 10;
    const LOWER_DISTANCE = 15;

    const { units } = resources.get();

    const enemies = units.getAlive(Alliance.ENEMY).filter((unit) => !unit.isStructure() && !unit.isFlying);
    const nearestEnemyDistance = (depot: { pos: Point2D }) =>
        Math.min(...enemies.map((enemy) => Math.hypot(enemy.pos.x - depot.pos.x, enemy.pos.y - depot.pos.y)));
    await Promise.all([
        ...units
            .getById(SUPPLYDEPOT)
            .ready.filter((depot) => nearestEnemyDistance(depot) >= LOWER_DISTANCE)
            .map((depot) => depot.useAbility(MORPH_SUPPLYDEPOT_LOWER)),
        ...units
            .getById(SUPPLYDEPOTLOWERED)
            .ready.filter((depot) => nearestEnemyDistance(depot) < RAISE_DISTANCE)
            .map((depot) => depot.useAbility(MORPH_SUPPLYDEPOT_RAISE)),
    ]);
};
