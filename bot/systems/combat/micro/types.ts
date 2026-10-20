import type { Point2D, ResourceManager, Units } from '@sc-bot/core';

export type MicroIntent = 'attack' | 'retreat';

export type MicroContext = {
    resources: ResourceManager;
    units: Units;
    group: Units;
    target: Point2D;
};
