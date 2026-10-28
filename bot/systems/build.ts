import { createSystem, taskFunctions } from '@sc-bot/core';
import {
    BARRACKSTECHLAB,
    COMMANDCENTER,
    ENGINEERINGBAY,
    MARINE,
    REFINERY,
    SUPPLYDEPOT,
} from '@sc-bot/core/constants/unit-type';
import { SHIELDWALL, TERRANINFANTRYARMORSLEVEL1, TERRANINFANTRYWEAPONSLEVEL1 } from '@sc-bot/core/constants/upgrade';

const { build, train, upgrade } = taskFunctions;

export default createSystem({
    name: 'Build',
    type: 'build',
    buildOrder: [
        [16, build(REFINERY)],
        [19, build(COMMANDCENTER)],
        [20, build(REFINERY)],
        [26, upgrade(SHIELDWALL)],
        [26, build(COMMANDCENTER)],
        [26, upgrade(TERRANINFANTRYWEAPONSLEVEL1)],
        [26, upgrade(TERRANINFANTRYARMORSLEVEL1)],
    ],
});
