import ResourceManager from './create-resource-manager.ts';
import ActionManager from '../resources/actions.ts';
import Debugger from '../resources/debug.ts';
import DataStorage from './data-storage.ts';
import EventChannel from '../resources/event-channel.ts';
import Frame from '../resources/frame.ts';
import MapManager from '../resources/map.ts';
import UnitManager from '../resources/units.ts';
import type { World } from '../types.ts';

function createWorld(client?: NodeSC2Proto.ProtoClient): World {
    const world = {
        agent: null,
        data: null,
        resources: null,
    } as unknown as World;

    world.data = DataStorage();
    world.resources = ResourceManager();

    world.resources.set({
        frame: Frame(),
        map: MapManager(world),
        debug: Debugger(world),
        units: UnitManager(world),
        events: EventChannel(world),
        actions: ActionManager(world, client),
    });

    return world;
}

export function resetGameState(world: World): void {
    const { map, units, events, debug } = world.resources.get();
    Object.values(units._units).forEach((store) => store.clear());
    Object.assign(map, MapManager(world));
    Object.assign(events, EventChannel(world));
    Object.assign(debug!, Debugger(world));
    world.data.set('earmarks', []);
}

export default createWorld;
