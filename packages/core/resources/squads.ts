import { NodeSC2Error } from '../engine/errors.ts';
import { asArray } from '../utils/collections.ts';
import { avgPoints, distance } from '../utils/geometry/point.ts';
import { Units } from './units-collection.ts';
import type { Point2D, ResourceDefinition, Squad, SquadsResource, Unit, UnitRole } from '../types.ts';

const DEFAULT_RADIUS = 6;

type SquadState = { id: string; created: number; tags: Set<string>; centroid: Point2D };

type KeyState = {
    squads: SquadState[];
    counter: number;
    lastMainPosition?: Point2D;
    cache?: { loop: number; squads: Squad[] };
};

export const stateBySquads = new WeakMap<SquadsResource, Map<string, KeyState>>();

const typeList = (types?: number | number[]) => (types === undefined ? [] : [...asArray(types)].sort((a, b) => a - b));

function cluster(state: KeyState, role: UnitRole, members: Unit[], radius: number): SquadState[] {
    const byTag = new Map(members.map((unit) => [unit.tag!, unit]));

    state.squads.forEach((squad) => {
        squad.tags.forEach((tag) => {
            const unit = byTag.get(tag);
            if (!unit || distance(unit.pos, squad.centroid) > radius) squad.tags.delete(tag);
        });
    });
    state.squads = state.squads.filter((squad) => squad.tags.size > 0);

    merge: for (const [i, first] of state.squads.entries()) {
        for (const second of state.squads.slice(i + 1)) {
            if (distance(first.centroid, second.centroid) > radius) continue;
            const [into, from] = second.tags.size > first.tags.size ? [second, first] : [first, second];
            from.tags.forEach((tag) => into.tags.add(tag));
            state.squads = state.squads.filter((squad) => squad !== from);
            break merge;
        }
    }

    const assigned = new Set(state.squads.flatMap((squad) => [...squad.tags]));
    members.forEach((unit) => {
        if (assigned.has(unit.tag!)) return;
        const closest = state.squads
            .filter((squad) => distance(unit.pos, squad.centroid) <= radius)
            .reduce<SquadState | undefined>(
                (best, squad) =>
                    best === undefined || distance(unit.pos, squad.centroid) < distance(unit.pos, best.centroid)
                        ? squad
                        : best,
                undefined,
            );
        if (closest) {
            closest.tags.add(unit.tag!);
            return;
        }
        state.counter += 1;
        state.squads.push({
            id: `${role}-${state.counter}`,
            created: state.counter,
            tags: new Set([unit.tag!]),
            centroid: unit.pos,
        });
    });

    state.squads.forEach((squad) => {
        squad.centroid = avgPoints([...squad.tags].map((tag) => byTag.get(tag)!.pos));
    });
    return state.squads;
}

export const squadsResource: ResourceDefinition<'squads'> = {
    name: 'squads',
    create(world) {
        const squads: SquadsResource = {
            getSquads(role, { radius = DEFAULT_RADIUS, types } = {}) {
                const sortedTypes = typeList(types);
                const key = JSON.stringify([role, sortedTypes]);
                const states = stateBySquads.get(squads)!;
                const state = states.get(key) ?? { squads: [], counter: 0 };
                states.set(key, state);

                const { frame, roles } = world.resources.get();
                const loop = frame.getGameLoop();
                if (state.cache?.loop === loop) return state.cache.squads;

                const members = [...roles.get(role, sortedTypes.length > 0 ? { types: sortedTypes } : {})];
                const clustered = cluster(state, role, members, radius);
                const main = clustered.reduce<SquadState | undefined>(
                    (best, squad) =>
                        best === undefined ||
                        squad.tags.size > best.tags.size ||
                        (squad.tags.size === best.tags.size && squad.created < best.created)
                            ? squad
                            : best,
                    undefined,
                );
                if (main) state.lastMainPosition = main.centroid;

                const byTag = new Map(members.map((unit) => [unit.tag!, unit]));
                const result = clustered.map(
                    (squad): Squad => ({
                        id: squad.id,
                        role,
                        units: Units.from([...squad.tags].map((tag) => byTag.get(tag)!)),
                        tags: new Set(squad.tags),
                        position: squad.centroid,
                        isMain: squad === main,
                    }),
                );
                state.cache = { loop, squads: result };
                return result;
            },
            getMainSquad(role, opts) {
                return squads.getSquads(role, opts).find((squad) => squad.isMain);
            },
            getMainSquadPosition(role, { types } = {}) {
                const main = squads.getMainSquad(role, { types });
                if (main) return main.position;
                const state = stateBySquads.get(squads)!.get(JSON.stringify([role, typeList(types)]));
                const { map, units } = world.resources.get();
                const position = state?.lastMainPosition ?? map.getMain()?.townhallPosition ?? units.getBases()[0]?.pos;
                if (!position)
                    throw new NodeSC2Error('getMainSquadPosition: no main squad, main expansion or own base');
                return position;
            },
        };
        stateBySquads.set(squads, new Map());
        return squads;
    },
    reset(squads) {
        stateBySquads.set(squads, new Map());
    },
};
