/// <reference types="@node-sc2/proto" />

import type { ChildProcess } from 'node:child_process';
import type { BuildOrderStatus, BuildResult } from './constants/enums.ts';
import type { Units } from './resources/units-collection.ts';
import type { Ramp } from './utils/map/ramp.ts';
import type { CommandContext } from './resources/command-context.ts';
import type * as UnitRoles from './constants/unit-role.ts';
import type { EngagementResult } from './constants/engagement-result.ts';
import type { FightOptions, FightSimulation } from './utils/combat/combat-sim.ts';

export type { BuildOrderStatus, BuildResult, CommandContext, EngagementResult, FightOptions, FightSimulation };

export type UnitRole = (typeof UnitRoles)[keyof typeof UnitRoles];

declare global {
    namespace SC2APIProtocol {
        interface Unit {
            isActive?: boolean;
            attackUpgradeLevel?: number;
            armorUpgradeLevel?: number;
            shieldUpgradeLevel?: number;
            buffDurationRemain?: number;
            buffDurationMax?: number;
        }
    }
}

// Required: proto marks x/y/z optional, which makes every arithmetic use fail under strict
export interface Point2D extends Required<SC2APIProtocol.Point2D> {}
export interface Point3D extends Required<SC2APIProtocol.Point> {}

export type Shape = {
    pos: Point2D;
    height: number;
    width: number;
};

export type Grid2D = number[][];
export type UnitTypeId = number;
export type AbilityId = number;

export type GenericState = any;

export type SystemType = 'engine' | 'agent' | 'build' | 'unit';

export type SystemOptions = {
    state?: any;
    stepIncrement?: number;
    commandPriority?: number;
};

export interface SystemObject {
    name?: string;
    type?: SystemType;
    setup?: (world: World) => void;
    defaultOptions?: SystemOptions;
    buildOrder?: Array<BuildTask>;
    buildOptions?: {
        paused?: boolean;
        earmarks: null | number;
    };
    pauseBuild?: () => void;
    resumeBuild?: () => void;
    buildComplete?: (world: World, gameLoop: number) => Promise<any>;
    idleFunctions?: IdleFunctions;
}

export type IdleFunctions = {
    [key: string]: (world: World, unit: Unit) => Promise<any>;
    [index: number]: (world: World, unit: Unit) => Promise<any>;
} & {
    labeled?: (world: World, unit: Unit, label?: string) => Promise<any>;
};

export type BuildTaskI = {
    type: 'build' | 'train' | 'upgrade' | 'ability' | 'worker';
    id?: number | number[];
    name?: string;
    qty?: number;
    commanded?: number;
    opts?: {
        near?: UnitTypeId;
        on?: UnitTypeId;
        skip?: string;
        target?: UnitTypeId;
    };
    index?: number;
    touched?: boolean;
    supply?: number;
    started?: null | number;
    earmarked?: boolean;
    status?: BuildOrderStatus;
};

export type BuildTask = BuildTaskI | [number, BuildTaskI];

export type BuildTaskOptions = NonNullable<BuildTaskI['opts']>;

export type TaskFunctions = {
    ability: (id: number, opts?: BuildTaskOptions) => BuildTaskI;
    build: (id: number, qty?: number, opts?: BuildTaskOptions) => BuildTaskI;
    train: (id: number | number[], qty?: number, opts?: BuildTaskOptions) => BuildTaskI;
    upgrade: (id: number) => BuildTaskI;
};

export type BuildHelper = TaskFunctions[keyof TaskFunctions];

export type BuilderFunction = (world: World, task: BuildTaskI) => BuildTaskI;

export type BuildFunction = (world: World, buildStep: BuildTaskI) => Promise<BuildOrderStatus>;

export interface System extends SystemObject {
    readerId?: string;
    state: GenericState;
    pause(): void;
    unpause(): void;
    setState(newState: object): void;
    setState(newState: (currentState: GenericState) => object): void;
    setup(world: World): void;
}

export interface BuilderSystem extends System {
    onStep?(world: Partial<World>, gameLoop?: number, result?: BuildResult): Promise<any>;
}

export interface SystemWrapper<T> {
    (world: World): Promise<any>;
    setup(world: World, isLateSetup?: boolean): void;
    commandPriority: number;
    _system: System;
}

export type Opponent = {
    id?: string;
    race?: SC2APIProtocol.Race;
};

export interface PlayerData extends SC2APIProtocol.PlayerCommon, SC2APIProtocol.PlayerRaw {}

export interface Agent extends PlayerData {
    _world: World;
    inGame?: boolean;
    readerId?: string;
    onGameStart: (world: World, data?: null, event?: SystemEvent) => Promise<any>;
    onStep?: (resources: World, gameLoop?: number, event?: SystemEvent) => void;
    interface: SC2APIProtocol.InterfaceOptions;
    canAfford(unitTypeId: number, earmarkName?: string | null): boolean;
    canAffordN(unitTypeId: number, nQtyMax?: number): number;
    canAffordUpgrade: (upgradeId: number, earmarkName?: string | null) => boolean;
    hasTechFor: (unitTypeId: number) => boolean;
    supplyCap: number;
    supplyUsed: number;
    supplyLeft: number;
    supplyArmy: number;
    supplyWorkers: number;
    calculateCost(unitTypeId: number): Cost;
    calculateUpgradeCost(upgradeId: number): Cost;
    calculateSupplyCost(unitTypeId: number): number;
    canFeed(unitTypeId: number): boolean;
    canAffordUnit(unitTypeId: number, checkSupplyCost?: boolean): boolean;
    alreadyPending(unitTypeId: number): number;
    alreadyPendingUpgrade(upgradeId: number): number;
    structureTypeBuildProgress(unitTypeId: number): number;
    techRequirementProgress(unitTypeId: number): number;
    workerEnRouteToBuild(unitTypeId: number): number;
    getNextExpansion(): Promise<Point2D | null>;
    ownedExpansions(): OwnedExpansion[];
    expandNow(unitTypeId?: number, maxDistance?: number, location?: Point2D): Promise<void>;
    distributeWorkers(resourceRatio?: number): Promise<void>;
    train(unitTypeId: number, amount?: number, closestTo?: Point2D, trainOnlyIdleBuildings?: boolean): Promise<number>;
    research(upgradeId: number): Promise<boolean>;
    race?: SC2APIProtocol.Race;
    opponent?: Opponent;
    settings: SC2APIProtocol.PlayerSetup & AgentSettings;
    systems: SystemWrapper<System>[];
    use: (sys: SystemWrapper<System> | SystemWrapper<System>[]) => void;
    setup: (world: World) => void;
}

