import { Alliance } from '../constants/enums.ts';
import * as UnitType from '../constants/unit-type.ts';
import createSystem from './create-system.ts';
import type { Debugger, System, SystemWrapper } from '../types.ts';

export type ChatCommand =
    | { kind: 'create' | 'kill'; count: number; unitType: number; playerId?: number }
    | { kind: 'cooldown' | 'food' | 'god' | 'resources' | 'showMap' | 'techTree' | 'upgrades' };

type GameStateKind = Exclude<ChatCommand['kind'], 'create' | 'kill'>;

const ALIASES: Record<string, ChatCommand['kind']> = {
    CREATE: 'create',
    MAKE: 'create',
    KILL: 'kill',
    DESTROY: 'kill',
    COOLDOWN: 'cooldown',
    FOOD: 'food',
    SUPPLY: 'food',
    GOD: 'god',
    RESOURCES: 'resources',
    MONEY: 'resources',
    REVEAL: 'showMap',
    SHOW: 'showMap',
    'SHOW-MAP': 'showMap',
    TECH: 'techTree',
    'TECH-TREE': 'techTree',
    UPGRADES: 'upgrades',
};

const GAME_STATE: Record<GameStateKind, (debug: Debugger) => Promise<unknown>> = {
    cooldown: (debug) => debug.cooldown(),
    food: (debug) => debug.food(),
    god: (debug) => debug.god(),
    resources: (debug) => debug.allResources(),
    showMap: (debug) => debug.showMap(),
    techTree: (debug) => debug.techTree(),
    upgrades: (debug) => debug.upgrade(),
};

const unitTypeByName = UnitType as Record<string, unknown>;

function unitTypeOf(name: string): number | undefined {
    const found = [name, name.replace(/S$/, '')].map((candidate) => unitTypeByName[candidate]);
    return found.find((value): value is number => typeof value === 'number');
}

const positiveInteger = (token: string) => (/^\d+$/.test(token) && Number(token) > 0 ? Number(token) : undefined);

export function parseChatCommand(message: string): ChatCommand | { error: string } | null {
    const tokens = message.trim().toUpperCase().split(/\s+/);
    const kind = ALIASES[tokens[0]];
    if (kind === undefined) return null;
    if (kind !== 'create' && kind !== 'kill') return { kind };

    if (tokens.length < 3 || tokens.length > 4) {
        return { error: `Usage: ${kind} <count> <UnitTypeName> [playerId]` };
    }
    const count = positiveInteger(tokens[1]);
    if (count === undefined) return { error: `Not a valid count: ${tokens[1]}` };
    const unitType = unitTypeOf(tokens[2]);
    if (unitType === undefined) return { error: `Not a valid UnitTypeId: ${tokens[2]}` };
    if (tokens.length === 3) return { kind, count, unitType };
    const playerId = positiveInteger(tokens[3]);
    if (playerId === undefined) return { error: `Not a valid player id: ${tokens[3]}` };
    return { kind, count, unitType, playerId };
}

export default function createChatDebugSystem(): SystemWrapper<System> {
    return createSystem({
        name: 'ChatDebugSystem',
        type: 'agent',
        async onChatReceived(world, chat) {
            if (chat.playerId !== world.agent.playerId) return;
            const command = parseChatCommand(chat.message ?? '');
            if (command === null) return;

            const { actions, debug, frame, map, units } = world.resources.get();
            if ('error' in command) return actions.chatSend(command.error);

            if (command.kind === 'create') {
                const camera = frame.getObservation().rawData?.player?.camera;
                const pos = camera ? { x: camera.x!, y: camera.y! } : map.getCenter(true);
                return debug!.createUnit({
                    unitType: command.unitType,
                    quantity: command.count,
                    pos,
                    playerId: command.playerId ?? world.agent.playerId,
                });
            }

            if (command.kind === 'kill') {
                const { playerId } = command;
                const own = playerId === undefined || playerId === world.agent.playerId;
                const candidates = own
                    ? units.getAlive(Alliance.SELF)
                    : units.getAlive(Alliance.ENEMY).filter((unit) => unit.owner === playerId);
                const victims = candidates.filter((unit) => unit.unitType === command.unitType).slice(0, command.count);
                if (victims.length === 0) return actions.chatSend("Can't find any of those");
                return debug!.killUnit(victims);
            }

            return GAME_STATE[command.kind](debug!);
        },
    });
}
