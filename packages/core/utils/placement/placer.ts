import { NodeSC2Error } from '../../engine/errors.ts';
import type { Placer, PlacementTable } from '../../types.ts';

export function createPlacer(_table: PlacementTable): Placer {
    throw new NodeSC2Error('not implemented: createPlacer');
}
