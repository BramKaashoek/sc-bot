import type { Unit } from '../types.ts';

export const NOOP = () => {};

export const asArray = <T>(x: T | T[]): T[] => (Array.isArray(x) ? x : [x]);

export const toTag = (unit: Unit | string): string => (typeof unit === 'string' ? unit : unit.tag!);

export const toTags = (units: Unit | string | Array<Unit | string>): string[] => asArray(units).map(toTag);
