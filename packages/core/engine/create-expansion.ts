import { Alliance } from '../constants/enums.ts';
import { Units } from '../resources/units-collection.ts';
import townhallPlacement from '../utils/map/townhall.ts';
import type { Cluster, Expansion, World } from '../types.ts';

function createExpansion(world: World, cluster: Cluster): Expansion | undefined {
    const { units } = world.resources.get();

    const townhallPosition = townhallPlacement(
        world,
        cluster.centroid!,
        cluster.mineralFields,
        cluster.vespeneGeysers!,
    );
    if (!townhallPosition) return undefined;

    return {
        cluster,
        labels: new Map(),
        zPosition: cluster.mineralFields[0].pos!.z,
        townhallPosition,
        getWall() {
            return this.areas?.wall ?? [];
        },
        getBase() {
            if (this.base) {
                return units.getByTag(this.base);
            }
        },
        getMineralFields() {
            return Units.from(cluster.mineralFields.filter((field) => units.getByTag(field.tag)?.isCurrent()));
        },
        getVespeneGeysers() {
            return Units.from(cluster.vespeneGeysers!.filter((geyser) => units.getByTag(geyser.tag)?.isCurrent()));
        },
        getAlliance() {
            if (this.base) {
                const base = units.getByTag(this.base);
                return base ? base.alliance! : Alliance.NEUTRAL;
            } else {
                return Alliance.NEUTRAL;
            }
        },
    };
}

export default createExpansion;
