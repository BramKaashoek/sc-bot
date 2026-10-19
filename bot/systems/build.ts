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
        [17, train(MARINE, 2)],
        [19, build(COMMANDCENTER)],
        [22, train(MARINE, 4)],
        [25, build(REFINERY)],
        [26, build(BARRACKSTECHLAB)],
        [26, build(ENGINEERINGBAY)],
        [26, upgrade(SHIELDWALL)],
        [26, build(COMMANDCENTER)],
        [26, upgrade(TERRANINFANTRYWEAPONSLEVEL1)],
        [26, upgrade(TERRANINFANTRYARMORSLEVEL1)],
    ],
});
