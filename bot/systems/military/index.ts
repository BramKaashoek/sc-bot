import { createSystem } from '@sc-bot/core';
import { buildProduction } from './production.ts';
import { trainArmy, trainMarine } from './training.ts';
import { buildWall, manageWall } from './wall.ts';

export default createSystem({
    name: 'Military',
    async onStep({ agent, resources }) {
        await buildWall(agent, resources);
        await buildProduction(agent, resources);
        await trainArmy(agent, resources);
        await manageWall(agent, resources);
    },
});
