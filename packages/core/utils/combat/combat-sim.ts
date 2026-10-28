import { GUARDIANSHIELD, RAVENSHREDDERMISSILETINT, STIMPACK, STIMPACKMARAUDER } from '../../constants/buff.ts';
import {
    type EngagementResult,
    LOSS_CLOSE,
    LOSS_DECISIVE,
    LOSS_EMPHATIC,
    LOSS_MARGINAL,
    LOSS_OVERWHELMING,
    TIE,
    VICTORY_CLOSE,
    VICTORY_DECISIVE,
    VICTORY_EMPHATIC,
    VICTORY_MARGINAL,
    VICTORY_OVERWHELMING,
} from '../../constants/engagement-result.ts';
import { SIEGETANKSIEGED } from '../../constants/unit-type.ts';
import { distance } from '../geometry/point.ts';
import { isFlying } from '../geometry/units.ts';
import type { Unit } from '../../types.ts';

export type FightOptions = {
    timingAdjust?: boolean;
    workersDoNoDamage?: boolean;
    maxSeconds?: number;
};

export type FightSimulation = {
    ownWins: boolean;
    ownHealthLeft: number;
    enemyHealthLeft: number;
    ownHealthStart: number;
    enemyHealthStart: number;
    seconds: number;
};

const TICK = 0.25;
const SIEGED_TANK_MIN_RANGE = 2;

type Side = {
    units: Unit[];
    hp: Float64Array;
    pending: Float64Array;
    start: Float64Array;
    minRange: Float64Array;
    order: Int32Array;
    attackerKey: Int32Array;
    targetKey: Int32Array;
    attackers: Unit[];
    targets: Unit[];
    alive: number;
    byHp: (a: number, b: number) => number;
};

type Matrix = { dps: Float64Array; range: Float64Array; width: number };

function keyed(units: Unit[], keyOf: (unit: Unit) => string): { keys: Int32Array; representatives: Unit[] } {
    const indices = new Map<string, number>();
    const representatives: Unit[] = [];
    const keys = Int32Array.from(units, (unit) => {
        const key = keyOf(unit);
        let index = indices.get(key);
        if (index === undefined) {
            index = representatives.push(unit) - 1;
            indices.set(key, index);
        }
        return index;
    });
    return { keys, representatives };
}

function createSide(units: Unit[]): Side {
    const hp = Float64Array.from(units, (unit) => (unit.health ?? 0) + (unit.shield ?? 0));
    const attackers = keyed(
        units,
        (unit) =>
            `${unit.unitType}:${unit.attackUpgradeLevel ?? 0}:${unit.hasBuff(STIMPACK) || unit.hasBuff(STIMPACKMARAUDER)}:${unit.isFinished()}:${unit.isActive}`,
    );
    const targets = keyed(
        units,
        (unit) =>
            `${unit.unitType}:${unit.armorUpgradeLevel ?? 0}:${isFlying(unit)}:${unit.hasBuff(GUARDIANSHIELD)}:${unit.hasBuff(RAVENSHREDDERMISSILETINT)}:${(unit.shield ?? 0) > 0}`,
    );
    return {
        units,
        hp,
        pending: new Float64Array(units.length),
        start: new Float64Array(units.length),
        minRange: Float64Array.from(units, (unit) => (unit.unitType === SIEGETANKSIEGED ? SIEGED_TANK_MIN_RANGE : 0)),
        order: Int32Array.from(units, (_, index) => index),
        attackerKey: attackers.keys,
        targetKey: targets.keys,
        attackers: attackers.representatives,
        targets: targets.representatives,
        alive: hp.reduce((count, value) => (value > 0 ? count + 1 : count), 0),
        byHp: (a, b) => hp[a] - hp[b] || a - b,
    };
}

function createMatrix(attackers: Side, targets: Side, workersDoNoDamage: boolean): Matrix {
    const width = targets.targets.length;
    const dps = new Float64Array(attackers.attackers.length * width);
    const range = new Float64Array(attackers.attackers.length * width);
    attackers.attackers.forEach((attacker, row) => {
        if (workersDoNoDamage && attacker.isWorker()) return;
        targets.targets.forEach((target, column) => {
            dps[row * width + column] = attacker.calculateDpsVsTarget(target, false, true);
            range[row * width + column] = attacker.calculateDamageVsTarget(target, false, true)[2];
        });
    });
    return { dps, range, width };
}

const gapBetween = (attacker: Unit, target: Unit) =>
    distance(attacker.pos, target.pos) - (attacker.radius ?? 0) - (target.radius ?? 0);

const tooClose = (attackers: Side, i: number, targets: Side, j: number) =>
    attackers.minRange[i] > 0 && gapBetween(attackers.units[i], targets.units[j]) < attackers.minRange[i];

