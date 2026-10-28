import { Alliance } from '../constants/enums.ts';
import { GATHERING } from '../constants/unit-role.ts';
import { MULE } from '../constants/unit-type.ts';
import { asArray, toTag, toTags } from '../utils/collections.ts';
import { Units } from './units-collection.ts';
import type { ResourceDefinition, RoleSettings, RolesResource, Unit, UnitResource, UnitRole } from '../types.ts';

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

export const stateByRoles = new WeakMap<RolesResource, RoleState>();

const freshState = (settings: RoleSettings): RoleState => ({
    settings,
    roleByTag: new Map(),
    tagsByRole: new Map(),
    seen: new Set(),
});

const ownByTag = (store: UnitResource, tag: string): Unit | undefined => {
    const unit = store.getByTag(tag);
    return unit?.alliance === Alliance.SELF ? unit : undefined;
};

const asList = (types?: number | number[]) => (types === undefined ? undefined : asArray(types));

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
        const roles: RolesResource = {
            assign(units, role) {
                const state = stateByRoles.get(roles)!;
                toTags(units).forEach((tag) => assignTag(state, tag, role));
            },
            clear(units) {
                const state = stateByRoles.get(roles)!;
                toTags(units).forEach((tag) => unassign(state, tag));
            },
            switchRole(from, to) {
                const state = stateByRoles.get(roles)!;
                [...(state.tagsByRole.get(from) ?? [])].forEach((tag) => assignTag(state, tag, to));
            },
            get(wanted, { types, excludeTypes } = {}) {
                const included = asList(types);
                const excluded = asList(excludeTypes);
                const { units: store } = world.resources.get();
                const { tagsByRole } = stateByRoles.get(roles)!;
                const wantedRoles: UnitRole[] = asArray<UnitRole>(wanted);
                const units = wantedRoles.flatMap((role) =>
                    [...(tagsByRole.get(role) ?? [])].flatMap((tag) => {
                        const unit = ownByTag(store, tag);
                        if (!unit || !unit.isCurrent() || unit.labels.has('dead')) return [];
                        if (included && !included.includes(unit.unitType)) return [];
                        if (excluded?.includes(unit.unitType)) return [];
                        return [unit];
                    }),
                );
                return Units.from(units);
            },
            roleOf(unit) {
                return stateByRoles.get(roles)!.roleByTag.get(toTag(unit));
            },
            getTags(role) {
                return stateByRoles.get(roles)!.tagsByRole.get(role) ?? new Set();
            },
            as(role, fn, { priority } = {}) {
                return world.resources.get().actions.as({ owner: `role:${role}`, priority }, fn);
            },
            mayCommand(owner, tag) {
                const { roleByTag, settings } = stateByRoles.get(roles)!;
                const role = roleByTag.get(tag);
                return role === undefined || !settings.exclusive.includes(role) || owner === `role:${role}`;
            },
            configure(settings) {
                Object.assign(stateByRoles.get(roles)!.settings, settings);
            },
        };
        stateByRoles.set(roles, freshState({ ...DEFAULT_SETTINGS }));
        return roles;
    },
    reset(roles) {
        stateByRoles.set(roles, freshState(stateByRoles.get(roles)!.settings));
    },
    onStep(roles, world) {
        const state = stateByRoles.get(roles)!;
        const { units: store } = world.resources.get();

        [...state.roleByTag.keys()].forEach((tag) => {
            const unit = ownByTag(store, tag);
            if (!unit || unit.labels.has('dead')) unassign(state, tag);
        });
        state.seen.forEach((tag) => {
            const unit = ownByTag(store, tag);
            if (!unit || unit.labels.has('dead')) state.seen.delete(tag);
        });

        store.getAll(Alliance.SELF).forEach((unit) => {
            const tag = unit.tag!;
            if (state.seen.has(tag) || !unit.isCurrent() || unit.labels.has('dead') || unit.buildProgress! < 1) return;
            state.seen.add(tag);
            const role = state.settings.defaultRole(unit);
            if (role !== undefined) assignTag(state, tag, role);
        });
    },
};
