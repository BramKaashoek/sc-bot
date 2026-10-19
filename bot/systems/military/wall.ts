import type { Agent, MapResource, Point2D, ResourceManager } from '@sc-bot/core';
import { MORPH_SUPPLYDEPOT_LOWER, MORPH_SUPPLYDEPOT_RAISE } from '@sc-bot/core/constants/ability';
import { Alliance } from '@sc-bot/core/constants/enums';
import { BARRACKS, SUPPLYDEPOT, SUPPLYDEPOTLOWERED } from '@sc-bot/core/constants/unit-type';
import { getStrategy } from '../strategy/index.ts';
import type { Strategy } from '../strategy/types.ts';

export const getWallBarracksPosition = (map: MapResource, strategy: Strategy): Point2D | null => {
    const ramp = map.getMainBaseRamp();
    if (!ramp) {
        return null;
    }
    const barracksGetsAddon = strategy.production.some(
        (production) => production.unitType === BARRACKS && (production.reactors ?? 0) + (production.techLabs ?? 0) > 0,
    );
    return barracksGetsAddon ? ramp.barracksCorrectPlacement : ramp.barracksInMiddle;
};

export const buildWall = async (agent: Agent, resources: ResourceManager) => {
    const { units, actions, map } = resources.get();
    const strategy = getStrategy();
    const ramp = map.getMainBaseRamp();

    if (!ramp) return;

    const barracksPosition = getWallBarracksPosition(map, strategy);
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

export const manageWall = async (_agent: Agent, resources: ResourceManager) => {
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
