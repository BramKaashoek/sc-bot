import {
    EFFECT_ANTIARMORMISSILE,
    EFFECT_CORROSIVEBILE,
    EFFECT_EMP,
    EFFECT_KD8CHARGE,
    EFFECT_PARASITICBOMB,
    EFFECT_PSISTORM,
} from '../../constants/ability.ts';
import { AOE_ABILITIES } from '../../constants/aoe.ts';
import { Race } from '../../constants/enums.ts';
import { findAoePosition } from '../../utils/combat/aoe.ts';
import { distance } from '../../utils/geometry/point.ts';
import type { Behavior, BehaviorContext, Point2D, Unit } from '../../types.ts';

const CAST_ON_UNIT = new Set([EFFECT_PARASITICBOMB, EFFECT_ANTIARMORMISSILE]);

type CastCheck = {
    abilityId: number;
    targets: Unit[];
    minTargets: number;
    avoidOwnFlying: boolean;
    avoidOwnGround: boolean;
    stackSameSpell: boolean;
    casterTag: string;
};

const MAX_CANDIDATE_TARGETS = 40;

function canCast(ctx: BehaviorContext, check: CastCheck, position: Point2D): boolean {
    const { abilityId, targets, minTargets, avoidOwnFlying, avoidOwnGround, stackSameSpell, casterTag } = check;
    const { radius, effectId, buffId } = AOE_ABILITIES.get(abilityId)!;
    const { spatial, map } = ctx.world.resources.get();
    // ares counts the caster here, so its KD8 (cast range 2, radius 5) always trips avoidOwnGround; we skip the caster
    const ownIn = (kind: 'ownAir' | 'ownGround') =>
        spatial.unitsInRange(position, radius, kind).some((own) => own.tag !== casterTag);

    if (targets.filter((target) => distance(target.pos, position) < radius).length < minTargets) return false;
    if (avoidOwnFlying && ownIn('ownAir')) return false;
    if (avoidOwnGround && ownIn('ownGround')) return false;
    if (stackSameSpell) return true;

    const effectActive =
        effectId !== undefined &&
        map
            .getEffects()
            .some(
                (effect) =>
                    effect.effectId === effectId &&
                    ((effect.pos ?? []) as Point2D[]).some((spot) => distance(spot, position) < radius),
            );
    if (effectActive) return false;
    return buffId === undefined || !targets.some((target) => target.hasBuff(buffId));
}

export function useAOEAbility({
    unit,
    abilityId,
    targets,
    minTargets,
    avoidOwnFlying = false,
    avoidOwnGround = false,
    bonusTags,
    recalculate = false,
    stackSameSpell = false,
}: {
    unit: Unit;
    abilityId: number;
    targets: Unit[];
    minTargets: number;
    avoidOwnFlying?: boolean;
    avoidOwnGround?: boolean;
    bonusTags?: ReadonlySet<string>;
    recalculate?: boolean;
    stackSameSpell?: boolean;
}): Behavior {
    return {
        name: 'useAOEAbility',
        execute(ctx) {
            const info = AOE_ABILITIES.get(abilityId);
            if (!info) {
                console.warn(`useAOEAbility doesn't support ability ${abilityId}`);
                return false;
            }
            const check = {
                abilityId,
                targets,
                minTargets,
                avoidOwnFlying,
                avoidOwnGround,
                stackSameSpell,
                casterTag: unit.tag,
            };

            if (!recalculate && unit.isUsingAbility(abilityId)) {
                const [order] = unit.orders ?? [];
                const castAt =
                    order?.targetWorldSpacePos ??
                    (order?.targetUnitTag
                        ? ctx.world.resources.get().units.getByTag(order.targetUnitTag)?.pos
                        : undefined);
                if (castAt && canCast(ctx, check, castAt as Point2D)) return true;
            }

            if (targets.length === 0 || targets.length < minTargets || !unit.abilityAvailable(abilityId)) return false;

            const nearest =
                targets.length > MAX_CANDIDATE_TARGETS
                    ? [...targets]
                          .sort((a, b) => distance(a.pos, unit.pos) - distance(b.pos, unit.pos))
                          .slice(0, MAX_CANDIDATE_TARGETS)
                    : targets;
            const position = findAoePosition(info.radius, nearest, minTargets, bonusTags);
            if (!position || !canCast(ctx, check, position)) return false;

            if (!CAST_ON_UNIT.has(abilityId)) {
                ctx.order(unit, abilityId, position);
                return true;
            }
            const closest = targets.reduce((best, target) =>
                distance(target.pos, position) < distance(best.pos, position) ? target : best,
            );
            ctx.order(unit, abilityId, closest);
            return true;
        },
    };
}

export function autoUseAOEAbility({
    unit,
    targets,
    bonusTags,
    recalculate,
    stackSameSpell,
}: {
    unit: Unit;
    targets: Unit[];
    bonusTags?: ReadonlySet<string>;
    recalculate?: boolean;
    stackSameSpell?: boolean;
}): Behavior {
    return {
        name: 'autoUseAOEAbility',
        execute(ctx) {
            for (const [abilityId, { range }] of AOE_ABILITIES) {
                if (!unit.abilityAvailable(abilityId)) continue;

                const reach = range + (unit.radius ?? 0) + 0.5;
                let inReach = targets.filter((target) => distance(target.pos, unit.pos) < reach);
                if (abilityId === EFFECT_EMP)
                    inReach = inReach.filter((t) => (t.shield ?? 0) > 48 || (t.energy ?? 0) > 48);
                if (inReach.length === 0) continue;

                let minTargets = 4;
                if (abilityId === EFFECT_CORROSIVEBILE || abilityId === EFFECT_KD8CHARGE) minTargets = 1;
                else if (abilityId === EFFECT_EMP && ctx.world.agent.opponent?.race !== Race.PROTOSS) minTargets = 2;

                return useAOEAbility({
                    unit,
                    abilityId,
                    targets: inReach,
                    minTargets,
                    avoidOwnGround: abilityId === EFFECT_KD8CHARGE || abilityId === EFFECT_PSISTORM,
                    avoidOwnFlying: abilityId === EFFECT_PSISTORM,
                    bonusTags,
                    recalculate,
                    stackSameSpell,
                }).execute(ctx);
            }
            return false;
        },
    };
}
