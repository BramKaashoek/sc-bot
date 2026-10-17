import createDebug from 'debug';
import { Race, PlayerType } from '../constants/enums.ts';
import type { Agent, EventReader, AgentObject, World, SystemWrapper, System } from '../types.ts';

const debug = createDebug('sc2:debug:Bot');
const NOOP = () => {};

export default function createAgent(blueprint: EventReader<AgentObject> = {} as EventReader<AgentObject>): Agent {
    debug('new bot created with options:', blueprint);

    // TODO(ts): literal omits PlayerData fields that are populated from the observation in onStep
    return {
        ...blueprint,
        _world: null as unknown as World,
        inGame: false,
        systems: [],
        use(sys) {
            const addSys = (s: SystemWrapper<System>) => {
                this.systems.push(s);
                if (this.inGame) {
                    // TODO(ts): runtime passes a second arg that SystemWrapper.setup doesn't declare
                    (s.setup as (world: World, flag: boolean) => void)(this._world, true);
                }
            };

            if (Array.isArray(sys)) {
                sys.forEach(s => addSys(s));
            } else {
                addSys(sys);
            }
        },
        settings: {
            type: PlayerType.PARTICIPANT,
            race: Race.RANDOM,
            ...blueprint.settings,
        },
        interface: blueprint.interface || { raw: true, rawCropToPlayableArea: true },
        canAfford(unitTypeId, earmarkName) {
            const { data } = this._world;
            const { minerals, vespene } = this as Required<Pick<Agent, 'minerals' | 'vespene'>>;

            const earmarks = data.getEarmarkTotals(earmarkName!);
            const unitType = data.getUnitTypeData(unitTypeId);

            // console.log("current earmarks", earmarks);
            // console.log("mineral cost:", unitType.mineralCost!);
            
            const result = (
                (minerals - earmarks.minerals >= unitType.mineralCost!) &&
                (unitType.vespeneCost ? vespene - earmarks.vespene >= unitType.vespeneCost : true)
            );

            if (result) {
                if (earmarkName) {
                    data.settleEarmark(earmarkName);
                }
                return true;
            } else {
                return false;
            }
        },
        canAffordN(unitTypeId, maxN = 1) {
            const { data } = this._world;
            const { minerals, vespene } = this as Required<Pick<Agent, 'minerals' | 'vespene'>>;

            const unitType = data.getUnitTypeData(unitTypeId);
            
            const checkResult = (n: number) => (
                (minerals >= (unitType.mineralCost! * n)) &&
                (unitType.vespeneCost ? vespene >= (unitType.vespeneCost * n) : true)
            );

            for (let i = maxN; i > 0; i -= 1) {
                if (checkResult(i)) return i;
            }

            return 0;
        },
        canAffordUpgrade(upgradeId: number, earmarkName?: string) {
            const { data } = this._world;
            const { minerals, vespene } = this as Required<Pick<Agent, 'minerals' | 'vespene'>>;

            const earmarks = data.getEarmarkTotals(earmarkName!);
            const upgrade = data.getUpgradeData(upgradeId);

            const result = (
                (minerals - earmarks.minerals >= upgrade.mineralCost!) &&
                (upgrade.vespeneCost ? vespene - earmarks.vespene >= upgrade.vespeneCost : true)
            );

            if (result) {
                if (earmarkName) {
                    data.settleEarmark(earmarkName);
                }
                return true;
            } else {
                return false;
            }
        },
        hasTechFor(unitTypeId) {
            const { data, resources } = this._world;
            const { units } = resources.get();

            const { techRequirement } = data.getUnitTypeData(unitTypeId);
            const { techAlias } = data.getUnitTypeData(techRequirement!);

            const needsOneOf = [ techRequirement!, ...techAlias!];

            // if has no tech requirements
            if (techRequirement === 0 || needsOneOf.length <= 0) {
                return true;
            }

            // see if there's other tech aliases to satisfy these
            const needsOneOfAny = needsOneOf.reduce((acc: number[], techUnitType) => {
                const aliases = data.get('units').filter((utd: SC2APIProtocol.UnitTypeData) => utd.techAlias!.includes(techUnitType));
                if (aliases.length > 0) {
                    const aliasUnitIds = aliases.map((alias: SC2APIProtocol.UnitTypeData) => alias.unitId);
                    acc = acc.concat([techUnitType, ...aliasUnitIds]);
                } else {
                    acc = acc.concat([techUnitType]);
                }
                return acc;
            }, []);

            return needsOneOfAny.some((requirementTypeId) => {
                return units.getById(requirementTypeId, { buildProgress: 1 }).length > 0;
            });
        },
        setup(world) {
            this._world = world;
            const { events } = world.resources.get();

            this.readerId = events.createReader('agent');
            return blueprint.setup ? blueprint.setup(world) : this.readerId;
        },
        async onStep(world) {
            const { frame, events } = world.resources.get();
            const observation = frame.getObservation();
            
            const previousUpgrades = this.upgradeIds ?? [];
            observation.rawData!.player!.upgradeIds!
                .filter(upgrade => !previousUpgrades.includes(upgrade))
                .forEach((upgrade) => {
                    events.write({
                        name: 'upgradeComplete',
                        data: upgrade,
                    });
                });

            Object.assign(
                this, 
                observation.rawData!.player, // { powerSources: [{PowerSource}, ...], upgradeIds: [int, ...], camera: Point}
                observation.playerCommon // { minerals, vespenese, foodCap, ... }
            );

            // TODO(ts): EventConsumer.onStep declares a gameLoop param the original never passed
            return blueprint.onStep ? (blueprint.onStep as (world: World) => Promise<any>)(world) : NOOP;
        },
        async onGameStart(world) {
            this.inGame = true;

            const { frame } = world.resources.get();

            const gameInfo = frame.getGameInfo();

            const thisPlayer = gameInfo.playerInfo!.find(player => player.playerId === this.playerId);
            const enemyPlayer = gameInfo.playerInfo!.find(player => player.playerId !== this.playerId);

            /**
             * this can only really happen while reconnecting to a game where your playerId wasn't 1..
             * unsure what the solution should be here...
             */
            if (thisPlayer) {
                this.race = thisPlayer.raceActual;
            }

            /**
             * this can only really happen in a custom or test map where playerid's aren't handled
             * in any reasonable way... if we're here then assume none of this makes sense anyway.
             */ 
            if (enemyPlayer) {
                /** 
                 * if the enemy requested random, we don't know their race yet - otherwise set it to their raceRequested 
                 * 
                 * @TODO: the first time we see an enemy unit, we should set the value of this on the agent and then 
                 * memoize it
                 */
                this.opponent = {
                    race: enemyPlayer.raceRequested !== Race.RANDOM ? enemyPlayer.raceRequested : Race.NORACE,
                };
            }

            return blueprint.onGameStart ? blueprint.onGameStart(world) : NOOP;
        }
    } as Agent;
}