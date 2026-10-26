import { describe, expect, it } from 'bun:test';
import { arbitrate, type Committed, type Proposal } from './command-arbiter.ts';

const MOVE = 16;
const ATTACK = 23;

let nextSeq = 0;
function proposal(
    owner: string,
    command: SC2APIProtocol.ActionRawUnitCommand,
    { priority = 0, rank = 0 }: { priority?: number; rank?: number } = {},
): Proposal {
    nextSeq += 1;
    return { owner, priority, rank, seq: nextSeq, command };
}

const move = (unitTags: string[], x = 1, queueCommand = false): SC2APIProtocol.ActionRawUnitCommand => ({
    abilityId: MOVE,
    unitTags,
    targetWorldSpacePos: { x, y: 1 },
    queueCommand,
});

const never = () => false;
const none: Committed = new Map();

describe('arbitrate', () => {
    it('gives a tag to the higher priority, then the lower rank, and drops all of the loser commands', () => {
        const economy = proposal('economy', move(['a'], 1), { priority: 0, rank: 0 });
        const queued = proposal('economy', move(['a'], 3, true), { priority: 0, rank: 0 });
        const defense = proposal('defense', move(['a'], 2), { priority: 5, rank: 1 });
        const late = proposal('late', move(['b'], 4), { rank: 3 });
        const early = proposal('early', move(['b'], 5), { rank: 1 });

        const { commands, dropped } = arbitrate([economy, queued, defense, late, early], none, never);

        expect(commands.map(({ command }) => command)).toEqual([move(['a'], 2), move(['b'], 5)]);
        expect(dropped).toEqual([
            { proposal: economy, tags: ['a'], reason: 'outranked', by: 'defense' },
            { proposal: queued, tags: ['a'], reason: 'outranked', by: 'defense' },
            { proposal: late, tags: ['b'], reason: 'outranked', by: 'early' },
        ]);
    });

    it('reports only the tags a multi-unit proposal lost and sends the rest', () => {
        const group = proposal('army', move(['a', 'b', 'c'], 1), { rank: 2 });
        const grab = proposal('defense', move(['b'], 2), { rank: 1 });

        const { commands, dropped } = arbitrate([group, grab], none, never);

        expect(commands).toEqual([
            { command: move(['a', 'c'], 1), covers: [{ proposal: group, tags: ['a', 'c'] }] },
            { command: move(['b'], 2), covers: [{ proposal: grab, tags: ['b'] }] },
        ]);
        expect(dropped).toEqual([{ proposal: group, tags: ['b'], reason: 'outranked', by: 'defense' }]);
    });

    it('lets only a strictly higher commander or the committing owner take a committed tag', () => {
        const raw = { owner: 'raw', priority: 1, rank: 2 };
        const committed: Committed = new Map(['a', 'b', 'c', 'd'].map((tag) => [tag, raw]));
        const equal = proposal('equal', move(['a'], 1), { priority: 1, rank: 2 });
        const higherRank = proposal('higher-rank', move(['b'], 2), { priority: 1, rank: 1 });
        const higherPriority = proposal('higher-priority', move(['c'], 3), { priority: 2, rank: 9 });
        const sameOwner = proposal('raw', move(['d'], 4, true), { priority: 1, rank: 2 });
        committed.set('e', { owner: 'combat', priority: 5, rank: 0 });
        const demoted = proposal('combat', move(['e'], 5, true), { priority: 0, rank: 5 });
        const between = proposal('scout', move(['e'], 6), { priority: 3, rank: 1 });

        const { commands, dropped } = arbitrate(
            [equal, higherRank, higherPriority, sameOwner, demoted, between],
            committed,
            never,
        );

        expect(commands.map(({ command }) => command)).toEqual([
            move(['b'], 2),
            move(['c'], 3),
            move(['d'], 4, true),
            move(['e'], 5, true),
        ]);
        expect(dropped).toEqual([
            { proposal: equal, tags: ['a'], reason: 'outranked', by: 'raw' },
            { proposal: between, tags: ['e'], reason: 'outranked', by: 'combat' },
        ]);
    });

    it('drops the winner commands the repeat check flags, with reason repeat, and never checks losers', () => {
        const order = proposal('combat', move(['a', 'b'], 1), { rank: 1 });
        const loser = proposal('scout', move(['a'], 2), { rank: 2 });
        const isRepeat = (_: SC2APIProtocol.ActionRawUnitCommand, tag: string) => tag === 'a';

        const { commands, dropped } = arbitrate([order, loser], none, isRepeat);

        expect(commands.map(({ command }) => command)).toEqual([move(['b'], 1)]);
        expect(dropped).toEqual([
            { proposal: order, tags: ['a'], reason: 'repeat' },
            { proposal: loser, tags: ['a'], reason: 'outranked', by: 'combat' },
        ]);
    });

    it('merges identical single commands across tags and proposals', () => {
        const one = proposal('army', move(['a'], 5));
        const two = proposal('scout', move(['b', 'c'], 5));
        const other = proposal('army', move(['d'], 6));
        const queued = proposal('army', move(['e'], 5, true));
        const attack = proposal('army', { abilityId: ATTACK, unitTags: ['f'], targetUnitTag: 'enemy' });

        const { commands } = arbitrate([one, two, other, queued, attack], none, never);

        expect(commands).toEqual([
            {
                command: move(['a', 'b', 'c'], 5),
                covers: [
                    { proposal: one, tags: ['a'] },
                    { proposal: two, tags: ['b', 'c'] },
                ],
            },
            { command: move(['d'], 6), covers: [{ proposal: other, tags: ['d'] }] },
            { command: move(['e'], 5, true), covers: [{ proposal: queued, tags: ['e'] }] },
            { command: attack.command, covers: [{ proposal: attack, tags: ['f'] }] },
        ]);
    });

    it('emits a tag with several commands unmerged, in issue order', () => {
        const first = proposal('army', move(['a', 'b'], 1));
        const followUp = proposal('army', move(['a'], 2, true));
        const alone = proposal('army', move(['c'], 2, true));

        const { commands } = arbitrate([followUp, alone, first], none, never);

        expect(commands).toEqual([
            { command: move(['b'], 1), covers: [{ proposal: first, tags: ['b'] }] },
            { command: move(['a'], 1), covers: [{ proposal: first, tags: ['a'] }] },
            { command: move(['a'], 2, true), covers: [{ proposal: followUp, tags: ['a'] }] },
            { command: move(['c'], 2, true), covers: [{ proposal: alone, tags: ['c'] }] },
        ]);
    });
});
