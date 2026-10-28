import { stub } from '../engine/errors.ts';
import type { ResourceDefinition } from '../types.ts';

export const creepResource: ResourceDefinition<'creep'> = {
    name: 'creep',
    create() {
        return {
            getTiles: stub('getTiles'),
            getEdges: stub('getEdges'),
            getCoverage: stub('getCoverage'),
            closestTile: stub('closestTile'),
            findEdgePosition: stub('findEdgePosition'),
            nextTumorOnPath: stub('nextTumorOnPath'),
            randomPosition: stub('randomPosition'),
            tumorLowestCostPosition: stub('tumorLowestCostPosition'),
            shouldSpreadTumors: stub('shouldSpreadTumors'),
            overlordSpotterPositions: stub('overlordSpotterPositions'),
            blocksExpansion: stub('blocksExpansion'),
        };
    },
};