export type AgentSettings = {
    commandPriority?: number;
    skipAvailableAbilitiesQuery?: boolean;
};

export type OwnedExpansion = {
    location: Point2D;
    townhall: Unit;
};

export type Cost = {
    minerals: number;
    vespene: number;
};

export type UnitTypeGroup = Array<number>;

export type DamageVsTarget = [damage: number, weaponSpeed: number, weaponRange: number];

export interface Unit extends SC2APIProtocol.Unit {
    tag: string;
    pos: Point3D;
    unitType: UnitTypeId;
    _availableAbilities: Array<number>;
    _availableAbilitiesLoop?: number;
    noQueue?: boolean;
    lastSeen?: number;
    labels: Map<string, any>;
    abilityAvailable: (abilityId: number) => boolean;
    availableAbilities: () => Array<number>;
    fetchAvailableAbilities: () => Promise<Array<number>>;
    data: () => SC2APIProtocol.UnitTypeData;
    is: (unitType: UnitTypeId) => boolean;
    isCloaked: () => boolean;
    isConstructing: () => boolean;
    isCombatUnit: () => boolean;
    isEnemy: () => boolean;
    isFinished: () => boolean;
    isWorker: () => boolean;
    isTownhall: () => boolean;
    isGasMine: () => boolean;
    isMineralField: () => boolean;
    isStructure: () => boolean;
    isIdle: () => boolean;
    isCurrent: () => boolean;
    isHolding: () => boolean;
    isGathering: (type?: 'minerals' | 'vespene') => boolean;
    isReturning: () => boolean;
    hasReactor: () => boolean;
    hasTechLab: () => boolean;
    hasNoLabels: () => boolean;
    canInject: () => boolean;
    canBlink: () => boolean;
    canMove: () => boolean;
    canShootUp: () => boolean;
    update: (unit: SC2APIProtocol.Unit) => void;
    inject: (target?: Unit) => Promise<void>;
    blink: (target: Point2D, opts?: AbilityOptions) => Promise<void>;
    toggle: (options?: AbilityOptions) => Promise<void>;
    burrow: (options?: AbilityOptions) => Promise<void>;
    addLabel: (name: string, value: any) => Map<string, any>;
    hasLabel: (name: string) => boolean;
    getLife: () => number;
    getLabel: (name: string) => any;
    removeLabel: (name: string) => boolean;
    typeData: (unitTypeId: UnitTypeId) => SC2APIProtocol.UnitTypeData | undefined;
    isUsingAbility: (abilityIds: AbilityId | AbilityId[]) => boolean;
    isMoving: () => boolean;
    isAttacking: () => boolean;
    isPatrolling: () => boolean;
    isRepairing: () => boolean;
    isCollecting: () => boolean;
    isConstructingScv: () => boolean;
    isTransforming: () => boolean;
    buffs: () => Set<number>;
    hasBuff: (buffId: number) => boolean;
    isCarryingMinerals: () => boolean;
    isCarryingVespene: () => boolean;
    isCarryingResource: () => boolean;
    hasAddOn: () => boolean;
    addOnPosition: () => Point2D;
    addOnLandPosition: () => Point2D;
    surplusHarvesters: () => number;
    isLight: () => boolean;
    isArmored: () => boolean;
    isBiological: () => boolean;
    isMechanical: () => boolean;
    isMassive: () => boolean;
    isPsionic: () => boolean;
    groundDps: () => number;
    airDps: () => number;
    groundRange: () => number;
    airRange: () => number;
    sightRange: () => number;
    movementSpeed: () => number;
    realSpeed: () => number;
    distanceToWeaponReady: () => number;
    weaponReady: () => boolean;
    targetInRange: (target: Unit, bonusDistance?: number) => boolean;
    inAbilityCastRange: (abilityId: AbilityId, target: Unit | Point2D, bonusDistance?: number) => boolean;
    calculateDamageVsTarget: (target: Unit, ignoreArmor?: boolean, includeOverkillDamage?: boolean) => DamageVsTarget;
    calculateDpsVsTarget: (target: Unit, ignoreArmor?: boolean, includeOverkillDamage?: boolean) => number;
    distanceTo: (target: Unit | Point2D) => number;
    isFacing: (other: Unit, angleError?: number) => boolean;
    isSnapshot: () => boolean;
    isFlyingOrGravitoned: () => boolean;
    isMemory: () => boolean;
    age: () => number;
    useAbility: (abilityId: AbilityId, options?: AbilityOptions) => Promise<void>;
}

