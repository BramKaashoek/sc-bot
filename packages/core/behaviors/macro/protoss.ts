import type { Behavior, Point2D } from '../../types.ts';

export type ProtossStaticDefenceOptions = {
    pylonsPerBase?: number;
    photonCannonsPerBase?: number;
    shieldBatteriesPerBase?: number;
    excludeBaseLocations?: Point2D[];
    maxOnRoute?: number;
    techBaseLocation?: Point2D;
};

export function restorePower(): Behavior {
    return { name: 'restorePower', execute: () => false };
}

export function protossStaticDefence(_opts: ProtossStaticDefenceOptions = {}): Behavior {
    return { name: 'protossStaticDefence', execute: () => false };
}
