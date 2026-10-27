import { createSystem, taskFunctions } from '@sc-bot/core';
import type { World, Unit } from '@sc-bot/core';
import { Alliance } from '@sc-bot/core/constants/enums';
import { CHARGE } from '@sc-bot/core/constants/upgrade';
import { combatTypes } from '@sc-bot/core/constants/groups';
import {
    ASSIMILATOR,
    CYBERNETICSCORE,
    GATEWAY,
    NEXUS,
    TWILIGHTCOUNCIL,
    ZEALOT,
} from '@sc-bot/core/constants/unit-type';

const { build, upgrade } = taskFunctions;

const eightGateAllIn = createSystem({
    name: 'EightGateAllIn',
    type: 'build',
    defaultOptions: {
        state: { armySize: 12 },
    },
    buildOrder: [
        [16, build(ASSIMILATOR)],
        [17, build(GATEWAY)],
        [20, build(NEXUS)],
        [21, build(CYBERNETICSCORE)],
        [26, build(TWILIGHTCOUNCIL)],
        [34, upgrade(CHARGE)],
        [34, build(GATEWAY, 7)],
    ],
    async onStep({ resources }: World) {
        const { units, map, actions, debug } = resources.get();

        if (this.state.buildComplete) {
            const idleCombatUnits = units.getCombatUnits().filter((unit: Unit) => unit.noQueue);

            if (idleCombatUnits.length > this.state.armySize) {
                this.setState({ armySize: this.state.armySize + 2 });
                const [enemyMain, enemyNat] = map.getExpansions(Alliance.ENEMY);

                return Promise.all(
                    [enemyNat, enemyMain].map((expansion) => {
                        return actions.attackMove(idleCombatUnits, expansion.townhallPosition, true);
                    }),
                );
            }
        }

        const idleGateways = units.getById(GATEWAY, { alliance: Alliance.SELF, noQueue: true, buildProgress: 1 });

        if (idleGateways.length > 0) {
            return Promise.all(idleGateways.map((gateway: Unit) => actions.train(ZEALOT, gateway)));
        }
    },
    async buildComplete() {
        this.setState({ buildComplete: true });
    },
    async onUpgradeComplete({ resources }: World, upgrade: number) {
        if (upgrade === CHARGE) {
            const { units, map, actions } = resources.get();

            const combatUnits = units.getCombatUnits();
            const [enemyMain, enemyNat] = map.getExpansions(Alliance.ENEMY);

            return Promise.all(
                [enemyNat, enemyMain].map((expansion) => {
                    return actions.attackMove(combatUnits, expansion.townhallPosition, true);
                }),
            );
        }
    },
    async onUnitFinished({ resources }: World, newBuilding: Unit) {
        if (newBuilding.isGasMine()) {
            const { units, actions } = resources.get();

            const threeWorkers = units.getMineralWorkers().closestNUnits(newBuilding.pos, 3);
            threeWorkers.forEach((worker: Unit) => worker.labels.set('gasWorker', true));
            return actions.mine(threeWorkers, newBuilding);
        }
    },
    async onUnitCreated({ resources }: World, newUnit: Unit) {
        const { actions, map } = resources.get();

        if (newUnit.isWorker()) {
            return actions.gather(newUnit);
        } else if (combatTypes.includes(newUnit.unitType!)) {
            return actions.attackMove([newUnit], map.getCombatRally());
        }
    },
});

export default eightGateAllIn;