export interface UnitResource {
    _units: {
        [k: number]: Map<string, Unit>; // 1 = Self, 3 = Neutral, 4 = Enemy
    };
    clone: () => Map<string, Unit>;
    getBases(filter?: number | UnitFilter): Units;
    getCombatUnits(filter?: number | UnitFilter): Units;
    getRangedCombatUnits(): Units;
    getAll: (filter?: number | UnitFilter | ((unit: Unit) => boolean)) => Units;
    getAlive: (filter?: number | UnitFilter) => Units;
    getById: (unitTypeId: number | number[], filter?: UnitFilter) => Units;
    getByTag(unitTags: string): Unit | undefined;
    getByTag(unitTags: string[]): Units;
    getClosest(pos: Point2D, units: Unit[], n?: number): Units;
    getClosest(pos: Point2D, units: SC2APIProtocol.PowerSource[], n?: number): SC2APIProtocol.PowerSource[];
    getByType: (unitTypeIds: number | UnitTypeGroup) => Units;
    getProductionUnits: (unitTypeId: number) => Units;
    getUpgradeFacilities: (upgradeId: number) => Units;
    getMineralFields: (filter?: UnitFilter) => Units;
    getGasGeysers: (filter?: UnitFilter) => Units;
    getGasMines: (filter?: number | UnitFilter) => Units;
    getEnemyUnits: () => Units;
    getEnemyStructures: () => Units;
    getDestructables: () => Units;
    getWatchtowers: () => Units;
    getLarva: () => Units;
    getStructures: (filter?: UnitFilter) => Units;
    getWorkers: (includeBusy?: boolean) => Units;
    getIdle: () => Units;
    getIdleWorkers: () => Units;
    getMineralWorkers: () => Units;
    getConstructingWorkers: () => Units;
    getPendingAt: (unitTypeIds: number | number[], pos: Point2D, maxDistance?: number) => Units;
    getUnfinished: (filter?: UnitFilter) => Units;
    inProgress: (unitTypeId: number) => Units;
    withLabel: (label: string) => Units;
    withCurrentOrders: (abilityId: number) => Units;
    getArmyValue(
        alliance?: SC2APIProtocol.Alliance.Self | SC2APIProtocol.Alliance.Enemy,
        opts?: { includePending?: boolean; includeGhosts?: boolean },
    ): number;
}

export interface UnitFilter extends Partial<Unit> {}

export interface UnitSystem extends EngineObject {
    onStep: (world: World) => Promise<any>;
    onGameStart: (world: World) => Promise<any>;
}

export type Path = number[][];

export type Cluster = {
    centroid?: Point2D;
    mineralFields: Unit[];
    vespeneGeysers?: Unit[];
};

export type ExpansionArea = {
    hull: Array<Point2D>;
    wall?: Array<Point2D>;
    areaFill: Array<Point2D>;
    placementGrid: Array<Point2D>;
    mineralLine: Array<Point2D>;
    behindMineralLine: Array<Point2D>;
};

export interface Expansion {
    base?: string;
    areas?: ExpansionArea;
    getWall(): Array<Point2D>;
    getBase(): Unit | undefined;
    getAlliance(): SC2APIProtocol.Alliance;
    cluster: Cluster;
    townhallPosition: Point2D;
    zPosition: number;
    centroid?: Point2D;
    labels: Map<string, any>;
    pathFromMain?: Path;
    pathFromEnemy?: Path;
}

export type Grids = {
    height?: Grid2D;
    miniMap?: Grid2D;
    placement?: Grid2D;
    pathing?: Grid2D;
};

export type Locations = {
    self: Point2D;
    enemy: Point2D[];
};

export type MapPathOptions = {
    graph?: any;
    force?: boolean;
    diagonal?: boolean;
};

export interface MapResource {
    _activeEffects: Array<SC2APIProtocol.Effect>;
    _grids: Grids;
    _locations: Locations;
    _expansions: ReadonlyArray<Expansion>;
    _expansionsFromEnemy: ReadonlyArray<Expansion>;
    _graph: any;
    _mapState: {
        creep: Grid2D;
        visibility: Grid2D;
    };
    _mapSize: SC2APIProtocol.Size2DI;
    _ramps: Point3D[];
    isCustom: () => boolean;
    isPathable: (point: Point2D) => boolean;
    setPathable: (point: Point2D, pathable: boolean) => void;
    isPlaceable: (point: Point2D) => boolean;
    isPlaceableAt: (unitType: number, pos: Point2D) => boolean;
    setPlaceable: (point: Point2D, placeable: boolean) => void;
    isVisible: (point: Point2D) => boolean;
    isRamp: (point: Point2D) => boolean;
    hasCreep: (point: Point2D) => boolean;
    freeGasGeysers: () => Unit[];
    getCreep: () => Point2D[];
    getEffects: () => Array<SC2APIProtocol.Effect>;
    getGrids: () => Grids;
    getLocations: () => Locations;
    getExpansions: (alliance?: SC2APIProtocol.Alliance) => Expansion[];
    getMain: () => Expansion;
    getEnemyMain: () => Expansion;
    getNatural: () => Expansion;
    getEnemyNatural: () => Expansion;
    getThirds: () => Expansion[];
    getEnemyThirds: () => Expansion[];
    getHeight: (point: Point2D) => number;
    getClosestExpansion: (point: Point2D) => Expansion;
    getAvailableExpansions: () => Expansion[];
    getOccupiedExpansions: (alliance?: SC2APIProtocol.Alliance) => Expansion[];
    getCombatRally: () => Point2D;
    getSize: () => SC2APIProtocol.Size2DI;
    getCenter: (pathable?: boolean) => Point2D;
    closestPathable: (point: Point2D) => Point2D;
    setActiveEffects: (currEffects: Array<SC2APIProtocol.Effect>) => void;
    setGrids: (grids: Grids) => void;
    setSize: (mapSize: SC2APIProtocol.Size2DI) => void;
    setGraph: (graph?: any) => void;
    getGraph: () => any;
    newGraph: (grid: Grid2D) => any;
    setLocations: (locations: Partial<Locations>) => void;
    setMapState: (mapState: { visibility: Grid2D; creep: Grid2D }) => void;
    setRamps: (points: Point3D[]) => void;
    path: (start: Point2D, end: Point2D, opts?: MapPathOptions) => number[][];
    setExpansions: (expansions: Expansion[]) => void;
    setStartRaw: (startRaw: SC2APIProtocol.StartRaw) => void;
    getRamps: () => Ramp[];
    getMainBaseRamp: () => Ramp | undefined;
    getVisionBlockers: () => Point2D[];
    getExpansionLocations: () => Point2D[];
    getTerrainHeight: (point: Point2D) => number;
    getTerrainZHeight: (point: Point2D) => number;
    inPathingGrid: (point: Point2D) => boolean;
    inPlacementGrid: (point: Point2D) => boolean;
    queryPathing: (start: Point2D | Unit, end: Point2D) => Promise<number | null>;
}

