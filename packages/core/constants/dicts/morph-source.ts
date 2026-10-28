import * as UnitType from '../unit-type.ts';

export const morphSource: Record<number, number> = {
    [UnitType.BANELING]: UnitType.ZERGLING,
    [UnitType.BROODLORD]: UnitType.CORRUPTOR,
    [UnitType.LURKERMP]: UnitType.HYDRALISK,
    [UnitType.OVERSEER]: UnitType.OVERLORD,
    [UnitType.OVERLORDTRANSPORT]: UnitType.OVERLORD,
    [UnitType.RAVAGER]: UnitType.ROACH,
};
