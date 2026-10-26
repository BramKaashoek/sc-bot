import { Alliance } from '../constants/enums.ts';
import { createBucketIndex } from '../utils/spatial/bucket-index.ts';
import type { BucketIndex } from '../utils/spatial/bucket-index.ts';
import { Units, isFlying, toPoint } from './units-collection.ts';
import type { Point2D, ResourceDefinition, SpatialKind, Unit } from '../types.ts';

const KINDS: SpatialKind[] = ['enemy', 'enemyGround', 'enemyAir', 'own', 'ownGround', 'ownAir'];

type Group = { units: Unit[]; positions: Point2D[]; index: BucketIndex };

export const spatialResource: ResourceDefinition<'spatial'> = {
    name: 'spatial',
    create(world) {
        const groups = Object.fromEntries(
            KINDS.map((kind): [SpatialKind, Group] => [kind, { units: [], positions: [], index: createBucketIndex() }]),
        ) as Record<SpatialKind, Group>;
        let builtLoop = -1;

        const add = (unit: Unit, all: SpatialKind, ground: SpatialKind, air: SpatialKind) => {
            for (const kind of [all, isFlying(unit) ? air : ground]) {
                groups[kind].units.push(unit);
                groups[kind].positions.push(unit.pos);
            }
        };

        const groupFor = (kind: SpatialKind): Group => {
            const { frame, memory, units } = world.resources.get();
            const loop = frame.getGameLoop();
            if (loop !== builtLoop) {
                builtLoop = loop;
                for (const group of Object.values(groups)) {
                    group.units.length = 0;
                    group.positions.length = 0;
                }
                for (const enemy of memory.getEnemies()) add(enemy, 'enemy', 'enemyGround', 'enemyAir');
                for (const own of units.getAlive(Alliance.SELF)) add(own, 'own', 'ownGround', 'ownAir');
                for (const group of Object.values(groups)) group.index.build(group.positions);
            }
            return groups[kind];
        };

        return {
            unitsInRange(from, distance, kind) {
                const { units, index } = groupFor(kind);
                const found = new Units();
                index.forEachInRange(toPoint(from), distance, (i) => {
                    found.push(units[i]);
                });
                return found;
            },
            anyInRange(from, distance, kind) {
                return groupFor(kind).index.forEachInRange(toPoint(from), distance, () => true);
            },
            closest(from, kind, maxDistance) {
                const { units, index } = groupFor(kind);
                const i = index.closest(toPoint(from), maxDistance);
                return i === -1 ? undefined : units[i];
            },
        };
    },
};