export interface MapSystem extends EngineObject, EventConsumer {}

export type AbilityOptions = {
    target?: Unit | Point2D;
    queue?: boolean;
};

export type WarpInOptions = {
    nearPosition?: Point2D;
    maxQty?: number;
    highground?: true;
};

export type CommandResult = {
    owner: string;
    command: SC2APIProtocol.ActionRawUnitCommand;
    tags: string[];
    outcome: 'won' | 'dropped' | 'rejected';
    reason?: 'outranked' | 'repeat' | 'not-owner';
    by?: string;
    result?: SC2APIProtocol.ActionResult;
    error?: string;
};

export interface ActionManager {
    _client: NodeSC2Proto.ProtoClient;
    attack(units?: Unit[], unit?: Unit, queue?: boolean): Promise<void>;
    attackMove(u?: Unit[], p?: Point2D, queue?: boolean): Promise<void>;
    build(unitTypeId: number, target?: Unit, worker?: Unit): Promise<void>;
    build(unitTypeId: number, pos?: Point2D | null, worker?: Unit): Promise<void>;
    do(abilityId: number, tags: string, opts?: AbilityOptions): Promise<void>;
    do(abilityId: number, tags: string[], opts?: AbilityOptions): Promise<void>;
    buildGasMine: () => Promise<void>;
    gather: (unit: Unit, mineralField?: Unit, queue?: boolean) => Promise<void>;
    mine: (units: Unit[], target: Unit, queue?: boolean) => Promise<void>;
    move(units: Unit, target: Point2D, queue?: boolean): Promise<void>;
    move(units: Unit[], target: Point2D, queue?: boolean): Promise<void>;
    move(units: Unit, target: Unit, queue?: boolean): Promise<void>;
    move(units: Unit[], target: Unit, queue?: boolean): Promise<void>;
    patrol(units: Unit | Unit[], positions: [from: Point2D, to: Point2D] | Point2D, queue?: boolean): Promise<void>;
    train: (unitTypeId: number, unit?: Unit) => Promise<void>;
    upgrade: (upgradeId: number, tag?: Unit) => Promise<void>;
    smart(units: Unit[], target: Point2D, queue?: boolean): Promise<void>;
    smart(units: Unit[], target: Unit, queue?: boolean): Promise<void>;
    swapBuildings(unitA: Unit, unitB: Unit): Promise<SC2APIProtocol.ResponseAction[]>;
    warpIn(unitTypeId: number, opts: WarpInOptions): Promise<void>;
    canPlace: (unitTypeId: number, positions: Point2D[]) => Promise<Point2D | false>;
    findPlacement: (unitTypeId: number, near: Point2D, opts?: FindPlacementOptions) => Promise<Point2D | false>;
    sendAction(unitCommand: SC2APIProtocol.ActionRawUnitCommand): Promise<SC2APIProtocol.ResponseAction>;
    sendAction(unitCommand: SC2APIProtocol.ActionRawUnitCommand[]): Promise<SC2APIProtocol.ResponseAction>;
    sendQuery: (query: SC2APIProtocol.RequestQuery) => Promise<SC2APIProtocol.ResponseQuery>;
    stop(units: Unit | Unit[], queue?: boolean): Promise<void>;
    holdPosition(units: Unit | Unit[], queue?: boolean): Promise<void>;
    repair(units: Unit | Unit[], target: Unit, queue?: boolean): Promise<void>;
    returnResource(units: Unit | Unit[], queue?: boolean): Promise<void>;
    queueAction(
        commands: SC2APIProtocol.ActionRawUnitCommand | SC2APIProtocol.ActionRawUnitCommand[],
        opts?: { onNotSent?: (tags: string[], result: CommandResult) => void },
    ): void;
    as<T>(context: Partial<CommandContext>, fn: () => T): T;
    unitTagsReceivedAction(): Set<string>;
    flushQueuedActions(): Promise<SC2APIProtocol.ResponseAction | undefined>;
    clearQueuedActions(): void;
    chatSend(message: string, teamOnly?: boolean): Promise<SC2APIProtocol.ResponseAction>;
    toggleAutocast(units: Unit | Unit[], abilityId: AbilityId): Promise<SC2APIProtocol.ResponseAction>;
    surrender(): Promise<unknown>;
}

export type FindPlacementOptions = {
    maxDistance?: number;
    randomAlternative?: boolean;
    placementStep?: number;
    addonPlace?: boolean;
};

export type Color = {
    r: number;
    g: number;
    b: number;
};

export type WPoint = {
    pos: SC2APIProtocol.Point;
    color?: Color;
    size?: number;
    text?: string;
    max?: SC2APIProtocol.Point;
};

export type ShapeDrawFn = (
    id: string,
    points: Array<WPoint>,
    opts?: {
        height?: number;
        cube?: boolean;
        zPos?: number;
        color?: Color;
        size?: number;
        temp?: boolean;
        persistText?: boolean;
        includeText?: boolean;
    },
) => void;

export type TextDrawFn = (
    id: string,
    points: Array<{
        pos: SC2APIProtocol.Point;
        text: string;
        size?: number;
        color?: Color;
    }>,
    opts?: {
        zPos?: number;
        color?: Color;
        size?: number;
        temp?: boolean;
    },
) => void;

export type LineDrawFn = (
    id: string,
    points: Array<
        SC2APIProtocol.Line & {
            color?: Color;
            text: string;
        }
    >,
    opts?: {
        zPos?: number;
        color?: Color;
        includeText?: boolean;
    },
) => void;

export type DebugUnitRequest = Pick<SC2APIProtocol.DebugCreateUnit, 'unitType' | 'quantity' | 'pos'> & {
    playerId?: number;
};

