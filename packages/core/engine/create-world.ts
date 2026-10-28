import ResourceManager from './create-resource-manager.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { actionsResource } from '../resources/actions.ts';
import { debugResource } from '../resources/debug.ts';
import DataStorage from './data-storage.ts';
import { eventsResource } from '../resources/event-channel.ts';
import { frameResource } from '../resources/frame.ts';
import { mapResource } from '../resources/map.ts';
import { unitsResource } from '../resources/units.ts';
import { memoryResource } from '../resources/memory.ts';
import { spatialResource } from '../resources/spatial.ts';
import { influenceResource } from '../resources/influence.ts';
import { pathingResource } from '../resources/pathing.ts';
import { rolesResource } from '../resources/roles.ts';
import { squadsResource } from '../resources/squads.ts';
import { intelResource } from '../resources/intel.ts';
import { placementResource } from '../resources/placement.ts';
import { buildingsResource } from '../resources/buildings.ts';
import { miningResource } from '../resources/mining.ts';
import { flyingResource } from '../resources/flying.ts';
import { mapAnalysisResource } from '../resources/map-analysis.ts';
import { behaviorsResource } from '../resources/behaviors.ts';
import { openingsResource } from '../resources/openings.ts';
import type { CoreConfig, ResourceContainer, ResourceDefinition, World } from '../types.ts';

type CoreResourceDefinition = { [K in keyof ResourceContainer]-?: ResourceDefinition<K> }[keyof ResourceContainer];

function coreResources(client?: NodeSC2Proto.ProtoClient): CoreResourceDefinition[] {
    return [
        frameResource,
        mapResource,
        debugResource,
        unitsResource,
        eventsResource,
        actionsResource(client),
        memoryResource,
        spatialResource,
        influenceResource,
        pathingResource,
        rolesResource,
        squadsResource,
        intelResource,
        placementResource,
        buildingsResource,
        miningResource,
        flyingResource,
        mapAnalysisResource,
        behaviorsResource,
        openingsResource,
    ];
}

function createWorld(client?: NodeSC2Proto.ProtoClient, config: Readonly<CoreConfig> = DEFAULT_CONFIG): World {
    const world = {
        agent: null,
        data: null,
        resources: null,
        config,
    } as unknown as World;

    world.data = DataStorage();
    world.resources = ResourceManager(world);
    coreResources(client).forEach((definition) => world.resources.register(definition));

    return world;
}

export function resetGameState(world: World): void {
    world.resources.reset(world);
    world.data.set('earmarks', []);
}

export default createWorld;
