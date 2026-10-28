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

type TacticalStamp = { weak: number; solid: number; isWeak: (health: number) => boolean };

export type EffectInfluence = { layers: readonly InfluenceLayer[]; perPosition?: true };

const ALL_LAYERS = ['ground', 'air', 'groundAvoidance', 'airAvoidance'] as const;
const PRIORITY_LAYERS = [...ALL_LAYERS, 'priorityGroundAvoidance'] as const;

export const INFLUENCE_DEFAULTS = {
    rangeBuffer: 4,
    effectsRangeBuffer: 1,
    costMultiplier: 1,
    airVsGroundDefault: 10,
    tacticalGround: false,
    kd8Charge: { cost: 10, range: 4.5 },
    parasiticBomb: { cost: 17.15, range: 4 },
    delayedEffects: {
        bile: { reactAfter: 16, duration: 50 },
        nuke: { reactAfter: 250, duration: 320 },
    },
};

// ares unit_data.py army_value entries that were hand-edited away from ((minerals / 0.9 + gas) * supply) / 50
export const ARMY_VALUE_OVERRIDES: Record<number, number> = {
    [UnitType.ZERGLING]: 1,
    [UnitType.ZERGLINGBURROWED]: 1,
    [UnitType.BANELING]: 2,
    [UnitType.BANELINGBURROWED]: 2,
    [UnitType.RAVAGER]: 12.667,
    [UnitType.RAVAGERBURROWED]: 12.667,
    [UnitType.RAVAGERCOCOON]: 12.667,
    [UnitType.LURKERMP]: 19,
    [UnitType.LURKERMPBURROWED]: 19,
    [UnitType.LURKERMPEGG]: 19,
    [UnitType.LOCUSTMP]: 1,
    [UnitType.LOCUSTMPFLYING]: 1,
    [UnitType.OVERLORD]: 1,
    [UnitType.OVERLORDCOCOON]: 1,
    [UnitType.OVERLORDTRANSPORT]: 1,
    [UnitType.TRANSPORTOVERLORDCOCOON]: 1,
    [UnitType.OVERSEER]: 2,
    [UnitType.OVERSEERSIEGEMODE]: 2,
    [UnitType.BROODLORD]: 46.667,
    [UnitType.BROODLORDCOCOON]: 46.667,
    [UnitType.BROODLING]: 1,
    [UnitType.PLANETARYFORTRESS]: 25,
    [UnitType.BUNKER]: 15,
    [UnitType.MISSILETURRET]: 5,
    [UnitType.AUTOTURRET]: 3,
    [UnitType.PHOTONCANNON]: 15,
    [UnitType.SHIELDBATTERY]: 10,
    [UnitType.SPINECRAWLER]: 15,
    [UnitType.SPORECRAWLER]: 10,
};

export const TACTICAL_STRUCTURES = new Set([
    UnitType.AUTOTURRET,
    UnitType.BUNKER,
    UnitType.MISSILETURRET,
    UnitType.PHOTONCANNON,
    UnitType.PLANETARYFORTRESS,
    UnitType.SPORECRAWLER,
]);

// on top of the army value; ares' bunker is weak at <= 100 health, its planetary fortress at < 100
export const TACTICAL_STRUCTURE_STAMPS: Record<number, TacticalStamp> = {
    [UnitType.BUNKER]: { weak: 15, solid: 10, isWeak: (health) => health <= 100 },
    [UnitType.PLANETARYFORTRESS]: { weak: 25, solid: 40, isWeak: (health) => health < 100 },
};

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
    [UnitType.BANELING]: { weight: 20, range: 3, layers: ['groundAvoidance', 'priorityGroundAvoidance'] },
    [UnitType.DISRUPTORPHASED]: {
        weight: 1000,
        range: 8,
        buffer: 'effectsRangeBuffer',
        layers: ['ground', 'groundAvoidance', 'priorityGroundAvoidance'],
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
    [Effect.PSISTORMPERSISTENT]: { layers: PRIORITY_LAYERS },
};

// they vanish from the observation before they land, so ares tracks them by first sighting instead of stamping them live
export const DELAYED_EFFECTS = {
    bile: Effect.RAVAGERCORROSIVEBILECP,
    nuke: Effect.NUKEPERSISTENT,
} as const;

export const DELAYED_EFFECT_LAYERS = PRIORITY_LAYERS;

// a shade is harmless until its adept teleports onto it, which ares models as a unit that only counts once it is old
export const SHADE_VISIBLE_AFTER_LOOPS = 120;
export const SHADE_PRUNE_AFTER_LOOPS = 192;

export const KD8_LAYERS = ['ground'] as const;
export const PARASITIC_BOMB_LAYERS = ['air', 'airAvoidance', 'groundToAir'] as const;