export type UnitRequest = Array<DebugUnitRequest>;

export interface Debugger {
    touched: boolean;
    updateScreen: () => Promise<SC2APIProtocol.ResponseDebug>;
    removeCommand: (id: string) => void;
    setRegions: (expansions: Expansion[]) => void;
    setDrawCells: ShapeDrawFn;
    setDrawSpheres: ShapeDrawFn;
    setDrawTextWorld: TextDrawFn;
    setDrawLines: LineDrawFn;
    setDrawTextScreen: TextDrawFn;
    createUnit(ureqs: DebugUnitRequest | UnitRequest): Promise<SC2APIProtocol.ResponseDebug>;
    killUnit(units: Unit | Unit[]): Promise<SC2APIProtocol.ResponseDebug>;
    setUnitValue(
        units: Unit | Unit[],
        unitValue: SC2APIProtocol.DebugSetUnitValue_UnitValue,
        value: number,
    ): Promise<SC2APIProtocol.ResponseDebug>;
    showMap(): Promise<SC2APIProtocol.ResponseDebug>;
    controlEnemy(): Promise<SC2APIProtocol.ResponseDebug>;
    food(): Promise<SC2APIProtocol.ResponseDebug>;
    free(): Promise<SC2APIProtocol.ResponseDebug>;
    allResources(): Promise<SC2APIProtocol.ResponseDebug>;
    god(): Promise<SC2APIProtocol.ResponseDebug>;
    minerals(): Promise<SC2APIProtocol.ResponseDebug>;
    gas(): Promise<SC2APIProtocol.ResponseDebug>;
    cooldown(): Promise<SC2APIProtocol.ResponseDebug>;
    techTree(): Promise<SC2APIProtocol.ResponseDebug>;
    upgrade(): Promise<SC2APIProtocol.ResponseDebug>;
    fastBuild(): Promise<SC2APIProtocol.ResponseDebug>;
    moveCamera(target: Unit | Point2D): Promise<SC2APIProtocol.ResponseAction>;
    drawBox(min: SC2APIProtocol.Point, max: SC2APIProtocol.Point, color?: Color): void;
    quickSave(): Promise<unknown>;
    quickLoad(): Promise<unknown>;
    useDebugWidget(id: string, data: unknown, opts: { title?: string }): void;
}

export type GameFrame = {
    _previous?: GameFrame;
    _observation?: SC2APIProtocol.Observation;
    _gameInfo?: SC2APIProtocol.ResponseGameInfo;
    _gameLoop: number;
};

export interface FrameResource {
    _previous: GameFrame | null;
    _observation: SC2APIProtocol.Observation | null | undefined;
    _gameInfo: SC2APIProtocol.ResponseGameInfo | null;
    _gameLoop: number;
    _result?: Array<SC2APIProtocol.PlayerResult>;
    _score: SC2APIProtocol.Score | null | undefined;
    _render: SC2APIProtocol.ObservationRender | null | undefined;
    _feature: SC2APIProtocol.ObservationFeatureLayer | null | undefined;
    getObservation: () => SC2APIProtocol.Observation;
    getGameInfo: () => SC2APIProtocol.ResponseGameInfo;
    getGameLoop: () => number;
    getPrevious: () => GameFrame;
    getEffects: () => Array<SC2APIProtocol.Effect>;
    getMapState: () => SC2APIProtocol.MapState;
    getRender: () => SC2APIProtocol.ObservationRender;
    getScore: () => SC2APIProtocol.Score;
    getFeatureLayer: () => SC2APIProtocol.ObservationFeatureLayer;
    timeInSeconds: () => number;
    _actionErrors: Array<SC2APIProtocol.ActionError>;
    time: () => number;
    timeFormatted: () => string;
    getAlerts: () => Array<SC2APIProtocol.Alert>;
    hasAlert: (alert: SC2APIProtocol.Alert) => boolean;
    getActionErrors: () => Array<SC2APIProtocol.ActionError>;
    getStepTime: () => StepTime;
    recordStepTime: (milliseconds: number) => void;
    resetStepTimes: () => void;
}

export type StepTime = { min: number; avg: number; max: number; last: number };

export interface FrameSystem extends EngineObject {
    onStep: (world: World) => Promise<any>;
    onGameStart: (world: World) => Promise<any>;
}

export type ReaderId = string;

export type EventType = 'engine' | 'agent' | 'build' | 'unit' | 'all';

export type SystemEvent = {
    type: EventType;
    name: string;
    data: any;
    gameLoop: number;
    readers: ReaderId[];
    consume(rederId: ReaderId): void;
    destroy(): void;
};

export interface SystemEventData extends Partial<SystemEvent> {
    name: string;
}

export interface EventChannel {
    createReader: (type?: EventType) => ReaderId;
    removeReader: (readerId: ReaderId) => void;
    read: (readerId: ReaderId) => SystemEvent[];
    write(event: SystemEventData, readerId?: ReaderId): void;
}

