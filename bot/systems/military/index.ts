import { createSystem } from '@sc-bot/core';
import { buildAddons, buildProduction } from './production.ts';
import { trainArmy, trainMarine } from './training.ts';
import { buildWall, manageWall } from './wall.ts';

export default createSystem({
    name: 'Military',
    async onStep({ agent, resources, data }) {
        await buildWall(agent, resources);
        await buildProduction(agent, resources, data);
        await buildAddons(agent, resources, data)
        await trainArmy(agent, resources);
        await manageWall(agent, resources);
    },
});
