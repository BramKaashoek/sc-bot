import type { ResourceContainer, ResourceManager } from '../types.ts';

function createResourceManager(): ResourceManager {
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
            Object.assign(managedResources, resources);
        },
        get() {
            return managedResources;
        },
    };
}

export default createResourceManager;
