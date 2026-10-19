/// <reference types="@node-sc2/proto" />

import type { ChildProcess } from 'node:child_process';
import type { BuildOrderStatus, BuildResult } from './constants/enums.ts';
import type { Units } from './resources/units-collection.ts';
import type { Ramp } from './utils/map/ramp.ts';

export type { BuildOrderStatus, BuildResult };

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
    batchActions?: boolean;
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
    inject: (target?: Unit) => Promise<SC2APIProtocol.ResponseAction | undefined>;
    blink: (target: Point2D, opts?: AbilityOptions) => Promise<SC2APIProtocol.ResponseAction | undefined>;
    toggle: (options?: AbilityOptions) => Promise<SC2APIProtocol.ResponseAction | undefined>;
    burrow: (options?: AbilityOptions) => Promise<SC2APIProtocol.ResponseAction | undefined>;
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
    useAbility: (abilityId: AbilityId, options?: AbilityOptions) => Promise<SC2APIProtocol.ResponseAction>;
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

export interface ActionManager {
    _client: NodeSC2Proto.ProtoClient;
    attack(units?: Unit[], unit?: Unit, queue?: boolean): Promise<SC2APIProtocol.ResponseAction>;
    attackMove(u?: Unit[], p?: Point2D, queue?: boolean): Promise<SC2APIProtocol.ResponseAction>;
    build(unitTypeId: number, target?: Unit, worker?: Unit): Promise<SC2APIProtocol.ResponseAction>;
    build(unitTypeId: number, pos?: Point2D | null, worker?: Unit): Promise<SC2APIProtocol.ResponseAction>;
    do(abilityId: number, tags: string, opts?: AbilityOptions): Promise<SC2APIProtocol.ResponseAction>;
    do(abilityId: number, tags: string[], opts?: AbilityOptions): Promise<SC2APIProtocol.ResponseAction>;
    buildGasMine: () => Promise<SC2APIProtocol.ResponseAction>;
    gather: (unit: Unit, mineralField?: Unit, queue?: boolean) => Promise<SC2APIProtocol.ResponseAction>;
    mine: (units: Unit[], target: Unit, queue?: boolean) => Promise<SC2APIProtocol.ResponseAction>;
    move(units: Unit, target: Point2D, queue?: boolean): Promise<SC2APIProtocol.ResponseAction>;
    move(units: Unit[], target: Point2D, queue?: boolean): Promise<SC2APIProtocol.ResponseAction>;
    move(units: Unit, target: Unit, queue?: boolean): Promise<SC2APIProtocol.ResponseAction>;
    move(units: Unit[], target: Unit, queue?: boolean): Promise<SC2APIProtocol.ResponseAction>;
    patrol(
        units: Unit | Unit[],
        positions: [from: Point2D, to: Point2D] | Point2D,
        queue?: boolean,
    ): Promise<SC2APIProtocol.ResponseAction>;
    train: (unitTypeId: number, unit?: Unit) => Promise<SC2APIProtocol.ResponseAction>;
    upgrade: (upgradeId: number, tag?: Unit) => Promise<SC2APIProtocol.ResponseAction>;
    smart(units: Unit[], target: Point2D, queue?: boolean): Promise<SC2APIProtocol.ResponseAction>;
    smart(units: Unit[], target: Unit, queue?: boolean): Promise<SC2APIProtocol.ResponseAction>;
    swapBuildings(unitA: Unit, unitB: Unit): Promise<SC2APIProtocol.ResponseAction[]>;
    warpIn(unitTypeId: number, opts: WarpInOptions): Promise<SC2APIProtocol.ResponseAction>;
    canPlace: (unitTypeId: number, positions: Point2D[]) => Promise<Point2D | false>;
    findPlacement: (unitTypeId: number, near: Point2D, opts?: FindPlacementOptions) => Promise<Point2D | false>;
    sendAction(unitCommand: SC2APIProtocol.ActionRawUnitCommand): Promise<SC2APIProtocol.ResponseAction>;
    sendAction(unitCommand: SC2APIProtocol.ActionRawUnitCommand[]): Promise<SC2APIProtocol.ResponseAction>;
    sendQuery: (query: SC2APIProtocol.RequestQuery) => Promise<SC2APIProtocol.ResponseQuery>;
    stop(units: Unit | Unit[], queue?: boolean): Promise<SC2APIProtocol.ResponseAction>;
    holdPosition(units: Unit | Unit[], queue?: boolean): Promise<SC2APIProtocol.ResponseAction>;
    repair(units: Unit | Unit[], target: Unit, queue?: boolean): Promise<SC2APIProtocol.ResponseAction>;
    returnResource(units: Unit | Unit[], queue?: boolean): Promise<SC2APIProtocol.ResponseAction>;
    queueAction(commands: SC2APIProtocol.ActionRawUnitCommand | SC2APIProtocol.ActionRawUnitCommand[]): void;
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

export type ResourceContainer = {
    actions: ActionManager;
    events: EventChannel;
    frame: FrameResource;
    map: MapResource;
    units: UnitResource;
    debug?: Debugger;
    placer?: Placer;
};

export type Placer = { place?: (world: World, unitTypeId: number) => Point2D[] | undefined };

export type IncomingResources = Partial<ResourceContainer>;

export interface ResourceManager {
    set: (resource: IncomingResources) => void;
    get: () => Readonly<ResourceContainer>;
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
