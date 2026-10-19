import type { Point2D, Unit, Units } from '@sc-bot/core';

export type Tick = number;
export type Tag = string;
export type StringPosition = string; // 'x,y'

export type DefenseTarget = { base: Unit; enemies: Units };
export type OffenseTarget = { pos: Point2D; buildings: Units; units: Units; score: number };
export type CombatState = {
    defenses: { [baseTag: Tag]: { unitTags: Tag[] } };
    attacks: { [position: StringPosition]: { unitTags: Tag[] } };
    retreats: { [position: StringPosition]: { unitTags: Tag[]; enemyCost: number; at: Tick } };
    scoutedEmpty: { [expansion: number]: Tick };
    scout: { tag?: Tag; lastDiedAt?: Tick };
};
