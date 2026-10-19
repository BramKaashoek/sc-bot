import type { Point2D, World } from '../../types.ts';

function frontOfGrid({ resources }: Pick<World, 'resources'>, grid: Point2D[]): Point2D[] {
    const { map } = resources.get();
    const mapCenter = map.getCenter(true);

    const frontGrid = grid
        .map((point) => ({ ...point, distance: map.path(point, mapCenter).length }))
        .sort((a, b) => a.distance - b.distance);

    return frontGrid.slice(0, Math.floor(frontGrid.length / 3));
}

export { frontOfGrid };
