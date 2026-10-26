import type { CommandContext } from './command-context.ts';

export type Proposal = CommandContext & {
    command: SC2APIProtocol.ActionRawUnitCommand;
    seq: number;
};

export type Committed = Map<string, CommandContext>;

export type Dropped<P extends Proposal = Proposal> = {
    proposal: P;
    tags: string[];
    reason: 'outranked' | 'repeat';
    by?: string;
};

export type Emitted<P extends Proposal = Proposal> = {
    command: SC2APIProtocol.ActionRawUnitCommand;
    covers: { proposal: P; tags: string[] }[];
};

const outranks = (a: CommandContext, b: CommandContext): boolean =>
    a.priority > b.priority || (a.priority === b.priority && a.rank < b.rank);

const mergeKey = ({
    abilityId,
    targetUnitTag,
    targetWorldSpacePos,
    queueCommand,
}: SC2APIProtocol.ActionRawUnitCommand) =>
    JSON.stringify([abilityId, targetUnitTag, targetWorldSpacePos?.x, targetWorldSpacePos?.y, !!queueCommand]);

export function arbitrate<P extends Proposal>(
    proposals: P[],
    committed: Committed,
    isRepeat: (command: SC2APIProtocol.ActionRawUnitCommand, tag: string) => boolean,
): { commands: Emitted<P>[]; dropped: Dropped<P>[] } {
    const ordered = [...proposals].sort((a, b) => a.seq - b.seq);

    const byTag = new Map<string, P[]>();
    ordered.forEach((proposal) => {
        new Set(proposal.command.unitTags ?? []).forEach((tag) =>
            byTag.set(tag, [...(byTag.get(tag) ?? []), proposal]),
        );
    });

    const drops: { proposal: P; tag: string; reason: Dropped['reason']; by?: string }[] = [];
    const kept = new Map<string, P[]>();

    byTag.forEach((candidates, tag) => {
        const best = candidates.reduce((top, proposal) => (outranks(proposal, top) ? proposal : top));
        const holder = committed.get(tag);
        const owner = holder && !outranks(best, holder) ? holder.owner : best.owner;

        const survivors = candidates.filter((proposal) => {
            if (proposal.owner !== owner) {
                drops.push({ proposal, tag, reason: 'outranked', by: owner });
                return false;
            }
            if (isRepeat(proposal.command, tag)) {
                drops.push({ proposal, tag, reason: 'repeat' });
                return false;
            }
            return true;
        });
        if (survivors.length > 0) kept.set(tag, survivors);
    });

    const grouped = new Map<P, Map<string, Dropped<P>>>();
    drops.forEach(({ proposal, tag, reason, by }) => {
        const groups = grouped.get(proposal) ?? new Map<string, Dropped<P>>();
        grouped.set(proposal, groups);
        const key = JSON.stringify([reason, by]);
        const group =
            groups.get(key) ?? (by === undefined ? { proposal, tags: [], reason } : { proposal, tags: [], reason, by });
        groups.set(key, group);
        group.tags.push(tag);
    });
    const dropped = [...grouped.values()].flatMap((groups) => [...groups.values()]);

    const singles = new Map<
        string,
        { seq: number; covers: Map<P, string[]>; command: SC2APIProtocol.ActionRawUnitCommand }
    >();
    const multiples = new Map<P, string[]>();
    kept.forEach((survivors, tag) => {
        if (survivors.length > 1) {
            survivors.forEach((proposal) => multiples.set(proposal, [...(multiples.get(proposal) ?? []), tag]));
            return;
        }
        const [proposal] = survivors;
        const key = mergeKey(proposal.command);
        const group = singles.get(key) ?? { seq: proposal.seq, covers: new Map(), command: proposal.command };
        singles.set(key, group);
        group.seq = Math.min(group.seq, proposal.seq);
        group.covers.set(proposal, [...(group.covers.get(proposal) ?? []), tag]);
    });

    const emitted: (Emitted<P> & { seq: number })[] = [];
    singles.forEach(({ seq, covers, command }) => {
        const entries = [...covers].map(([proposal, tags]) => ({ proposal, tags }));
        emitted.push({ seq, command: { ...command, unitTags: entries.flatMap(({ tags }) => tags) }, covers: entries });
    });
    multiples.forEach((tags, proposal) => {
        emitted.push({
            seq: proposal.seq,
            command: { ...proposal.command, unitTags: tags },
            covers: [{ proposal, tags }],
        });
    });

    return {
        commands: emitted.sort((a, b) => a.seq - b.seq).map(({ command, covers }) => ({ command, covers })),
        dropped: dropped.sort((a, b) => a.proposal.seq - b.proposal.seq),
    };
}
