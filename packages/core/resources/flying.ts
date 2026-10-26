import * as Ability from '../constants/ability.ts';
import { Alliance } from '../constants/enums.ts';
import { flyingStructureTypes, reactorTypes, techLabTypes } from '../constants/groups.ts';
import * as UnitType from '../constants/unit-type.ts';
import { distanceSquared } from '../utils/geometry/point.ts';
import type { FlightPlan, FlyingStructures, Point2D, ResourceDefinition, Unit, World } from '../types.ts';

type Plan = { tag: string; destination: Point2D; land: boolean; state: FlightPlan['state']; startedAt: number };

type State = { settings: { priority: number }; plans: Map<string, Plan> };

const LANDING_RANGE_SQUARED = 5.5 ** 2;
const ARRIVED_SQUARED = 0.5 ** 2;
const LIFT_ORDERS = [
    Ability.LIFT,
    Ability.LIFT_BARRACKS,
    Ability.LIFT_COMMANDCENTER,
    Ability.LIFT_FACTORY,
    Ability.LIFT_ORBITALCOMMAND,
    Ability.LIFT_STARPORT,
];

const stateByFlying = new WeakMap<FlyingStructures, State>();

const hasAddon = (unit: Unit) => !!unit.addOnTag && unit.addOnTag !== '0';

function addonKind(addon: number): number[] | undefined {
    if (addon === UnitType.REACTOR) return reactorTypes;
    if (addon === UnitType.TECHLAB) return techLabTypes;
    return undefined;
}

function resolveHost(world: World, structure: Unit | number): Unit | undefined {
    if (typeof structure !== 'number') return structure;
    const { units } = world.resources.get();
    return units.getById(structure).find((unit) => unit.isFinished() && !hasAddon(unit));
}

function fly(world: World, plan: Plan, unit: Unit) {
    const { actions } = world.resources.get();
    const command = (abilityId: number, opts: { target?: Point2D; queue?: boolean } = {}) =>
        actions.queueAction({
            abilityId,
            unitTags: [unit.tag],
            queueCommand: !!opts.queue,
            ...(opts.target && { targetWorldSpacePos: opts.target }),
        });

    if (!flyingStructureTypes.includes(unit.unitType)) {
        plan.state = 'lifting';
        const orders = unit.orders ?? [];
        if (orders.some((order) => LIFT_ORDERS.includes(order.abilityId!))) return;
        if (orders.length > 0) {
            command(Ability.CANCEL_QUEUE5);
            command(Ability.LIFT, { queue: true });
        } else {
            command(Ability.LIFT);
        }
        return;
    }

    if (distanceSquared(unit.pos, plan.destination) >= LANDING_RANGE_SQUARED) {
        plan.state = 'flying';
        command(Ability.MOVE, { target: plan.destination });
    } else if (plan.land) {
        plan.state = 'landing';
        command(Ability.LAND, { target: plan.destination });
    }
}

export const flyingResource: ResourceDefinition<'flying'> = {
    name: 'flying',
    create: (world) => {
        const flying: FlyingStructures = {
            move(structure, destination, { land = true } = {}) {
                stateByFlying.get(flying)!.plans.set(structure.tag, {
                    tag: structure.tag,
                    destination: { x: destination.x, y: destination.y },
                    land,
                    state: 'lifting',
                    startedAt: world.resources.get().frame.getGameLoop(),
                });
            },
            swap(a, b) {
                const [aPos, bPos] = [a.pos, b.pos];
                flying.move(a, bPos);
                flying.move(b, aPos);
            },
            addonSwap(structure, addon) {
                const host = resolveHost(world, structure);
                if (!host || !host.isFinished()) return false;

                const { units } = world.resources.get();
                const kind = addonKind(addon);
                const addons = units
                    .getAlive({ alliance: Alliance.SELF })
                    .filter((unit) =>
                        kind
                            ? kind.includes(unit.unitType) && unit.isFinished() && unit.isIdle()
                            : unit.unitType === addon,
                    );
                if (addons.length === 0) return false;

                const target = addons.closestTo(host);
                const attached = units
                    .getStructures()
                    .find((unit) => unit.addOnTag === target.tag && unit.tag !== host.tag);
                if (attached) flying.move(attached, host.pos);
                flying.move(host, target.addOnLandPosition());
                return true;
            },
            cancel(structure) {
                stateByFlying.get(flying)!.plans.delete(typeof structure === 'string' ? structure : structure.tag);
            },
            getPlans() {
                return [...stateByFlying.get(flying)!.plans.values()].map((plan) =>
                    Object.freeze({ ...plan, destination: { ...plan.destination } }),
                );
            },
            configure(settings) {
                Object.assign(stateByFlying.get(flying)!.settings, settings);
            },
        };
        stateByFlying.set(flying, { settings: { priority: 10 }, plans: new Map() });
        return flying;
    },
    reset: (flying) => {
        stateByFlying.get(flying)!.plans.clear();
    },
    onStep: (flying, world) => {
        const { plans, settings } = stateByFlying.get(flying)!;
        if (plans.size === 0) return;
        const { units, actions } = world.resources.get();

        actions.as({ owner: 'flying', priority: settings.priority }, () => {
            for (const [tag, plan] of plans) {
                const unit = units.getByTag(tag);
                const landed = unit && !flyingStructureTypes.includes(unit.unitType);
                if (
                    !unit ||
                    !unit.isCurrent() ||
                    unit.labels.has('dead') ||
                    (landed && distanceSquared(unit.pos, plan.destination) <= ARRIVED_SQUARED)
                ) {
                    plans.delete(tag);
                    continue;
                }
                fly(world, plan, unit);
            }
        });
    },
};
