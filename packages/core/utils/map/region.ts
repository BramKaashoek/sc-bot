import createDebug from 'debug';
import type { MapResource, Point2D, World } from '../../types.ts';

const debugDebug = createDebug('sc2:debug:RegionUtil');
let natGraph: Array<Point2D & { d: number }> | undefined;

// In theory this returns an area (grid) of the 'front' of your natural
function frontOfNatural(map: MapResource): Point2D[] {
    const natural = map.getNatural();

    if (!natural) {
        debugDebug('Current map has no definable natural, can not calculate');
        return [];
    }

    let enemyNat = map.getEnemyNatural();

    if (!enemyNat) {
        debugDebug('We do not know where our enemy nat is (yet?), defaulting to their main');
        enemyNat = map.getEnemyMain();
    }

    // natural area, sorted by distance from the enemy natural
    natGraph = natGraph || natural.areas!.areaFill
        .map(p => ({ ...p, d: map.path(p, enemyNat.townhallPosition).length }))
        .sort((a, b) => a.d - b.d);

    // slice off the front.. so uh, it's the front
    return natGraph.slice(0, Math.floor(natGraph.length / 3));
}

function frontOfGrid({ resources }: Pick<World, 'resources'>, grid: Point2D[]): Point2D[] {
    const { map } = resources.get();
    const mapCenter = map.getCenter(true);

    const frontGrid = grid
        .map(point => ({ ...point, distance: map.path(point, mapCenter).length} ))
        .sort((a, b) => a.distance - b.distance);

    return frontGrid.slice(0, Math.floor(frontGrid.length / 3));
}

export { frontOfNatural, frontOfGrid };
