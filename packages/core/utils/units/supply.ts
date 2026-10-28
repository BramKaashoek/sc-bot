import type { Unit } from '../../types.ts';

export const totalSupply = (units: Iterable<Unit>): number => {
    let sum = 0;
    for (const unit of units) sum += unit.data().foodRequired ?? 0;
    return sum;
};
