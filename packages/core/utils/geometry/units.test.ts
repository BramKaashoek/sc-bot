import { describe, expect, it } from 'bun:test';
import * as UnitType from '../../constants/unit-type.ts';
import { MineralField, Townhall, VespeneGeyser, getFootprint } from './units.ts';

describe('shape factories', () => {
    it('attach the fixed dimensions to the position', () => {
        const pos = { x: 3, y: 4 };

        expect(MineralField(pos)).toEqual({ pos, w: 2, h: 1 });
        expect(VespeneGeyser(pos)).toEqual({ pos, w: 3, h: 3 });
        expect(Townhall(pos)).toEqual({ pos, w: 5, h: 5 });
    });
});

describe('getFootprint', () => {
    it('maps each unit category to its footprint', () => {
        expect(getFootprint(UnitType.NEXUS)).toEqual({ w: 5, h: 5 });
        expect(getFootprint(UnitType.MINERALFIELD)).toEqual({ w: 2, h: 1 });
        expect(getFootprint(UnitType.PYLON)).toEqual({ w: 2, h: 2 });
        expect(getFootprint(UnitType.GATEWAY)).toEqual({ w: 3, h: 3 });
    });

    it('gives flying structures an empty footprint even when they are also townhalls', () => {
        expect(getFootprint(UnitType.COMMANDCENTERFLYING)).toEqual({ w: 0, h: 0 });
    });

    it('returns undefined for non-structure units', () => {
        expect(getFootprint(UnitType.PROBE)).toBeUndefined();
    });
});
