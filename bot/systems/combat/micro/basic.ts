import { distance, type Point2D, type Unit } from '@sc-bot/core';
import { log, nameOf, posOf } from '../../log.ts';
import { getMopUpTargets, MOP_UP_RADIUS } from '../utils.ts';
import type { MicroContext, MicroIntent } from './types.ts';

// a blob ordered to one point settles in a spread around it, so idle units this close count as arrived
const ARRIVED_DISTANCE = 8;

const isHeadingTo = (unit: Unit, destination: Point2D) => {
    const orderPos = unit.orders?.[0]?.targetWorldSpacePos;
    return !!orderPos && distance(orderPos as Point2D, destination) < 1;
};

const hasStaleAttackOrder = (unit: Unit, target: Point2D) => {
    const orderPos = unit.orders?.[0]?.targetWorldSpacePos;
    return unit.isAttacking() && !!orderPos && distance(orderPos as Point2D, target) > MOP_UP_RADIUS;
};

// TODO: avoid static defense range (airRange for flyers, groundRange otherwise) unless it is the target
export class BasicMicro {
    async run(context: MicroContext, intent: MicroIntent) {
        if (intent === 'retreat') {
            await this.retreat(context);
        } else {
            await this.attack(context);
        }
    }

    // TODO: move as a group: when not engaged, regroup at group.center if spread > ~6, else a-move to a waypoint ~8 cells along map.path(group.center, target), re-issuing only when it moved > ~3
    async attack({ resources, units, target }: MicroContext) {
        const { actions } = resources.get();
        const mopUpTargets = getMopUpTargets(resources, target);

        const toTarget = units.filter(
            (unit) =>
                hasStaleAttackOrder(unit, target) ||
                (unit.isIdle() && !mopUpTargets.length && unit.distanceTo(target) > ARRIVED_DISTANCE),
        );
        if (toTarget.length) {
            await actions.attackMove(toTarget, target);
            log(
                { resources },
                `micro: ${toTarget.length} ${nameOf(toTarget[0])} attack-moving to ${posOf(target)}`,
                'dim',
            );
        }

        const idle = units.filter((unit) => unit.isIdle());
        if (mopUpTargets.length && idle.length) {
            for (const unit of idle) {
                const closest = mopUpTargets.closestTo(unit.pos);
                if (closest) await actions.attackMove([unit], closest.pos);
            }
            log(
                { resources },
                `micro: ${idle.length} ${nameOf(idle[0])} mopping up ${mopUpTargets.length} enemies near ${posOf(target)}`,
                'dim',
            );
        }
    }

    async retreat({ resources, units, target }: MicroContext) {
        const { actions } = resources.get();
        const notRetreating = units.filter((unit) => !(unit.isMoving() && isHeadingTo(unit, target)));
        if (notRetreating.length) {
            await actions.move(notRetreating, target);
            log(
                { resources },
                `micro: ${notRetreating.length} ${nameOf(notRetreating[0])} retreating to ${posOf(target)}`,
                'dim',
            );
        }
    }
}
