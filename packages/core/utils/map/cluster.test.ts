import { describe, expect, it } from 'bun:test';
import type { Unit } from '../../types.ts';
import * as UnitType from '../../constants/unit-type.ts';
import { clusterByNeighbor, createClusters } from './cluster.ts';

describe('createClusters', () => {
    it('groups nearby fields and geysers with a running centroid, and starts a new cluster when too far', () => {
        const nearMineral = { unitType: UnitType.MINERALFIELD, pos: { x: 0, y: 0 } } as Unit;
        const secondMineral = { unitType: UnitType.MINERALFIELD, pos: { x: 2, y: 0 } } as Unit;
        const geyser = { unitType: UnitType.PROTOSSVESPENEGEYSER, pos: { x: 4, y: 0 } } as Unit;
        const farMineral = { unitType: UnitType.MINERALFIELD, pos: { x: 100, y: 100 } } as Unit;

        expect(createClusters([nearMineral, secondMineral, geyser, farMineral])).toEqual([
            { centroid: { x: 2, y: 0 }, mineralFields: [nearMineral, secondMineral], vespeneGeysers: [geyser] },
            { centroid: { x: 100, y: 100 }, mineralFields: [farMineral], vespeneGeysers: [] },
        ]);
    });

    it('honours a custom distanceApart', () => {
        const left = { unitType: UnitType.MINERALFIELD, pos: { x: 0, y: 0 } } as Unit;
        const right = { unitType: UnitType.MINERALFIELD, pos: { x: 5, y: 0 } } as Unit;

        expect(createClusters([left, right], 4)).toHaveLength(2);
        expect(createClusters([left, right], 6)).toHaveLength(1);
    });
});

describe('clusterByNeighbor', () => {
    it('groups points linked by adjacent or diagonal steps, sorting rows first', () => {
        expect(
            clusterByNeighbor([
                { x: 5, y: 5 },
                { x: 1, y: 1 },
                { x: 1, y: 0 },
                { x: 0, y: 0 },
            ]),
        ).toEqual([
            [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 },
            ],
            [{ x: 5, y: 5 }],
        ]);
    });

    it('merges groups that a later point connects', () => {
        expect(
            clusterByNeighbor([
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: 1, y: 1 },
            ]),
        ).toEqual([
            [
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: 1, y: 1 },
            ],
        ]);
    });
});
