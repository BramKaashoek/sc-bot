import type { ResourceContainer, ResourceManager } from '../types.ts';

function createResourceManager(): ResourceManager {

    // TODO(ts): ResourceContainer requires non-null resources; they are populated via set() before use
    const managedResources = {
        actions: null,
        events: null,
        frame: null,
        map: null,
        units: null,
        debug: null,
    } as unknown as ResourceContainer;

    return {
        set(resources) {
            Object.entries(resources).forEach(([name, resource]) => {
                /**
                 * so this was the original idea injecting context into resources,
                 * i guess technically we don't need it anymore, but depending on
                 * if/how we expose registering user-created resources... might
                 * revisit this again -
                 * 
                 * allows resource methods to access sibling resources and
                 * other world properties ... it's a little meta.. yeah
                 * 
                 * 
                 * Object.defineProperties(resource, {
                        resources: {
                            configurable: false,
                            enumerable: false,
                            writable: false,
                            value: this,
                        },
                        world: {
                            configurable: false,
                            enumerable: false,
                            writable: false,
                            value: world,
                        },
                    });
                 */

                // TODO(ts): dynamic key assignment across heterogeneous resource types
                (managedResources as Record<string, unknown>)[name] = resource;
            });
        },
        get() {
            return managedResources;
        }
    };
}

export default createResourceManager;
