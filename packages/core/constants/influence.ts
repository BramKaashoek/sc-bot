import * as Effect from './effect.ts';
import * as UnitType from './unit-type.ts';
import type { InfluenceLayer } from '../types.ts';

export type WeightCost = { airCost: number; groundCost: number; airRange: number; groundRange: number };

export type InfluenceSource = {
    weight: number;
    range: number;
    buffer?: 'rangeBuffer' | 'effectsRangeBuffer';
    layers: readonly InfluenceLayer[];
};

export type StaticDefenseSource = InfluenceSource & {
    requiresPower?: true;
    upgradedRange?: { range: number; afterSeconds: number };
};

export type EffectInfluence = { layers: readonly InfluenceLayer[]; perPosition?: true };

const ALL_LAYERS = ['ground', 'air', 'groundAvoidance', 'airAvoidance'] as const;

export const INFLUENCE_DEFAULTS = { rangeBuffer: 4, effectsRangeBuffer: 1, costMultiplier: 1 };

export const WEIGHT_COSTS: Record<number, WeightCost> = {
    [UnitType.ADEPT]: { airCost: 0, groundCost: 9, airRange: 0, groundRange: 5 },
    [UnitType.ADEPTPHASESHIFT]: { airCost: 0, groundCost: 9, airRange: 0, groundRange: 5 },
    [UnitType.ARCHON]: { airCost: 40, groundCost: 40, airRange: 3, groundRange: 3 },
    [UnitType.BANELING]: { airCost: 0, groundCost: 20, airRange: 0, groundRange: 3 },
    [UnitType.BANSHEE]: { airCost: 0, groundCost: 12, airRange: 0, groundRange: 6 },
    [UnitType.BATTLECRUISER]: { airCost: 31, groundCost: 50, airRange: 6, groundRange: 6 },
    [UnitType.CARRIER]: { airCost: 20, groundCost: 20, airRange: 11, groundRange: 11 },
    [UnitType.CORRUPTOR]: { airCost: 10, groundCost: 0, airRange: 6, groundRange: 0 },
    [UnitType.CYCLONE]: { airCost: 27, groundCost: 27, airRange: 7, groundRange: 7 },
    [UnitType.GHOST]: { airCost: 10, groundCost: 10, airRange: 6, groundRange: 6 },
    [UnitType.HELLION]: { airCost: 0, groundCost: 8, airRange: 0, groundRange: 8 },
    [UnitType.HYDRALISK]: { airCost: 20, groundCost: 20, airRange: 6, groundRange: 6 },
    [UnitType.INFESTOR]: { airCost: 30, groundCost: 30, airRange: 10, groundRange: 10 },
    [UnitType.LIBERATOR]: { airCost: 10, groundCost: 0, airRange: 5, groundRange: 0 },
    [UnitType.MARINE]: { airCost: 10, groundCost: 10, airRange: 5, groundRange: 5 },
    [UnitType.MOTHERSHIP]: { airCost: 23, groundCost: 23, airRange: 7, groundRange: 7 },
    [UnitType.MUTALISK]: { airCost: 8, groundCost: 8, airRange: 3, groundRange: 3 },
    [UnitType.ORACLE]: { airCost: 0, groundCost: 24, airRange: 0, groundRange: 4 },
    [UnitType.PHOENIX]: { airCost: 15, groundCost: 0, airRange: 7, groundRange: 0 },
    [UnitType.QUEEN]: { airCost: 12.6, groundCost: 11.2, airRange: 7, groundRange: 5 },
    [UnitType.SENTRY]: { airCost: 8.4, groundCost: 8.4, airRange: 5, groundRange: 5 },
    [UnitType.STALKER]: { airCost: 10, groundCost: 10, airRange: 6, groundRange: 6 },
    [UnitType.TEMPEST]: { airCost: 17, groundCost: 17, airRange: 14, groundRange: 10 },
    [UnitType.THOR]: { airCost: 28, groundCost: 28, airRange: 11, groundRange: 7 },
    [UnitType.VIKINGASSAULT]: { airCost: 0, groundCost: 17, airRange: 0, groundRange: 6 },
    [UnitType.VIKINGFIGHTER]: { airCost: 14, groundCost: 0, airRange: 9, groundRange: 0 },
    [UnitType.VOIDRAY]: { airCost: 20, groundCost: 20, airRange: 6, groundRange: 6 },
    [UnitType.WIDOWMINEBURROWED]: { airCost: 150, groundCost: 150, airRange: 5.5, groundRange: 5.5 },
};