function setStartTimes(attackers: Side, targets: Side, matrix: Matrix): void {
    attackers.units.forEach((attacker, i) => {
        const row = attackers.attackerKey[i] * matrix.width;
        const speed = attacker.realSpeed();
        let start = Infinity;
        targets.units.forEach((target, j) => {
            const cell = row + targets.targetKey[j];
            if (matrix.dps[cell] <= 0 || tooClose(attackers, i, targets, j)) return;
            const gap = Math.max(0, gapBetween(attacker, target) - matrix.range[cell]);
            const closing = speed > 0 ? speed : target.realSpeed();
            start = Math.min(start, gap === 0 ? 0 : closing > 0 ? gap / closing : Infinity);
        });
        attackers.start[i] = start;
    });
}

function assignFire(attackers: Side, targets: Side, matrix: Matrix, time: number): boolean {
    let canDamage = false;
    for (let i = 0; i < attackers.units.length; i += 1) {
        if (attackers.hp[i] <= 0 || attackers.start[i] === Infinity) continue;
        const row = attackers.attackerKey[i] * matrix.width;
        for (let k = 0; k < targets.order.length; k += 1) {
            const j = targets.order[k];
            if (targets.hp[j] <= 0) continue;
            const dps = matrix.dps[row + targets.targetKey[j]];
            if (dps <= 0 || tooClose(attackers, i, targets, j)) continue;
            canDamage = true;
            if (attackers.start[i] > time) break;
            if (targets.hp[j] - targets.pending[j] > 0) {
                targets.pending[j] += dps * TICK;
                break;
            }
        }
    }
    return canDamage;
}

function applyDamage(side: Side): void {
    for (let i = 0; i < side.units.length; i += 1) {
        if (side.pending[i] === 0 || side.hp[i] <= 0) continue;
        side.hp[i] -= side.pending[i];
        if (side.hp[i] <= 0) side.alive -= 1;
    }
}

const healthLeft = (side: Side) => side.hp.reduce((total, value) => total + Math.max(0, value), 0);

export function simulateFight(
    own: Unit[],
    enemy: Unit[],
    { timingAdjust = true, workersDoNoDamage = false, maxSeconds = 60 }: FightOptions = {},
): FightSimulation {
    const ownSide = createSide(own);
    const enemySide = createSide(enemy);
    const ownHealthStart = healthLeft(ownSide);
    const enemyHealthStart = healthLeft(enemySide);
    const ownMatrix = createMatrix(ownSide, enemySide, workersDoNoDamage);
    const enemyMatrix = createMatrix(enemySide, ownSide, workersDoNoDamage);
    if (timingAdjust) {
        setStartTimes(ownSide, enemySide, ownMatrix);
        setStartTimes(enemySide, ownSide, enemyMatrix);
    }

    let seconds = 0;
    while (seconds < maxSeconds && ownSide.alive > 0 && enemySide.alive > 0) {
        ownSide.order.sort(ownSide.byHp);
        enemySide.order.sort(enemySide.byHp);
        ownSide.pending.fill(0);
        enemySide.pending.fill(0);
        const ownCanDamage = assignFire(ownSide, enemySide, ownMatrix, seconds);
        const enemyCanDamage = assignFire(enemySide, ownSide, enemyMatrix, seconds);
        if (!ownCanDamage && !enemyCanDamage) break;
        applyDamage(ownSide);
        applyDamage(enemySide);
        seconds += TICK;
    }

    const ownHealthLeft = healthLeft(ownSide);
    const enemyHealthLeft = healthLeft(enemySide);
    const ownWins =
        ownSide.alive > 0 &&
        (enemySide.alive === 0 || ownHealthLeft / ownHealthStart > enemyHealthLeft / enemyHealthStart);
    return { ownWins, ownHealthLeft, enemyHealthLeft, ownHealthStart, enemyHealthStart, seconds };
}

export function toEngagementResult({
    ownWins,
    ownHealthLeft,
    enemyHealthLeft,
    ownHealthStart,
    enemyHealthStart,
}: FightSimulation): EngagementResult {
    if (ownHealthStart === 0) return enemyHealthStart === 0 ? TIE : LOSS_EMPHATIC;
    const ownFraction = ownHealthLeft / ownHealthStart;
    if (ownWins) {
        if (ownFraction >= 0.9) return VICTORY_EMPHATIC;
        if (ownFraction >= 0.75) return VICTORY_OVERWHELMING;
        if (ownFraction >= 0.6) return VICTORY_DECISIVE;
        if (ownFraction > 0.4) return VICTORY_CLOSE;
        if (ownFraction > 0.2) return VICTORY_MARGINAL;
        return TIE;
    }
    const enemyFraction = enemyHealthLeft / enemyHealthStart;
    if (enemyFraction === ownFraction) return TIE;
    if (enemyFraction >= 0.9) return LOSS_EMPHATIC;
    if (enemyFraction >= 0.75) return LOSS_OVERWHELMING;
    if (enemyFraction > 0.6) return LOSS_DECISIVE;
    if (enemyFraction > 0.4) return LOSS_CLOSE;
    if (enemyFraction > 0.2) return LOSS_MARGINAL;
    return TIE;
}

export function canWinFight(own: Unit[], enemy: Unit[], opts?: FightOptions): EngagementResult {
    return toEngagementResult(simulateFight(own, enemy, opts));
}
