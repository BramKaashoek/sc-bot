import { speedMineWorker } from '../../resources/mining.ts';
import type { Behavior, Unit } from '../../types.ts';

export function speedMining({ worker, target, townhall }: { worker: Unit; target: Unit; townhall?: Unit }): Behavior {
    return {
        name: 'speedMining',
        execute: ({ world }) => speedMineWorker(world, worker, target, townhall),
    };
}