export const STATIC_DEFENSE: Record<number, StaticDefenseSource> = {
    [UnitType.AUTOTURRET]: { weight: 31, range: 7, buffer: 'rangeBuffer', layers: ALL_LAYERS },
    [UnitType.BUNKER]: { weight: 22, range: 6, buffer: 'rangeBuffer', layers: ['ground', 'air'] },
    [UnitType.MISSILETURRET]: {
        weight: 39,
        range: 7,
        buffer: 'rangeBuffer',
        layers: ['air'],
        upgradedRange: { range: 8, afterSeconds: 540 },
    },
    [UnitType.PHOTONCANNON]: {
        weight: 22,
        range: 7,
        buffer: 'rangeBuffer',
        layers: ['ground', 'air'],
        requiresPower: true,
    },
    [UnitType.PLANETARYFORTRESS]: { weight: 28, range: 7.5, buffer: 'rangeBuffer', layers: ['ground'] },
    // Not in ares (no spine handler there); deliberate addition.
    [UnitType.SPINECRAWLER]: { weight: 22, range: 7, buffer: 'rangeBuffer', layers: ['ground'] },
    [UnitType.SPORECRAWLER]: { weight: 39, range: 7, buffer: 'rangeBuffer', layers: ['air'] },
};

export const UNIT_AVOIDANCE: Record<number, InfluenceSource> = {
    [UnitType.BANELING]: { weight: 20, range: 3, layers: ['groundAvoidance'] },
    [UnitType.DISRUPTORPHASED]: {
        weight: 1000,
        range: 8,
        buffer: 'effectsRangeBuffer',
        layers: ['ground', 'groundAvoidance'],
    },
};

export const DEFAULT_EFFECT_COSTS: Record<number, { cost: number; range: number }> = {
    [Effect.BLINDINGCLOUDCP]: { cost: 300, range: 3.5 },
    [Effect.LIBERATORTARGETMORPHDELAYPERSISTENT]: { cost: 500, range: 6 },
    [Effect.LIBERATORTARGETMORPHPERSISTENT]: { cost: 500, range: 6 },
    [Effect.LURKERMP]: { cost: 600, range: 1 },
    [Effect.NUKEPERSISTENT]: { cost: 1000, range: 8 },
    [Effect.PSISTORMPERSISTENT]: { cost: 600, range: 3.5 },
    [Effect.RAVAGERCORROSIVEBILECP]: { cost: 100, range: 3 },
};

export const EFFECT_INFLUENCE: Record<number, EffectInfluence> = {
    [Effect.BLINDINGCLOUDCP]: { layers: ['ground', 'groundAvoidance'] },
    [Effect.LIBERATORTARGETMORPHDELAYPERSISTENT]: { layers: ['ground'] },
    [Effect.LIBERATORTARGETMORPHPERSISTENT]: { layers: ['ground'] },
    [Effect.LURKERMP]: { layers: ['ground', 'groundAvoidance'], perPosition: true },
    [Effect.NUKEPERSISTENT]: { layers: ALL_LAYERS },
    [Effect.PSISTORMPERSISTENT]: { layers: ALL_LAYERS },
    [Effect.RAVAGERCORROSIVEBILECP]: { layers: ALL_LAYERS },
};
