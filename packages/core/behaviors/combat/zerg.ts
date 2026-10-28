import type { Units } from '../../resources/units-collection.ts';
import type { Behavior, InfluenceGrid, InfluenceLayer, Point2D, Unit } from '../../types.ts';

export function tumorSpreadCreep(_opts: { unit: Unit }): Behavior {
    return { name: 'tumorSpreadCreep', execute: () => false };
}

export function queenSpreadCreep(_opts: { unit: Unit; cancelIfCloseEnemy?: boolean; preMove?: boolean }): Behavior {
    return { name: 'queenSpreadCreep', execute: () => false };
}

export function useTransfuse(_opts: { unit: Unit; targets: Unit[] | Units; extraRange?: number }): Behavior {
    return { name: 'useTransfuse', execute: () => false };
}

export function nydusPathUnitToTarget(_opts: {
    unit: Unit;
    target: Point2D;
    layer?: InfluenceLayer | InfluenceGrid;
    successAtDistance?: number;
    sensitivity?: number;
    smoothing?: boolean;
    exitMaxInfluence?: number;
}): Behavior {
    return { name: 'nydusPathUnitToTarget', execute: () => false };
}
