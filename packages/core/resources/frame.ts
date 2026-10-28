import type { FrameResource, ResourceDefinition } from '../types.ts';

import { GAME_LOOPS_PER_SECOND } from '../constants/time.ts';

function createFrame(): FrameResource {
    const stepTimes = { min: 0, max: 0, total: 0, count: 0, last: 0 };

    return {
        _gameLoop: 0,
        _gameInfo: null,
        _observation: null,
        _previous: null,
        _render: null,
        _feature: null,
        _score: null,
        _actionErrors: [],
        getObservation() {
            return this._observation!;
        },
        getRender() {
            return this._render!;
        },
        getFeatureLayer() {
            return this._feature!;
        },
        getScore() {
            return this._score ?? undefined;
        },
        getGameInfo() {
            return this._gameInfo!;
        },
        getGameLoop() {
            return this._gameLoop;
        },
        getEffects() {
            return this._observation!.rawData!.effects!;
        },
        getMapState() {
            return this._observation!.rawData!.mapState!;
        },
        getPrevious() {
            return this._previous ?? undefined;
        },
        time() {
            return this.getGameLoop() / GAME_LOOPS_PER_SECOND;
        },
        timeFormatted() {
            const seconds = this.time();
            return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
        },
        getAlerts() {
            return this._observation?.alerts ?? [];
        },
        hasAlert(alert) {
            return this.getAlerts().includes(alert);
        },
        getActionErrors() {
            return this._actionErrors;
        },
        getStepTime() {
            return {
                min: stepTimes.min,
                avg: stepTimes.count === 0 ? 0 : stepTimes.total / stepTimes.count,
                max: stepTimes.max,
                last: stepTimes.last,
            };
        },
        recordStepTime(milliseconds) {
            stepTimes.min = stepTimes.count === 0 ? milliseconds : Math.min(stepTimes.min, milliseconds);
            stepTimes.max = Math.max(stepTimes.max, milliseconds);
            stepTimes.total += milliseconds;
            stepTimes.count += 1;
            stepTimes.last = milliseconds;
        },
        resetStepTimes() {
            Object.assign(stepTimes, { min: 0, max: 0, total: 0, count: 0, last: 0 });
        },
    };
}

export const frameResource: ResourceDefinition<'frame'> = {
    name: 'frame',
    create: () => createFrame(),
    reset: (frame) => frame.resetStepTimes(),
};