export type UnitEvent = (world: World, data: Unit, event?: SystemEvent) => Promise<any>;
export type UnitTypeChange = { unit: Unit; previousType: UnitTypeId };
export type UnitDamage = { unit: Unit; amount: number };
// Method syntax keeps parameters bivariant: handlers declaring `event: SystemEvent` still match the optional `event`
export type EventConsumer = {
    onStep?(world: World, gameLoop: number, event?: SystemEvent): Promise<any>;
    onGameStart?(world: World, data?: null, event?: SystemEvent): Promise<any>;
    onUpgradeComplete?(world: World, upgradeId: number, event?: SystemEvent): Promise<any>;
    onChatReceived?(world: World, chat: SC2APIProtocol.ChatReceived, event?: SystemEvent): Promise<any>;
    onUnitIdle?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onCommandResults?(world: World, results: CommandResult[], event?: SystemEvent): Promise<any>;
    onEnemyStrategyDetected?(world: World, data: EnemyStrategyDetected, event?: SystemEvent): Promise<any>;
    onUnitDamaged?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onUnitCreated?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onUnitFinished?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onEnemyFirstSeen?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onUnitDestroyed?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onUnitHasEngaged?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onUnitHasDisengaged?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onUnitHasSwitchedTargets?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onUnitIsTransforming?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onUnitHasBurrowed?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onBuildingConstructionStarted?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onBuildingConstructionComplete?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onStructureConstructionStarted?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onStructureConstructionComplete?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onUnitSpawned?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onUnitTypeChanged?(world: World, data: UnitTypeChange, event?: SystemEvent): Promise<any>;
    onUnitTookDamage?(world: World, data: UnitDamage, event?: SystemEvent): Promise<any>;
    onEnemyUnitEnteredVision?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onEnemyUnitLeftVision?(world: World, data: Unit, event?: SystemEvent): Promise<any>;
    onNewEffect?(
        world: World,
        effect: SC2APIProtocol.Effect & SC2APIProtocol.EffectData & { effectGrid: Array<Point2D> },
        event?: SystemEvent,
    ): Promise<any>;
    onExpiredEffect?(
        world: World,
        effect: SC2APIProtocol.Effect & SC2APIProtocol.EffectData,
        event?: SystemEvent,
    ): Promise<any>;
};

export type EventHandler = (resources: World, data?: any, event?: SystemEvent) => any;
export type EventReader<T> = T & EventConsumer & { [index: string]: any };

export type UnitSystemUnits = { all: Unit[]; unlabeled: Record<number, Unit[]>; labeled: Record<string, Unit[]> };
type UnitSystemHandler = (world: World, unit: Unit) => Promise<any>;
export type UnitSystemObject = SystemObject &
    Omit<EventConsumer, 'onStep' | 'onUnitIdle' | 'onUnitDestroyed'> & {
        type: 'unit';
        units?: number | number[];
        labels?: string | string[];
        onStep?: (world: World, units: UnitSystemUnits) => Promise<any>;
        onNewUnit?: UnitSystemHandler;
        onUnitIdle?: UnitSystemHandler;
        onUnitDestroyed?: UnitSystemHandler;
        [index: string]: any;
    };
export type BuildSystemObject = SystemObject &
    Omit<EventConsumer, 'onStep'> & {
        type: 'build';
        onStep?: (world: World, gameLoop: number, task?: BuildTaskI, result?: BuildResult) => Promise<any>;
        [index: string]: any;
    };
export type GeneralSystemObject = EventReader<SystemObject & { type?: Exclude<SystemType, 'unit'> }>;

export interface EngineObject extends SystemObject {
    type: 'engine';
}

export interface AgentObject extends SystemObject {
    type?: 'agent' | 'build';
    settings?: AgentSettings & {
        type?: SC2APIProtocol.PlayerType;
        race?: SC2APIProtocol.Race;
    };
    interface?: SC2APIProtocol.InterfaceOptions;
    onStep?(world: World, gameLoop: number, event?: SystemEvent): Promise<any>;
}

export type AgentSystem = EventReader<AgentObject>;

export type Earmark = {
    name: string;
    minerals: number;
    vespene: number;
};

export interface StorageBlueprint {
    register: (name: string, fn: Function) => void;
    mineralCost: (unitType: number) => number;
    getAbilityData: (abilityId: number) => SC2APIProtocol.AbilityData;
    getEffectData: (effectId: number) => SC2APIProtocol.EffectData;
    getUpgradeData: (upgradeId: number) => SC2APIProtocol.UpgradeData;
    getUnitTypeData: (unitTypeId: number) => SC2APIProtocol.UnitTypeData;
    findUnitTypesWithAbility: (abilityId: number) => number[];
    addEarmark: (earmark: Earmark) => Earmark[] | DataStorage;
    getEarmarkTotals: (earmarkName?: string | null) => Cost;
    settleEarmark: (earmarkName: string) => Earmark[];
}

export type DataStorage = StorageBlueprint & Map<string, any>;

export type MemorySettings = { expireGround: number; expireAir: number };

export interface EnemyMemory {
    getGhosts(): Units;
    getSnapshots(): Units;
    getEnemies(opts?: { includeGhosts?: boolean; structures?: boolean }): Units;
    forget(tag: string): void;
    configure(settings: Partial<MemorySettings>): void;
}

export type SpatialKind = 'enemy' | 'enemyGround' | 'enemyAir' | 'own' | 'ownGround' | 'ownAir';

export interface SpatialIndex {
    unitsInRange(from: Point2D | Unit, distance: number, kind: SpatialKind): Units;
    anyInRange(from: Point2D | Unit, distance: number, kind: SpatialKind): boolean;
    closest(from: Point2D | Unit, kind: SpatialKind, maxDistance?: number): Unit | undefined;
}

export type InfluenceLayer = 'ground' | 'air' | 'groundAvoidance' | 'airAvoidance';

export interface InfluenceGrid {
    readonly layer: InfluenceLayer;
    readonly width: number;
    readonly height: number;
    readonly data: Float32Array;
    get(point: Point2D): number;
}

export type InfluenceSettings = {
    rangeBuffer: number;
    effectsRangeBuffer: number;
    costMultiplier: number;
    effects: Partial<Record<number, { cost: number; range: number }>>;
};

export interface InfluenceResource {
    getGrid(layer: InfluenceLayer): InfluenceGrid;
    addCost(layers: InfluenceLayer | InfluenceLayer[], center: Point2D, radius: number, weight: number): void;
    configure(settings: Partial<InfluenceSettings>): void;
    drawDebug(layer: InfluenceLayer, opts?: { threshold?: number }): void;
}

export type PathOptions = { layer?: InfluenceLayer | InfluenceGrid; sensitivity?: number; maxExpanded?: number };

