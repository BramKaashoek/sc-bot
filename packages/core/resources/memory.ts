import { Alliance } from '../constants/enums.ts';
import { Units, isFlying } from './units-collection.ts';
import type { EnemyMemory, MemorySettings, ResourceDefinition, Unit, World } from '../types.ts';

const DEFAULT_SETTINGS: MemorySettings = { expireGround: 30, expireAir: 30 };

const settingsByMemory = new WeakMap<EnemyMemory, MemorySettings>();

const SURROUNDING_CELLS = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
];

function isSurroundedByVision(world: World, unit: Unit): boolean {
    const { map } = world.resources.get();
    const { x: width = 0, y: height = 0 } = map.getSize();
    const cx = Math.floor(unit.pos.x);
    const cy = Math.floor(unit.pos.y);
    return SURROUNDING_CELLS.every(([dx, dy]) => {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) return true;
        return map.isVisible({ x, y });
    });
}

export const memoryResource: ResourceDefinition<'memory'> = {
    name: 'memory',
    create(world) {
        const enemyStore = () => world.resources.get().units._units[Alliance.ENEMY];
        const memory: EnemyMemory = {
            getGhosts() {
                return Units.from(Array.from(enemyStore().values()).filter((unit) => unit.isMemory()));
            },
            getSnapshots() {
                return Units.from(
                    Array.from(enemyStore().values()).filter((unit) => unit.isCurrent() && unit.isSnapshot()),
                );
            },
            getEnemies({ includeGhosts = true, structures = true } = {}) {
                return Units.from(
                    Array.from(enemyStore().values()).filter(
                        (unit) => (includeGhosts || unit.isCurrent()) && (structures || !unit.isStructure()),
                    ),
                );
            },
            forget(tag) {
                enemyStore().delete(tag);
            },
            configure(settings) {
                Object.assign(settingsByMemory.get(memory)!, settings);
            },
        };
        settingsByMemory.set(memory, { ...DEFAULT_SETTINGS });
        return memory;
    },
    reset() {},
    onStep(memory, world) {
        const { expireGround, expireAir } = settingsByMemory.get(memory)!;
        const enemies = world.resources.get().units._units[Alliance.ENEMY];
        enemies.forEach((unit, tag) => {
            if (unit.isCurrent()) return;
            const expired = unit.age() > (isFlying(unit) ? expireAir : expireGround);
            if (expired || (!unit.isBurrowed && isSurroundedByVision(world, unit))) enemies.delete(tag);
        });
    },
};
