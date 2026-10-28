import createDebug from 'debug';
import { NodeSC2Error, triageError } from './errors.ts';
import type { ResourceContainer, ResourceDefinition, ResourceManager, World } from '../types.ts';

const debug = createDebug('sc2:debug:resources');

function createResourceManager(world: World): ResourceManager {
    const managedResources = {} as ResourceContainer;
    const definitions = new Map<keyof ResourceContainer, ResourceDefinition<any>>();
    const warnedUnconfigurable = new Set<keyof ResourceContainer>();

    const applyConfig = (name: keyof ResourceContainer, resource: object) => {
        const section = world.config.resources[name];
        if (section === undefined) return;
        if ('configure' in resource && typeof resource.configure === 'function') {
            resource.configure(section);
        } else if (!warnedUnconfigurable.has(name)) {
            warnedUnconfigurable.add(name);
            console.warn(`Config section "${String(name)}" ignored: resource has no configure()`);
        }
    };

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
            applyConfig(definition.name, resource);
            return resource;
        },
        reset(world) {
            definitions.forEach((definition, name) => {
                const resource = managedResources[name]!;
                if (definition.reset) definition.reset(resource, world);
                else Object.assign(resource, definition.create(world));
                applyConfig(name, resource);
            });
        },
        endGame(world, results) {
            definitions.forEach((definition, name) => {
                try {
                    definition.onGameEnd?.(managedResources[name]!, world, results);
                } catch (err) {
                    debug(`Resource onGameEnd error in ${String(name)}: `);
                    debug((err as Error).message);
                    debug((err as Error).stack);
                }
            });
        },
        step(world) {
            definitions.forEach((definition, name) => {
                try {
                    definition.onStep?.(managedResources[name]!, world);
                } catch (err) {
                    const log = (label: string, e: Error) => {
                        debug(label);
                        debug(e.message);
                        debug(e.stack);
                    };
                    triageError(err, `Resource onStep error in ${String(name)}: `, {
                        expected: log,
                        unexpected: (label, e) => {
                            log(label, e);
                            console.warn(label, e);
                        },
                    });
                }
            });
        },
    };
}

export default createResourceManager;
