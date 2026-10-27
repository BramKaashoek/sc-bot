import { styleText } from 'node:util';
import { createSystem, type Unit, type World } from '@sc-bot/core';
import { UnitTypeId, UpgradeId } from '@sc-bot/core/constants/index';
import { Alliance } from '@sc-bot/core/constants/enums';
import { GAME_LOOPS_PER_SECOND } from '@sc-bot/core/constants/time';

export const formatGameTime = (gameLoop: number) => {
    const seconds = Math.floor(gameLoop / GAME_LOOPS_PER_SECOND);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

type Style = Parameters<typeof styleText>[0];

export const log = (world: Pick<World, 'resources'>, message: string, style?: Style) => {
    const time = styleText('dim', formatGameTime(world.resources.get().frame.getGameLoop()));
    console.log(`${time} | ${style ? styleText(style, message) : message}`);
};

export const posOf = ({ x, y }: { x?: number; y?: number }) => `${x},${y}`;

let wallLogged = false;

export const nameOf = (unit: Unit) => UnitTypeId[unit.unitType] ?? `unit type ${unit.unitType}`;

export default createSystem({
    name: 'Log',
    async onStep(world) {
        if (wallLogged) return;
        wallLogged = true;
        const ramp = world.resources.get().map.getMainBaseRamp();
        const barracks = ramp?.barracksCorrectPlacement;
        log(
            world,
            `wall: barracks at ${barracks ? posOf(barracks) : 'none'} | depots at ${ramp?.cornerDepots.map(posOf).join(' and ') ?? 'none'}`,
            'dim',
        );
    },
    async onUnitCreated(world, unit) {
        if (!unit.isStructure()) log(world, `created ${nameOf(unit)}`, 'cyan');
    },
    async onBuildingConstructionStarted(world, building) {
        log(world, `building ${nameOf(building)} at ${posOf(building.pos)}`);
    },
    async onBuildingConstructionComplete(world, building) {
        log(world, `built ${nameOf(building)}`, 'green');
    },
    async onUnitDestroyed(world, unit) {
        if (unit.isMineralField()) {
            log(world, `mined out ${nameOf(unit)}`, 'dim');
            return;
        }
        const kind = unit.isStructure() ? 'building' : 'unit';
        const lost = unit.alliance === Alliance.SELF;
        log(world, `${lost ? 'lost' : 'killed'} ${kind} ${nameOf(unit)}`, lost ? 'red' : 'yellow');
    },
    async onUpgradeComplete(world, upgradeId) {
        log(world, `researched ${UpgradeId[upgradeId] ?? `upgrade ${upgradeId}`}`, 'green');
    },
});
