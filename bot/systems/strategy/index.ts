import { createSystem } from '@sc-bot/core';
import { bio } from './bio.ts';
import type { Strategy } from './types.ts';

let currentStrategy: Strategy = bio;

export const getStrategy = () => currentStrategy;

export default createSystem({
    name: 'Strategy',
});
