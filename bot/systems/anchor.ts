import type { MapResource, Point2D } from '@sc-bot/core';

// aim towards opponent, so not in supply line
export const buildAnchor = (map: MapResource, distance: number): Point2D => {
    const home = map.getMain().townhallPosition;
    const center = map.getCenter();
    const length = Math.hypot(center.x - home.x, center.y - home.y);

    return {
        x: home.x + ((center.x - home.x) / length) * distance,
        y: home.y + ((center.y - home.y) / length) * distance,
    };
};
