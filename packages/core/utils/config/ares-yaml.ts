import { NodeSC2Error } from '../../engine/errors.ts';
import type { OpeningSettings, PlacementTable } from '../../types.ts';

export function parseAresBuilds(_yamlText: string): Partial<OpeningSettings> {
    throw new NodeSC2Error('not implemented: parseAresBuilds');
}

export function parseAresPlacements(_yamlText: string): PlacementTable {
    throw new NodeSC2Error('not implemented: parseAresPlacements');
}
