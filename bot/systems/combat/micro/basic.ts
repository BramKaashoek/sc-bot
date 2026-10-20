import type { Point2D, Unit } from '@sc-bot/core';
import { log, nameOf, posOf } from '../../log.ts';
import { getMopUpTargets, MOP_UP_RADIUS } from '../utils.ts';
import type { MicroContext, MicroIntent } from './types.ts';

// a blob ordered to one point settles in a spread around it, so idle units this close count as arrived
const ARRIVED_DISTANCE = 8;

const distance = (a: { x?: number; y?: number }, b: Point2D) => Math.hypot(a.x! - b.x!, a.y! - b.y!);

const isHeadingTo = (unit: Unit, destination: Point2D) => {
    const orderPos = unit.orders?.[0]?.targetWorldSpacePos;
    return !!orderPos && distance(orderPos, destination) < 1;
};

const hasStaleAttackOrder = (unit: Unit, target: Point2D) => {
    const orderPos = unit.orders?.[0]?.targetWorldSpacePos;
    return unit.isAttacking() && !!orderPos && distance(orderPos, target) > MOP_UP_RADIUS;
};

export class BasicMicro {
    async run(context: MicroContext, intent: MicroIntent) {
        if (intent === 'retreat') {
            await this.retreat(context);
        } else {
            await this.attack(context);
        }
    }

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
                await actions.attackMove([unit], mopUpTargets.closestTo(unit.pos).pos);
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
