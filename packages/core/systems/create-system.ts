import createDebug from 'debug';
import pascalCase from 'pascal-case';
import unitPlugin from './unit-plugin.ts';
import { builderPlugin } from './builder-plugin.ts';
import { NodeSC2Error, GameEndedError } from '../engine/errors.ts';
import type { EventReader, System, SystemObject, SystemOptions, SystemWrapper, World } from '../types.ts';

const debug = createDebug('sc2:debug:system');
const debugSilly = createDebug('sc2:silly:system');

const NOOP = () => {};

/**
 * This digests a SystemObject, making it consumable by a bot to be run by
 * the engine. The system returned is itself callable - Think of it like a
 * wrapper + closure hidden metastate for your system objects.
 */
export default function createSystem(sys: EventReader<SystemObject>, opts: SystemOptions = {}): SystemWrapper<System> {
    const options = {
        ...sys.defaultOptions,
        ...opts,
    };

    const { stepIncrement = sys.type === 'agent' ? 8 : 2 } = options;

    const pauseSym = Symbol('pause');
    
    /**
     * create internal system, initialize state and behavior -
     * all future system convention enhancements should go here
     * 
     * @TODO this... doesn't copy non-enumerables.. is that bad?
     */
    const system: EventReader<System> & { [pauseSym]: boolean } = {
        type: 'agent',
        ...sys,
        [pauseSym]: false,
        pause() { this[pauseSym] = true; },
        unpause() { this[pauseSym] = false; },
        setup: sys.setup || (() => {}),
        state: options.state || {},
        setState: function setState(newState: object | ((currentState: any) => object)) {
            if (typeof newState === 'function') {
                this.state = newState(this.state);
            } else {
                this.state = { ...this.state, ...newState };
            }
        },
    };

    /**
     * closure-only state for use by the system wrapper
     */
    let _state: { stepIncrement: number; lastRan: number | null; currentFrame: number | null } = {
        stepIncrement,
        lastRan: null,
        currentFrame: null,
    };

    const _setState = function _setState(newState: Partial<typeof _state>) {
        _state = { ..._state, ...newState };
    };

    async function systemWrapper(world: World): Promise<any> {
        const { frame, events } = world.resources.get();
        const eventsWithHandlers = events.read(system.readerId!).filter(event => system[`on${pascalCase(event.name)}`]);
        
        if (system[pauseSym]) {
            return system.onStepPaused ? system.onStepPaused(world) : NOOP;
        }

        const handlerPromises = eventsWithHandlers.length > 0 ?
            eventsWithHandlers.map((event) => {
                if (event.name === 'step') {
                    _setState({ currentFrame: frame.getGameLoop() });

                    /* skip this system if not enough frames have passed since it last ran */
                    if ((system.type === 'agent') && _state.lastRan && _state.currentFrame! - _state.lastRan <= _state.stepIncrement) {
                        debugSilly(`skipping system ${system.name}: current loop frame: ${_state.currentFrame}, last ran: ${_state.lastRan}`);
                        return;
                    }
                    
                    _setState({ lastRan: _state.currentFrame });
                    // TODO(ts): create-error typings make `instanceof` narrow Error to never, so err stays any
                    return system[`on${pascalCase(event.name)}`](world, event.data, event)
                        .catch((err: any) => {
                            if (err instanceof GameEndedError) {
                                throw err;
                            } else if (err instanceof NodeSC2Error) {
                                debugSilly(`System onStep error: on${pascalCase(event.name)} in ${system.name}: `, err);
                            } else {
                                debug(`System onStep error: on${pascalCase(event.name)} in ${system.name}: `);
                                debug(err.message);
                                debug(err.stack);
                            }
                        });
                } else {
                    return system[`on${pascalCase(event.name)}`](world, event.data, event)
                        .catch((err: any) => {
                            if (err instanceof GameEndedError) {
                                throw err;
                            } else if (err instanceof NodeSC2Error) {
                                debugSilly(`Event handler error: on${pascalCase(event.name)} in ${system.name}: `, err);
                            } else {
                                debug(`Event handler error: on${pascalCase(event.name)} in ${system.name}: `);
                                debug(err.message);
                                debug(err.stack);
                            }
                        });
                }
            }) :
            [];

        return Promise.all(handlerPromises);
    }

    systemWrapper.setup = function(world: World, isLateSetup = false) {
        const { events } = world.resources.get();
        system.readerId = events.createReader(system.type);
        debugSilly(`readerId ${system.readerId} registered for initialized system ${systemWrapper.name}`);

        if (system.type === 'build' && system.buildOrder) {
            builderPlugin(system);
        } else if (system.type === 'unit') {
            unitPlugin(system);
        }

        if (isLateSetup) {
            if (system.setup) {
                system.setup(world);
            }

            return system.onGameStart ? system.onGameStart(world) : system.readerId;
        } else {
            return system.setup ? system.setup(world) : system.readerId;
        }
    };

    Object.defineProperty(systemWrapper, 'name', {
        value: `${system.name}Wrapper`,
        configurable: true,
    });

    systemWrapper._system = system;
    return systemWrapper;
}