export interface PathingResource {
    findPath(start: Point2D, goal: Point2D, opts?: PathOptions): Point2D[];
    nextPoint(
        start: Point2D,
        goal: Point2D,
        opts?: PathOptions & { senseDanger?: boolean; dangerDistance?: number; dangerThreshold?: number },
    ): Point2D;
    closestSafeSpot(
        from: Point2D,
        opts?: { layer?: InfluenceLayer | InfluenceGrid; radius?: number },
    ): Point2D | undefined;
    isPositionSafe(point: Point2D, opts?: { layer?: InfluenceLayer | InfluenceGrid; limit?: number }): boolean;
}

export type RoleSettings = {
    defaultRole: (unit: Unit) => UnitRole | undefined;
    exclusive: UnitRole[];
};

export interface RolesResource {
    assign(units: Unit | Unit[] | string | string[], role: UnitRole): void;
    clear(units: Unit | Unit[] | string | string[]): void;
    switchRole(from: UnitRole, to: UnitRole): void;
    get(roles: UnitRole | UnitRole[], opts?: { types?: number | number[]; excludeTypes?: number | number[] }): Units;
    roleOf(unit: Unit | string): UnitRole | undefined;
    getTags(role: UnitRole): ReadonlySet<string>;
    as<T>(role: UnitRole, fn: () => T, opts?: { priority?: number }): T;
    mayCommand(owner: string, tag: string): boolean;
    configure(settings: Partial<RoleSettings>): void;
}

export type Squad = {
    id: string;
    role: UnitRole;
    units: Units;
    tags: ReadonlySet<string>;
    position: Point2D;
    isMain: boolean;
};

export interface SquadsResource {
    getSquads(role: UnitRole, opts?: { radius?: number; types?: number | number[] }): Squad[];
    getMainSquad(role: UnitRole, opts?: { radius?: number; types?: number | number[] }): Squad | undefined;
    getMainSquadPosition(role: UnitRole, opts?: { types?: number | number[] }): Point2D;
}

export type IntelFlag =
    | 'workerRush'
    | 'lingRush'
    | 'roachRush'
    | 'ravagerRush'
    | 'marineRush'
    | 'marauderRush'
    | 'fourGate'
    | 'proxyZealot'
    | 'proxy'
    | 'reaper'
    | 'expanded'
    | 'baseOutsideNatural'
    | 'greedy'
    | 'rushed';

export type EnemyStrategyDetected = { flag: IntelFlag; gameLoop: number };

export type BaseThreat = { townhall: Unit; ground: Units; air: Units; groundSupply: number; airSupply: number };

export type IntelSettings = {
    groundNearBase: number;
    airNearBase: number;
    groundLeavingBase: number;
    airLeavingBase: number;
    greedyTwoBaseBefore: number;
    greedyThreeHatchBefore: number;
};

export interface IntelResource {
    getBaseThreats(): BaseThreat[];
    getMainThreat(kind: 'ground' | 'air'): BaseThreat | undefined;
    has(flag: IntelFlag): boolean;
    detectedAt(flag: IntelFlag): number | undefined;
    getProxies(): Units;
    configure(settings: Partial<IntelSettings>): void;
}

export type BuildingSize = '2x2' | '3x3' | '5x5';

export type PlacementFlag =
    | 'wall'
    | 'reaperWall'
    | 'bunker'
    | 'supplyDepot'
    | 'production'
    | 'upgradeStructure'
    | 'missileTurret'
    | 'sensorTower'
    | 'staticDefence'
    | 'productionPylon'
    | 'optimalPylon'
    | 'custom';

export type PlacementState = 'available' | 'reserved' | 'taken';

export type Placement = {
    readonly pos: Point2D;
    readonly size: BuildingSize;
    readonly base: Point2D;
    readonly flags: ReadonlySet<PlacementFlag>;
    readonly state: PlacementState;
    readonly tag?: string;
    readonly reservedAt?: number;
};

export type PlacementRequest = {
    base?: Point2D;
    closestTo?: Point2D;
    flags?: PlacementFlag[];
    findAlternative?: boolean;
    reserve?: boolean;
    powered?: boolean;
    pylonBuildProgress?: number;
};

export type UserPlacement = { pos: Point2D; size?: BuildingSize; unitType?: number; flags?: PlacementFlag[] };

export type PlacementSettings = { reservationTimeout: number };

export interface PlacementResource {
    request(unitType: number, opts?: PlacementRequest): Point2D | undefined;
    reserve(pos: Point2D): boolean;
    release(pos: Point2D): void;
    canPlace(unitType: number, pos: Point2D, opts?: { includeAddon?: boolean }): boolean;
    getPlacements(filter?: {
        base?: Point2D;
        size?: BuildingSize;
        state?: PlacementState;
        flag?: PlacementFlag;
    }): Placement[];
    add(placements: UserPlacement[]): void;
    configure(settings: Partial<PlacementSettings>): void;
    drawDebug(): void;
}

export type TrackedBuildStatus = 'moving' | 'ordered' | 'constructing' | 'done' | 'failed';

export type TrackedBuild = {
    readonly id: number;
    readonly unitType: number;
    readonly target: Point2D;
    readonly geyserTag?: string;
    readonly workerTag?: string;
    readonly status: TrackedBuildStatus;
    readonly requestedAt: number;
    readonly attempts: number;
    readonly structureTag?: string;
    readonly failure?: 'timeout' | 'cancelled' | 'noWorker' | 'noPlacement' | 'blocked';
};

export type BuildOptions = {
    at?: Point2D | Unit;
    placement?: PlacementRequest;
    worker?: Unit;
    earmark?: string;
};

export type BuildingSettings = {
    priority: number;
    timeout: number;
    maxAttempts: number;
    cancelLowHp: 'tracked' | 'all' | 'off';
};

export interface BuildingTracker {
    build(unitType: number, opts?: BuildOptions): TrackedBuild | undefined;
    buildGas(opts?: { geyser?: Unit; max?: number }): TrackedBuild | undefined;
    cancel(target: Unit | TrackedBuild): void;
    pending(unitType?: number): number;
    getTracked(): readonly TrackedBuild[];
    configure(settings: Partial<BuildingSettings>): void;
}

