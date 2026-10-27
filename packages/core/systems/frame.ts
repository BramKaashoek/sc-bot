import createDebug from 'debug';
import createSystem from './create-system.ts';
import { GameEndedError } from '../engine/errors.ts';
import { Alliance } from '../constants/enums.ts';
import type { FrameSystem } from '../types.ts';

const debugFrame = createDebug('sc2:debug:frameSystem');

const createFrameSystem = (isRealtime: () => boolean): FrameSystem => ({
    name: 'FrameSystem',
    type: 'engine',
    async onGameStart({ resources }) {
        const {
            actions: { _client },
            frame,
        } = resources.get();

        const [gameInfo, responseObservation] = await Promise.all([_client!.gameInfo(), _client!.observation()]);

        frame._gameInfo = gameInfo;
        frame._gameLoop = responseObservation.observation!.gameLoop!;
        frame._observation = responseObservation.observation;
    },
    async onStep({ resources }, gameLoop?: number) {
        const {
            actions: { _client: client },
            frame,
            units,
            events,
        } = resources.get();

        const incFrameData = await Promise.all([
            // SC2 sends deadUnits/chat/acks/errors only once, so realtime must wait for the target loop here, not in the engine
            isRealtime() ? client.observation({ gameLoop }) : client.observation(),
        ]);

        if (incFrameData[0].playerResult!.length > 0) {
            debugFrame('exiting loop, results given from observation');
            throw new GameEndedError('Player results available in observation', { data: incFrameData[0].playerResult });
        }

        const [responseObservation] = incFrameData;

        const { observation, chat } = responseObservation;

        frame._previous = {
            _gameLoop: frame._gameLoop,
        };

        if (observation) {
            frame._gameLoop = observation.gameLoop!;
            frame._observation = observation;
            frame._result = responseObservation.playerResult;
            frame._render = observation.renderData!;
            frame._feature = observation.featureLayerData!;
            frame._score = observation.score;
        }

        frame._actionErrors = responseObservation.actionErrors ?? [];

        // @TODO: perf check this late game
        // @TODO: should the frame system be in charge of this? Command labels are set in the action builder
        const { actions } = responseObservation;
        if (actions!.length > 0) {
            actions!.forEach((action) => {
                action.actionRaw &&
                    action.actionRaw.unitCommand &&
                    action.actionRaw.unitCommand.unitTags!.forEach((unitTag) => {
                        units.getByTag(unitTag)?.removeLabel('command');
                    });
            });
        }

        // frame loop advances before units refresh, so getAlive-based lookups like withLabel are empty here
        const ownUnits = units.getAll(Alliance.SELF);
        ownUnits.forEach((unit) => {
            if (unit.hasLabel('stuck') && unit.isIdle()) unit.removeLabel('stuck');
        });

        const outstandingCommands = ownUnits.filter((unit) => unit.hasLabel('command'));
        outstandingCommands.forEach((unit) => {
            const frameCommanded = unit.getLabel('command');
            const frameDifference = observation!.gameLoop! - frameCommanded;
            if (frameDifference > 250) {
                debugFrame(`Outstanding unit command after ${frameDifference}ms!`);
                if (unit.isWorker()) {
                    unit.addLabel('stuck', true);
                }
                unit.removeLabel('command');
            }
        });

        if (chat!.length > 0) {
            chat!.forEach((line) => {
                events.write({
                    name: 'chatReceived',
                    data: line,
                });
            });
        }

        const { event } = responseObservation.observation!.rawData!;

        if (event && event.deadUnits!.length > 0) {
            // dead unit events also arrive for untracked things like projectiles
            const deadUnits = units.getByTag(event.deadUnits!);

            deadUnits.forEach((unit) => unit.labels.set('dead', true));
            // enemies are kept as memory after leaving vision, so a dead one would otherwise linger forever
            deadUnits.forEach((unit) => units._units[Alliance.ENEMY].delete(unit.tag!));

            deadUnits.forEach((unit) =>
                events.write({
                    name: 'unitDestroyed',
                    type: 'all',
                    data: unit,
                }),
            );
        }
    },
});

export default ({ isRealtime = () => false }: { isRealtime?: () => boolean } = {}) =>
    createSystem(createFrameSystem(isRealtime));
