import type { Behavior, BehaviorContext } from '../types.ts';

export function plan(...behaviors: Behavior[]): Behavior {
    const executeFrom = (ctx: BehaviorContext, index: number): boolean | Promise<boolean> => {
        for (let i = index; i < behaviors.length; i += 1) {
            const result = behaviors[i].execute(ctx);
            if (typeof (result as PromiseLike<boolean>)?.then === 'function') {
                return Promise.resolve(result).then((done) => done || executeFrom(ctx, i + 1));
            }
            if (result) return true;
        }
        return false;
    };

    return {
        name: `plan(${behaviors.map(({ name }) => name).join(', ')})`,
        execute: (ctx) => executeFrom(ctx, 0),
    };
}
