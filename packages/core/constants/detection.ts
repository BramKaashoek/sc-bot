import * as UnitType from './unit-type.ts';

export const DETECTOR_RANGES: Readonly<Record<number, number>> = {
    [UnitType.OBSERVER]: 11 + 0.5 + 1,
    [UnitType.OBSERVERSIEGEMODE]: 13.75 + 0.5 + 1,
    [UnitType.PHOTONCANNON]: 11 + 1.125 + 1,
    [UnitType.RAVEN]: 11 + 0.625 + 1,
    [UnitType.MISSILETURRET]: 11 + 1.125 + 1,
    [UnitType.OVERSEER]: 11 + 1 + 1,
    [UnitType.OVERSEERSIEGEMODE]: 13.75 + 1 + 1,
    [UnitType.SPORECRAWLER]: 11 + 0.875 + 1,
};

export const SCANNER_SWEEP_RANGE = 13 + 0 + 1;
