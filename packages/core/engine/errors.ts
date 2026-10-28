import createError from 'create-error';

type ErrorClass<Name extends string> = new (
    message?: string | Error,
    properties?: object,
) => Error & { readonly name: Name };

const nodeSc2Error = createError('NodeSC2Error');
const actionManagerError = createError(nodeSc2Error, 'ActionManagerError');

const defaultProps = { data: {}, status: 0 };

const BuildError = createError(actionManagerError, 'BuildError', defaultProps) as unknown as ErrorClass<'BuildError'>;
const TrainError = createError(actionManagerError, 'TrainError', defaultProps) as unknown as ErrorClass<'TrainError'>;
const GatherError = createError(
    actionManagerError,
    'GatherError',
    defaultProps,
) as unknown as ErrorClass<'GatherError'>;

const MapDecompositionError = createError(
    nodeSc2Error,
    'MapDecompositionError',
) as unknown as ErrorClass<'MapDecompositionError'>;
const GameEndedError = createError('GameEndedError') as unknown as ErrorClass<'GameEndedError'>;
const ConnectionClosedError = createError('ConnectionClosedError') as unknown as ErrorClass<'ConnectionClosedError'>;

const ActionManagerError = actionManagerError as unknown as ErrorClass<
    'ActionManagerError' | 'BuildError' | 'TrainError' | 'GatherError'
>;
const NodeSC2Error = nodeSc2Error as unknown as ErrorClass<
    'NodeSC2Error' | 'ActionManagerError' | 'BuildError' | 'TrainError' | 'GatherError' | 'MapDecompositionError'
>;

const isFatalGameError = (err: unknown): boolean =>
    err instanceof GameEndedError || err instanceof ConnectionClosedError;

type TriageSinks = {
    expected: (message: string, err: Error) => void;
    unexpected: (message: string, err: Error) => void;
};

function triageError(err: unknown, label: string, sinks: TriageSinks): void {
    if (isFatalGameError(err)) throw err;
    if (err instanceof NodeSC2Error) sinks.expected(label, err);
    else sinks.unexpected(label, err as Error);
}

const stub = (name: string) => (): never => {
    throw new NodeSC2Error(`not implemented: ${name}`);
};

export {
    stub,
    isFatalGameError,
    triageError,
    GameEndedError,
    ConnectionClosedError,
    NodeSC2Error,
    MapDecompositionError,
    ActionManagerError,
    BuildError,
    TrainError,
    GatherError,
};
