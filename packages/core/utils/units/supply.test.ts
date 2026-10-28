import { describe, expect, it } from 'bun:test';
import { totalSupply } from './supply.ts';
import type { Unit } from '../../types.ts';

const unit = (foodRequired?: number) => ({ data: () => ({ foodRequired }) }) as unknown as Unit;

describe('totalSupply', () => {
    it('sums foodRequired, counting structures and missing values as 0', () => {
        expect(totalSupply([unit(2), unit(3), unit(0), unit()])).toBe(5);
        expect(totalSupply([])).toBe(0);
    });
});
