import { type MapResource, type Point2D, towards } from '@sc-bot/core';

// aim towards opponent, so not in supply line
export const buildAnchor = (map: MapResource, distance: number): Point2D => {
    // own main always exists once the game has started
    const home = map.getMain()!.townhallPosition;
    return towards(home, map.getCenter(), distance);
};
