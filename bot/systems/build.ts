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
    async onGameStart() {
        // train/worker tasks never release their earmarks, which leaks reserved minerals until nothing is affordable
        this.earmarkDelay(0);
    },
    buildOrder: [
        [16, build(REFINERY)],
        [19, build(COMMANDCENTER)],
        [25, build(REFINERY)],
        [26, upgrade(SHIELDWALL)],
        [26, build(COMMANDCENTER)],
        [26, upgrade(TERRANINFANTRYWEAPONSLEVEL1)],
        [26, upgrade(TERRANINFANTRYARMORSLEVEL1)],
    ],
});
