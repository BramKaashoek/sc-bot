import { createSystem } from '@sc-bot/core';
import { defendTargets, getDefenseTargets } from './defense.ts';
import { attackTargets, getOffenseTargets } from './offense.ts';
import { scout } from './scout.ts';
import type { CombatState } from './types.ts';

export default createSystem({
    name: 'Combat',
    defaultOptions: { state: { defenses: {}, attacks: {}, scoutedEmpty: {}, scout: {} } as CombatState },
    async onStep({ resources }) {
        const defenseTargets = getDefenseTargets(resources);
        await defendTargets({ resources, defenseTargets, defenses: this.state.defenses, setState: this.setState });

        const offenseTargets = getOffenseTargets({ resources, scoutedEmpty: this.state.scoutedEmpty });
        await attackTargets({
            resources,
            offenseTargets,
            attacks: this.state.attacks,
            defenses: this.state.defenses,
            scoutedEmpty: this.state.scoutedEmpty,
            scoutTag: this.state.scout.tag,
            setState: this.setState,
        });

        await scout({
            resources,
            attacks: this.state.attacks,
            defenses: this.state.defenses,
            scoutedEmpty: this.state.scoutedEmpty,
            scout: this.state.scout,
            setState: this.setState,
        });
    },
    async onUnitCreated({ resources }, unit) {
        const { actions, map } = resources.get();
        if (unit.isCombatUnit()) {
            await actions.attackMove([unit], map.getCombatRally());
        }
    },
});
