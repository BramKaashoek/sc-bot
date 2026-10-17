import api from '@node-sc2/proto/root';

// BuildOrder/BuildResult are unique to node-sc2

export const BuildOrder = {
    NOT_STARTED: 0,
    COMMAND_GIVEN: 1,
    IN_PROGRESS: 2,
    COMPLETE: 3,
    SKIPPED: 4,
} as const;

export type BuildOrderStatus = (typeof BuildOrder)[keyof typeof BuildOrder];

export const BuildOrderId = {
    0: 'NOT_STARTED',
    1: 'COMMAND_GIVEN',
    2: 'IN_PROGRESS',
    3: 'COMPLETE',
    4: 'SKIPPED',
};

export const BuildResult = {
    SUCCESS: 0,
    COMMAND_SENT: 1,
    CANNOT_SATISFY: 2,
    ERROR: 3,
    SKIPPED: 4,
} as const;

export type BuildResult = (typeof BuildResult)[keyof typeof BuildResult];

// Redefined here as a reference instead of importing magic constants from the proto defs;
// the reverse (id-based) lookups come from protobuf to avoid duplication.

export const Alert = {
    NUCLEARLAUNCHDETECTED: 1,
    NYDUSWORMDETECTED: 2
};

export const AlertId: Record<number, string> = api.lookupEnum('Alert').valuesById;

export const Alliance = {
    SELF: 1,
    ALLY: 2,
    NEUTRAL: 3,
    ENEMY: 4,
};

export const AllianceId: Record<number, string> = api.lookupEnum('Alliance').valuesById;

export const Attribute = {
    LIGHT: 1,
    ARMORED: 2,
    BIOLOGICAL: 3,
    MECHANICAL: 4,
    ROBOTIC: 5,
    PSIONIC: 6,
    MASSIVE: 7,
    STRUCTURE: 8,
    HOVER: 9,
    HEROIC: 10,
    SUMMONED: 11,
};

export const AttributeId: Record<number, string> = api.lookupEnum('Attribute').valuesById;

export const Difficulty = {
    VERYEASY: 1,
    EASY: 2,
    MEDIUM: 3,
    MEDIUMHARD: 4,
    HARD: 5,
    HARDER: 6,
    VERYHARD: 7,
    CHEATVISION: 8,
    CHEATMONEY: 9,
    CHEATINSANE: 10
};

export const DifficultyId: Record<number, string> = api.lookupEnum('Difficulty').valuesById;

export const DisplayType = {
    VISIBLE: 1,
    SNAPSHOT: 2,
    HIDDEN: 3,
};

export const DisplayTypeId: Record<number, string> = api.lookupEnum('DisplayType').valuesById;

export const GameResult = {
    VICTORY: 1,
    DEFEAT: 2,
    TIE: 3,
    UNDECIDED: 4
};

export const GameResultId: Record<number, string> = api.lookupEnum('Result').valuesById;

export const PlayerType = {
    PARTICIPANT: 1,
    COMPUTER: 2,
    OBSERVER: 3
};

export const PlayerTypeId: Record<number, string> = api.lookupEnum('PlayerType').valuesById;

export const Race = {
    NORACE: 0,
    TERRAN: 1,
    ZERG: 2,
    PROTOSS: 3,
    RANDOM: 4
};

export const RaceId: Record<number, string> = api.lookupEnum('Race').valuesById;

export const Status = {
    LAUNCHED: 1,
    INIT_GAME: 2,
    IN_GAME: 3,
    IN_REPLAY: 4,
    ENDED: 5,
    QUIT: 6,
    UNKNOWN: 99
};

export const StatusId: Record<number, string> = api.lookupEnum('Status').valuesById;

export const WeaponTargetType = {
    GROUND: 1,
    AIR: 2,
    ANY: 3,
};

export const WeaponTargetTypeId: Record<number, string> = api.lookupEnum('TargetType').valuesById;

export const AbilityDataTarget = {
    NONE: 1,
    POINT: 2,
    UNIT: 3,
    POINTORUNIT: 4,
    POINTORNONE: 5,
};

export const AbilityDataTargetId: Record<number, string> = api.lookupType('AbilityData').lookupEnum('Target').valuesById;

export const CloakState = {
    CLOAKED: 1,
    CLOAKEDDETECTED: 2,
    NOTCLOAKED: 3,
};

export const CloakStateId: Record<number, string> = api.lookupEnum('CloakState').valuesById;
