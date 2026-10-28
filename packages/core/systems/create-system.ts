import createDebug from 'debug';
import pascalCase from 'pascal-case';
import unitPlugin from './unit-plugin.ts';
import { builderPlugin } from './builder-plugin.ts';
import { triageError } from '../engine/errors.ts';
import { NOOP } from '../utils/collections.ts';
import type {
    BuildSystemObject,
    EventReader,
    GeneralSystemObject,
    System,
    SystemObject,
    SystemOptions,
    SystemWrapper,
    UnitSystemObject,
    World,
} from '../types.ts';

const debug = createDebug('sc2:debug:system');
const debugSilly = createDebug('sc2:silly:system');

const logHandlerError = (label: string, err: Error) => {
    debug(label);
    debug(err.message);
    debug(err.stack);
};
const systemSinks = { expected: logHandlerError, unexpected: logHandlerError };
const debugState = createDebug('sc2:debug:state');

// structuredClone throws on functions and drops class prototypes, both of which users keep in system state
function clonePlain<T>(value: T): T {
    if (Array.isArray(value)) return value.map(clonePlain) as T;
    if (value instanceof Map) return new Map([...value].map(([key, entry]) => [key, clonePlain(entry)])) as T;
    if (value instanceof Set) return new Set([...value].map(clonePlain)) as T;
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clonePlain(entry)])) as T;
    }
    return value;
}

export default function createSystem(
    sys: UnitSystemObject | BuildSystemObject | GeneralSystemObject,
    opts?: SystemOptions,
): SystemWrapper<System>;
export default function createSystem(sys: EventReader<SystemObject>, opts?: SystemOptions): SystemWrapper<System>;
export default function createSystem(
    sys: UnitSystemObject | BuildSystemObject | GeneralSystemObject | EventReader<SystemObject>,
    opts: SystemOptions = {},
): SystemWrapper<System> {
    const options = {
        ...sys.defaultOptions,
        ...opts,
    };

    const { stepIncrement = sys.type === 'agent' ? 8 : 2 } = options;

    const pauseSym = Symbol('pause');

    // @TODO this... doesn't copy non-enumerables.. is that bad?
    const system: EventReader<System> & { [pauseSym]: boolean } = {
        type: 'agent',
        ...(sys as EventReader<SystemObject>),
        [pauseSym]: false,
        pause() {
            this[pauseSym] = true;
        },
        unpause() {
            this[pauseSym] = false;
        },
        setup: sys.setup || (() => {}),
        state: options.state || {},
        // closes over `system`, not `this`, so it works unbound like a useState setter
        setState(newState: object | ((currentState: any) => object)) {
            if (typeof newState === 'function') {
                system.state = newState(system.state);
            } else {
                system.state = { ...system.state, ...newState };
            }
            debugState('%s state: %o', system.name, system.state);
        },
    };

    let _state: { stepIncrement: number; lastRan: number | null; currentFrame: number | null } = {
        stepIncrement,
        lastRan: null,
        currentFrame: null,
    };

    const _setState = function _setState(newState: Partial<typeof _state>) {
        _state = { ..._state, ...newState };
    };

    const initialState = clonePlain({ ...options.state });
    let initialBuildOptions: System['buildOptions'];
    let setUpBefore = false;

    async function systemWrapper(world: World): Promise<any> {
        const { frame, events } = world.resources.get();
        const eventsWithHandlers = events
            .read(system.readerId!)
            .filter((event) => system[`on${pascalCase(event.name)}`]);

        if (system[pauseSym]) {
            return system.onStepPaused ? system.onStepPaused(world) : NOOP;
        }

        const handlerPromises =
            eventsWithHandlers.length > 0
                ? eventsWithHandlers.map((event) => {
                      if (event.name === 'step') {
                          _setState({ currentFrame: frame.getGameLoop() });

                          if (
                              system.type === 'agent' &&
                              _state.lastRan &&
                              _state.currentFrame! - _state.lastRan <= _state.stepIncrement
                          ) {
                              debugSilly(
                                  `skipping system ${system.name}: current loop frame: ${_state.currentFrame}, last ran: ${_state.lastRan}`,
                              );
                              return;
                          }

                          _setState({ lastRan: _state.currentFrame });
                          return system[`on${pascalCase(event.name)}`](world, event.data, event).catch((err: Error) =>
                              triageError(
                                  err,
                                  `System onStep error: on${pascalCase(event.name)} in ${system.name}: `,
                                  systemSinks,
                              ),
                          );
                      } else {
                          return system[`on${pascalCase(event.name)}`](world, event.data, event).catch((err: Error) =>
                              triageError(
                                  err,
                                  `Event handler error: on${pascalCase(event.name)} in ${system.name}: `,
                                  systemSinks,
                              ),
                          );
                      }
                  })
                : [];

        return Promise.all(handlerPromises);
    }

    systemWrapper.setup = function (world: World, isLateSetup = false) {
        const { events } = world.resources.get();
        _setState({ lastRan: null, currentFrame: null });
        system.readerId = events.createReader(system.type);
        debugSilly(`readerId ${system.readerId} registered for initialized system ${systemWrapper.name}`);

        if (setUpBefore) {
            system[pauseSym] = false;
            system.state = clonePlain(initialState);
            if (initialBuildOptions) system.buildOptions = { ...initialBuildOptions };
        } else if (system.type === 'build' && (system.buildOrder || system.openings)) {
            builderPlugin(system);
            initialBuildOptions = { ...system.buildOptions! };
        } else if (system.type === 'unit') {
            unitPlugin(system);
        }
        setUpBefore = true;

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

    systemWrapper.commandPriority = options.commandPriority ?? 0;
    systemWrapper._system = system;
    return systemWrapper;
}
