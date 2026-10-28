import createDebug from 'debug';
import Color from '../constants/color.ts';
import { asArray, toTags } from '../utils/collections.ts';
import getRandom from '../utils/get-random.ts';
import { cellsInFootprint } from '../utils/geometry/plane.ts';
import { add, createPoint2D } from '../utils/geometry/point.ts';
import type {
    Color as ColorValue,
    Debugger,
    DebugUnitRequest,
    Point2D,
    ResourceDefinition,
    Unit,
    UnitRequest,
    World,
} from '../types.ts';

const debugWidget = createDebug('sc2:DebugWidget');

const GameState = {
    SHOW_MAP: 1,
    CONTROL_ENEMY: 2,
    FOOD: 3,
    FREE: 4,
    ALL_RESOURCES: 5,
    GOD: 6,
    MINERALS: 7,
    GAS: 8,
    COOLDOWN: 9,
    TECH_TREE: 10,
    UPGRADE: 11,
    FAST_BUILD: 12,
} as const;

type WidgetData = { [id: string]: { data: unknown; opts: { title?: string } } };

type DebuggerImpl = Debugger & {
    _drawDebugWidget: (widgetData: WidgetData) => void;
};

function createDebugger(world: World): DebuggerImpl {
    const widgetData: WidgetData = {};

    let commands: { [key: string]: SC2APIProtocol.DebugCommand[] } = {};
    let tempCommands: { [key: string]: SC2APIProtocol.DebugCommand[] } = {};
    let tempBoxCount = 0;
    let boxLoop: number | undefined;

    const client = () => world.resources.get().actions._client;
    const sendGameState = (gameState: number) => client().debug({ debug: [{ gameState }] });

    return {
        touched: false,
        updateScreen() {
            const {
                actions: { _client },
            } = world.resources.get();

            if (debugWidget.enabled) {
                this._drawDebugWidget(widgetData);
            }

            const debugCommands = Object.values(commands).reduce<SC2APIProtocol.DebugCommand[]>((commands, command) => {
                return commands.concat(command);
            }, []);

            const debugTempCommands = Object.values(tempCommands).reduce<SC2APIProtocol.DebugCommand[]>(
                (commands, command) => {
                    return commands.concat(command);
                },
                [],
            );

            tempCommands = {};
            return _client.debug({ debug: debugCommands.concat(debugTempCommands) });
        },
        removeCommand(id) {
            this.touched = true;
            const textId = `${id}-text-0`;
            const { [id]: ignored, [textId]: ignored2, ...commandsToKeep } = commands;
            commands = commandsToKeep;
        },
        setRegions(expansions) {
            this.touched = true;
            commands.regions = expansions.map((expansion) => ({
                draw: {
                    text: expansions.map((expansion, i) => {
                        return {
                            color: Color.RED,
                            text: `DISTANCE ORDER ${i} \n COORDS ${JSON.stringify(createPoint2D(expansion.townhallPosition))}`,
                            worldPos: { ...expansion.townhallPosition, z: expansion.zPosition + 0.5 },
                        };
                    }),
                    boxes: [
                        ...expansion.areas!.mineralLine.map((point) => {
                            return {
                                color: Color.LIME_GREEN,
                                min: { x: point.x + 0.25, y: point.y + 0.25, z: expansion.zPosition },
                                max: { x: point.x + 0.75, y: point.y + 0.75, z: expansion.zPosition + 0.04 },
                            };
                        }),
                        ...expansion.areas!.behindMineralLine.map((point) => {
                            return {
                                color: Color.RED,
                                min: { x: point.x + 0.25, y: point.y + 0.25, z: expansion.zPosition },
                                max: { x: point.x + 0.75, y: point.y + 0.75, z: expansion.zPosition + 0.02 },
                            };
                        }),
                        ...expansion.areas!.areaFill.map((point) => {
                            return {
                                color: Color.GRAY,
                                min: { x: point.x + 0.25, y: point.y + 0.25, z: expansion.zPosition },
                                max: { x: point.x + 0.75, y: point.y + 0.75, z: expansion.zPosition + 0.01 },
                            };
                        }),
                        ...expansion.areas!.hull.map((point) => {
                            return {
                                color: Color.YELLOW,
                                min: { x: point.x + 0.25, y: point.y + 0.25, z: expansion.zPosition },
                                max: { x: point.x + 0.75, y: point.y + 0.75, z: expansion.zPosition + 0.03 },
                            };
                        }),
                        ...cellsInFootprint(expansion.townhallPosition, { w: 5, h: 5 }).map((point) => {
                            return {
                                color: Color.FUCHSIA,
                                min: { x: point.x + 0.25, y: point.y + 0.25, z: expansion.zPosition },
                                max: { x: point.x + 0.75, y: point.y + 0.75, z: expansion.zPosition + 0.05 },
                            };
                        }),
                    ],
                    spheres: [
                        {
                            color: Color.PURPLE,
                            p: { ...expansion.townhallPosition, z: expansion.zPosition + 0.1 },
                            r: 2.75,
                        },
                        {
                            color: Color.GREEN,
                            p: { ...expansion.centroid, z: expansion.zPosition + 0.1 },
                            r: 1,
                        },
                    ],
                },
            }));
        },
        setDrawLines(id, wLines, opts = {}) {
            this.touched = true;
            const defaultColor = opts.color || getRandom(Object.values(Color));
            const skipText = opts.includeText !== undefined && !opts.includeText;
            if (wLines.length > 0) {
                commands[id] = [
                    {
                        draw: {
                            lines: wLines.map((wLine, i) => {
                                const p0 = wLine.p0!;
                                const p1 = wLine.p1!;
                                p0.z = (opts.zPos || p0.z || world.resources.get().map.getHeight(p0 as Point2D)) + 0.01;
                                p1.z = (opts.zPos || p1.z || world.resources.get().map.getHeight(p1 as Point2D)) + 0.01;

                                if (!skipText) {
                                    this.setDrawTextWorld(`${id}-text-${i}`, [
                                        {
                                            color: wLine.color || defaultColor,
                                            text: wLine.text ? `${wLine.text}` : `${id}-${i}`,
                                            pos: {
                                                x: (p0.x! + p1.x!) / 2 - 0.5,
                                                y: (p0.y! + p1.y!) / 2 + 0.5,
                                            },
                                        },
                                    ]);
                                }

                                return {
                                    color: wLine.color || defaultColor,
                                    line: { p0, p1 },
                                };
                            }),
                        },
                    },
                ];
            }
        },
        setDrawCells(id, cells, opts = {}) {
            this.touched = true;
            const skipText = opts.includeText !== undefined && !opts.includeText;
            const defaultColor = opts.color || getRandom(Object.values(Color));
            if (cells.length > 0) {
                commands[id] = [
                    {
                        draw: {
                            boxes: cells.map((cell, i) => {
                                const { pos } = cell;

                                const color = cell.color || defaultColor;
                                const size = 1 - (cell.size || opts.size || 0.8);
                                const zPos =
                                    opts.zPos ||
                                    pos.z ||
                                    world.resources.get().map.getHeight(createPoint2D(pos as Point2D));
                                const height = opts.height
                                    ? opts.height
                                    : opts.cube
                                      ? cell.max
                                          ? 2 - (1 - size) * 2
                                          : 1 - size
                                      : 0.01;

                                if (!skipText) {
                                    this.setDrawTextWorld(
                                        `${id}-text-${i}`,
                                        [
                                            {
                                                pos,
                                                color,
                                                text: cell.text ? `${cell.text}` : `${id}-${i}`,
                                            },
                                        ],
                                        {
                                            temp: opts.persistText ? false : true,
                                        },
                                    );
                                }

                                const max = {
                                    x: (cell.max ? cell.max.x! : pos.x!) + (1 - size / 2),
                                    y: (cell.max ? cell.max.y! : pos.y!) + (1 - size / 2),
                                    z: (cell.max && cell.max.z ? cell.max.z : zPos) + height,
                                };

                                return {
                                    color,
                                    min: { x: pos.x! + size / 2, y: pos.y! + size / 2, z: zPos + 0.02 },
                                    max,
                                };
                            }),
                        },
                    },
                ];
            }
        },
        setDrawSpheres(id, spheres, opts = {}) {
            this.touched = true;
            const skipText = opts.includeText !== undefined && !opts.includeText;
            const setter = opts.temp ? tempCommands : commands;
            if (spheres.length > 0) {
                setter[id] = [
                    {
                        draw: {
                            spheres: spheres.map((wSphere, i) => {
                                const { pos } = wSphere;
                                const zPos =
                                    opts.zPos || pos.z || world.resources.get().map.getHeight(wSphere.pos as Point2D);

                                if (!skipText) {
                                    this.setDrawTextWorld(
                                        `${id}-text-${i}`,
                                        [
                                            {
                                                pos: add(pos as Point2D, 0.25),
                                                text: wSphere.text ? `${wSphere.text}` : `${id}-${i}`,
                                            },
                                        ],
                                        {
                                            temp: opts.persistText ? false : true,
                                        },
                                    );
                                }

                                return {
                                    color: wSphere.color || opts.color || getRandom(Object.values(Color)),
                                    p: { x: pos.x, y: pos.y, z: zPos + 0.01 },
                                    r: wSphere.size || opts.size || 0.5,
                                };
                            }),
                        },
                    },
                ];
            }
        },
        setDrawTextWorld(id, texts, opts = {}) {
            this.touched = true;
            const setter = opts.temp ? tempCommands : commands;
            if (texts.length > 0) {
                setter[id] = [
                    {
                        draw: {
                            text: texts.map((wText) => {
                                const color = wText.color || Color.WHITE;
                                const zPos =
                                    opts.zPos ||
                                    wText.pos.z ||
                                    world.resources.get().map.getHeight(createPoint2D(wText.pos as Point2D));
                                return {
                                    color,
                                    size: opts.size,
                                    text: wText.text,
                                    worldPos: { ...wText.pos, z: zPos },
                                };
                            }),
                        },
                    },
                ];
            }
        },
        setDrawTextScreen(id, texts, opts = {}) {
            this.touched = true;
            if (texts.length > 0) {
                commands[id] = [
                    {
                        draw: {
                            text: texts.map((vText) => {
                                const color = vText.color || opts.color || Color.FIREBRICK;
                                const zPos = opts.zPos || vText.pos.z;
                                return {
                                    color,
                                    size: vText.size || opts.size || 8,
                                    text: vText.text,
                                    virtualPos: { ...vText.pos, z: zPos || undefined },
                                };
                            }),
                        },
                    },
                ];
            }
        },
        useDebugWidget(id, data, opts) {
            widgetData[id] = { data, opts };
        },
        _drawDebugWidget(widgetData) {
            const widgetText = Object.entries(widgetData).reduce<string[]>((widgets, [id, widget]) => {
                const { data, opts } = widget;
                const title = opts.title ? `${opts.title}\n` : `${id}\n`;
                const payload = `${title}${data}\n`;
                return widgets.concat(payload);
            }, []);

            const widgetTitle = 'Global Debug Widget  \n';
            const underline = '-'.repeat(widgetTitle.length - 1) + '\n'; // eslint-disable-line

            this.setDrawTextScreen('GlobalDebugWidget', [
                {
                    size: 16,
                    color: Color.YELLOW,
                    pos: { x: 0.005, y: 0.4 },
                    // eslint-disable-next-line
                    text: `${widgetTitle}${underline}`,
                },
                {
                    size: 12,
                    color: Color.YELLOW,
                    pos: { x: 0.005, y: 0.43 },
                    // eslint-disable-next-line
                    text: widgetText.join('\n'),
                },
            ]);
        },
        async killUnit(units: Unit | Unit[]) {
            // the debug typings declare uint64 tags as numbers, but they travel as strings like Unit.tag
            return client().debug({ debug: [{ killUnit: { tag: toTags(units) as unknown as number[] } }] });
        },
        async setUnitValue(units: Unit | Unit[], unitValue: SC2APIProtocol.DebugSetUnitValue_UnitValue, value: number) {
            return client().debug({
                debug: toTags(units).map((unitTag) => ({
                    unitValue: { unitValue, value, unitTag: unitTag as unknown as number },
                })),
            });
        },
        showMap: () => sendGameState(GameState.SHOW_MAP),
        controlEnemy: () => sendGameState(GameState.CONTROL_ENEMY),
        food: () => sendGameState(GameState.FOOD),
        free: () => sendGameState(GameState.FREE),
        allResources: () => sendGameState(GameState.ALL_RESOURCES),
        god: () => sendGameState(GameState.GOD),
        minerals: () => sendGameState(GameState.MINERALS),
        gas: () => sendGameState(GameState.GAS),
        cooldown: () => sendGameState(GameState.COOLDOWN),
        techTree: () => sendGameState(GameState.TECH_TREE),
        upgrade: () => sendGameState(GameState.UPGRADE),
        fastBuild: () => sendGameState(GameState.FAST_BUILD),
        async moveCamera(target: Unit | Point2D) {
            const { x, y } = 'pos' in target ? target.pos : target;
            return client().action({
                actions: [{ actionRaw: { cameraMove: { centerWorldSpace: { x, y, z: 0 } } } }],
            });
        },
        drawBox(min, max, color: ColorValue = Color.WHITE) {
            this.touched = true;
            const gameLoop = world.resources.get().frame.getGameLoop();
            // updateScreen only runs with the debug system enabled; unsent boxes from earlier loops are stale
            if (gameLoop !== boxLoop) {
                tempCommands = Object.fromEntries(
                    Object.entries(tempCommands).filter(([id]) => !id.startsWith('drawBox-')),
                );
                boxLoop = gameLoop;
            }
            tempCommands[`drawBox-${tempBoxCount++}`] = [{ draw: { boxes: [{ min, max, color }] } }];
        },
        quickSave: () => client().quickSave(),
        quickLoad: () => client().quickLoad(),
        async createUnit(ureqs: DebugUnitRequest | UnitRequest) {
            const unitReqs = asArray(ureqs);

            const {
                actions: { _client: client },
                map,
            } = world.resources.get();

            return client.debug({
                debug: unitReqs.map((ureq) => ({
                    createUnit: {
                        unitType: ureq.unitType,
                        quantity: ureq.quantity || 1,
                        owner: ureq.playerId || world.agent.playerId,
                        pos:
                            ureq.pos ||
                            // own main exists once the game has started
                            getRandom(map.getMain()!.areas!.areaFill.filter((cell) => map.isPlaceable(cell))),
                    },
                })),
            });
        },
    };
}

export const debugResource: ResourceDefinition<'debug'> = {
    name: 'debug',
    create: (world) => createDebugger(world),
};