export type MiningSettings = {
    enabled: boolean;
    priority: number;
    workersPerGas: number;
    speedMining: boolean;
    townhallDistanceFactor: number;
    keepSafe: boolean;
    fleeAtHealth: number;
    weightSafetyLimit: number;
    selfDefence: boolean;
    longDistanceMine: boolean;
};

export type MiningAssignment = { kind: 'mineral' | 'gas'; resourceTag: string; townhallTag: string };

export interface MiningResource {
    selectWorker(near: Point2D, opts?: { forceClose?: boolean; minHealth?: number; role?: UnitRole }): Unit | undefined;
    release(worker: Unit | string): void;
    getAssignment(worker: Unit | string): MiningAssignment | undefined;
    getWorkersOn(resource: Unit | string): string[];
    getMineralTarget(mineral: Unit | string): Point2D | undefined;
    configure(settings: Partial<MiningSettings>): void;
}

export type FlightPlan = {
    readonly tag: string;
    readonly destination: Point2D;
    readonly land: boolean;
    readonly state: 'lifting' | 'flying' | 'landing';
    readonly startedAt: number;
};

export interface FlyingStructures {
    move(structure: Unit, destination: Point2D, opts?: { land?: boolean }): void;
    swap(a: Unit, b: Unit): void;
    addonSwap(structure: Unit | number, addon: number): boolean;
    cancel(structure: Unit | string): void;
    getPlans(): readonly FlightPlan[];
    configure(settings: Partial<{ priority: number }>): void;
}

export interface ResourceContainer {
    actions: ActionManager;
    events: EventChannel;
    frame: FrameResource;
    map: MapResource;
    units: UnitResource;
    memory: EnemyMemory;
    spatial: SpatialIndex;
    influence: InfluenceResource;
    pathing: PathingResource;
    roles: RolesResource;
    squads: SquadsResource;
    intel: IntelResource;
    placement: PlacementResource;
    buildings: BuildingTracker;
    mining: MiningResource;
    flying: FlyingStructures;
    debug?: Debugger;
    placer?: Placer;
}

export type ResourceDefinition<K extends keyof ResourceContainer = keyof ResourceContainer> = {
    name: K;
    create(world: World): NonNullable<ResourceContainer[K]>;
    reset?(resource: NonNullable<ResourceContainer[K]>, world: World): void;
    onStep?(resource: NonNullable<ResourceContainer[K]>, world: World): void;
};

export type Placer = {
    place?: (world: World, unitTypeId: number) => Point2D[] | undefined;
    placements?: (world: World) => UserPlacement[] | undefined;
};

export type IncomingResources = Partial<ResourceContainer>;

export interface ResourceManager {
    set: (resource: IncomingResources) => void;
    get: () => Readonly<ResourceContainer>;
    register<K extends keyof ResourceContainer>(definition: ResourceDefinition<K>): NonNullable<ResourceContainer[K]>;
    reset(world: World): void;
    step(world: World): void;
}

export interface World {
    agent: Agent;
    data: DataStorage;
    resources: ResourceManager;
    baseBuild?: number;
}

export type EngineOptions = {
    host?: string;
    port?: number;
    launch?: boolean;
    force?: boolean;
    client?: NodeSC2Proto.ProtoClient;
    onGameEnd?: (results: SC2APIProtocol.PlayerResult[]) => void;
};

export type GameResult = [World, SC2APIProtocol.PlayerResult[]];

export type CreateGameOptions = {
    randomSeed?: number;
    disableFog?: boolean;
};

export type RunGameOptions = CreateGameOptions & {
    realtime?: boolean;
    gameTimeLimit?: number;
    saveReplayAs?: string;
};

export type ReplayOptions = {
    observedPlayerId?: number;
    realtime?: boolean;
};

export type GamePlayer = {
    type: number;
    race: number;
    agent?: Agent;
    difficulty?: number;
    aiBuild?: number;
    playerName?: string;
};

export type Sc2Install = {
    executablePath: string;
    basePath: string;
};

export type LauncherOptions = {
    listen?: string;
    port?: number;
    force?: boolean;
    forceAll?: boolean;
    displayMode?: number;
};

export type Launcher = (options?: LauncherOptions) => Promise<ChildProcess | number | undefined>;

export interface Engine {
    _lastRequest?: [number, number] | null;
    _loopDelay?: number;
    _totalLoopDelay?: number;
    _gameLeft: boolean;
    launcher: Launcher;
    use(systems: SystemWrapper<EngineObject>): void;
    use(systems: SystemWrapper<EngineObject>[]): void;
    connect: () => Promise<SC2APIProtocol.ResponsePing>;
    runGame: (map: string, players: GamePlayer[], options?: RunGameOptions) => Promise<GameResult>;
    runBotVsBot: (
        map: string,
        players: [GamePlayer, GamePlayer],
        options?: RunGameOptions,
    ) => Promise<[GameResult, GameResult]>;
    runReplay: (agent: Agent, replayPath: string, options?: ReplayOptions) => Promise<GameResult>;
    createGame: (
        map?: string,
        playerSetup?: SC2APIProtocol.PlayerSetup[],
        realtime?: boolean,
        options?: CreateGameOptions,
    ) => Promise<SC2APIProtocol.ResponseCreateGame | undefined>;
    joinGame: (agent: Agent, options?: object) => Promise<GameResult>;
    runLoop: () => Promise<GameResult>;
    dispatch: () => Promise<any>;
    systems: SystemWrapper<EngineObject>[];
    firstRun: () => Promise<GameResult>;
    setupGame: () => Promise<void>;
    getWorld: () => World;
    onGameEnd: (results: SC2APIProtocol.PlayerResult[]) => GameResult;
}

export type AAShape = {
    pos: Point2D;
    w: number;
    h: number;
};

export type Footprint = {
    w: number;
    h: number;
};
