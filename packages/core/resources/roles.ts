import { Alliance } from '../constants/enums.ts';
import { GATHERING } from '../constants/unit-role.ts';
import { MULE } from '../constants/unit-type.ts';
import { Units } from './units-collection.ts';
import type { ResourceDefinition, RoleSettings, RolesResource, Unit, UnitRole } from '../types.ts';

const DEFAULT_SETTINGS: RoleSettings = {
    defaultRole: (unit) => (unit.isWorker() && unit.unitType !== MULE ? GATHERING : undefined),
    exclusive: [],
};

type RoleState = {
    settings: RoleSettings;
    roleByTag: Map<string, UnitRole>;
    tagsByRole: Map<UnitRole, Set<string>>;
    seen: Set<string>;
};

const stateByRoles = new WeakMap<RolesResource, RoleState>();

const tagsOf = (units: Unit | Unit[] | string | string[]): string[] =>
    (Array.isArray(units) ? units : [units]).map((unit) => (typeof unit === 'string' ? unit : unit.tag!));

const asList = (types?: number | number[]) =>
    types === undefined ? undefined : Array.isArray(types) ? types : [types];

function unassign({ roleByTag, tagsByRole }: RoleState, tag: string) {
    const role = roleByTag.get(tag);
    if (role === undefined) return;
    roleByTag.delete(tag);
    tagsByRole.get(role)!.delete(tag);
}

function assignTag(state: RoleState, tag: string, role: UnitRole) {
    unassign(state, tag);
    state.roleByTag.set(tag, role);
    const tags = state.tagsByRole.get(role) ?? new Set<string>();
    state.tagsByRole.set(role, tags);
    tags.add(tag);
}

export const rolesResource: ResourceDefinition<'roles'> = {
    name: 'roles',
    create(world) {
        const state: RoleState = {
            settings: { ...DEFAULT_SETTINGS },
            roleByTag: new Map(),
            tagsByRole: new Map(),
            seen: new Set(),
        };
        const ownUnits = () => world.resources.get().units._units[Alliance.SELF];

        const roles: RolesResource = {
            assign(units, role) {
                tagsOf(units).forEach((tag) => assignTag(state, tag, role));
            },
            clear(units) {
                tagsOf(units).forEach((tag) => unassign(state, tag));
            },
            switchRole(from, to) {
                [...(state.tagsByRole.get(from) ?? [])].forEach((tag) => assignTag(state, tag, to));
            },
            get(wanted, { types, excludeTypes } = {}) {
                const included = asList(types);
                const excluded = asList(excludeTypes);
                const store = ownUnits();
                const wantedRoles: UnitRole[] = typeof wanted === 'string' ? [wanted] : wanted;
                const units = wantedRoles.flatMap((role) =>
                    [...(state.tagsByRole.get(role) ?? [])].flatMap((tag) => {
                        const unit = store.get(tag);
                        if (!unit || !unit.isCurrent() || unit.labels.has('dead')) return [];
                        if (included && !included.includes(unit.unitType)) return [];
                        if (excluded?.includes(unit.unitType)) return [];
                        return [unit];
                    }),
                );
                return Units.from(units);
            },
            roleOf(unit) {
                return state.roleByTag.get(typeof unit === 'string' ? unit : unit.tag!);
            },
            getTags(role) {
                return state.tagsByRole.get(role) ?? new Set();
            },
            as(role, fn, { priority } = {}) {
                return world.resources.get().actions.as({ owner: `role:${role}`, priority }, fn);
            },
            mayCommand(owner, tag) {
                const role = state.roleByTag.get(tag);
                return role === undefined || !state.settings.exclusive.includes(role) || owner === `role:${role}`;
            },
            configure(settings) {
                Object.assign(state.settings, settings);
            },
        };
        stateByRoles.set(roles, state);
        return roles;
    },
    reset(roles) {
        const state = stateByRoles.get(roles)!;
        state.roleByTag.clear();
        state.tagsByRole.clear();
        state.seen.clear();
    },
    onStep(roles, world) {
        const state = stateByRoles.get(roles)!;
        const own = world.resources.get().units._units[Alliance.SELF];

        [...state.roleByTag.keys()].forEach((tag) => {
            const unit = own.get(tag);
            if (!unit || unit.labels.has('dead')) unassign(state, tag);
        });
        state.seen.forEach((tag) => {
            const unit = own.get(tag);
            if (!unit || unit.labels.has('dead')) state.seen.delete(tag);
        });

        own.forEach((unit, tag) => {
            if (state.seen.has(tag) || !unit.isCurrent() || unit.labels.has('dead') || unit.buildProgress! < 1) return;
            state.seen.add(tag);
            const role = state.settings.defaultRole(unit);
            if (role !== undefined) assignTag(state, tag, role);
        });
    },
};
