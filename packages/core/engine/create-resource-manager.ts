import createDebug from 'debug';
import { ConnectionClosedError, GameEndedError, NodeSC2Error } from './errors.ts';
import type { ResourceContainer, ResourceDefinition, ResourceManager, World } from '../types.ts';

const debug = createDebug('sc2:debug:resources');
const debugSilly = createDebug('sc2:silly:resources');

function createResourceManager(world: World): ResourceManager {
    const managedResources = {} as ResourceContainer;
    const definitions = new Map<keyof ResourceContainer, ResourceDefinition<any>>();

    return {
        set(resources) {
            Object.assign(managedResources, resources);
        },
        get() {
            return managedResources;
        },
        register(definition) {
            const existing = definitions.get(definition.name);
            if (existing === definition) return managedResources[definition.name]!;
            if (existing) throw new NodeSC2Error(`Resource "${String(definition.name)}" is already registered`);

            definitions.set(definition.name, definition);
            const resource = definition.create(world);
            Object.assign(managedResources, { [definition.name]: resource });
            return resource;
        },
        reset(world) {
            definitions.forEach((definition, name) => {
                const resource = managedResources[name]!;
                if (definition.reset) definition.reset(resource, world);
                else Object.assign(resource, definition.create(world));
            });
        },
        step(world) {
            definitions.forEach((definition, name) => {
                try {
                    definition.onStep?.(managedResources[name]!, world);
                } catch (err) {
                    if (err instanceof GameEndedError || err instanceof ConnectionClosedError) throw err;
                    if (err instanceof NodeSC2Error) {
                        debugSilly(`Resource onStep error in ${String(name)}: `, err);
                    } else {
                        debug(`Resource onStep error in ${String(name)}: `);
                        debug((err as Error).message);
                        debug((err as Error).stack);
                    }
                }
            });
        },
    };
}

export default createResourceManager;
