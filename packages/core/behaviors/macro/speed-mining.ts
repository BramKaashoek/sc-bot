import type { Behavior, Unit } from '../../types.ts';

export function speedMining(_opts: { worker: Unit; target: Unit; townhall?: Unit }): Behavior {
    return { name: 'speedMining', execute: () => false };
}
