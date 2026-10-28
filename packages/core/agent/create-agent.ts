import createDebug from 'debug';
import * as UnitType from '../constants/unit-type.ts';
import { Alliance, Race, PlayerType, Attribute } from '../constants/enums.ts';
import { halfSupplyTypes } from '../constants/groups.ts';
import { trainedFrom } from '../constants/dicts/trained-from.ts';
import { NodeSC2Error } from '../engine/errors.ts';
import { NOOP } from '../utils/collections.ts';
import { macroHelpers } from './macro.ts';
import { affordable } from '../utils/economy.ts';
import type { Agent, Cost, EventReader, AgentObject, World, SystemWrapper, System } from '../types.ts';

const debug = createDebug('sc2:debug:Bot');
const PLAYABLE_RACES: SC2APIProtocol.Race[] = [Race.TERRAN, Race.ZERG, Race.PROTOSS];

const FREE_MORPH_LINK_NAMES = ['Lower', 'Raise', 'Land', 'Lift', 'Hold', 'Harvest'];

const toCost = ({
    mineralCost = 0,
    vespeneCost = 0,
}: SC2APIProtocol.UnitTypeData | SC2APIProtocol.UpgradeData): Cost => ({ minerals: mineralCost, vespene: vespeneCost });

// The API rounds an odd count of half-supply units down
function zergSupplyCorrection(world: World | null): number {
    if (!world || world.agent.race !== Race.ZERG) return 0;
    return world.resources.get().units.getById(halfSupplyTypes).length % 2;
}

function shadowWithValue(target: object, key: string, value: number) {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

// Morphs are charged net of the unit they consume, which the API's total cost hides
function morphCost(world: World, unitData: SC2APIProtocol.UnitTypeData): Cost | null {
    const units: SC2APIProtocol.UnitTypeData[] = world.data.get('units');
    const supplyCost = unitData.foodRequired ?? 0;
    const producers = trainedFrom[unitData.unitId!] ?? [];
    if (supplyCost > 0 && producers.length === 1) {
        const [producer] = producers;
        const producerSupply = units[producer]?.foodRequired ?? 0;
        if (producerSupply > 0 && producerSupply <= supplyCost) {
            const producerCost =
                producer === UnitType.ZERGLING ? { minerals: 25, vespene: 0 } : unitCost(world, producer);
            return {
                minerals: (unitData.mineralCost ?? 0) - producerCost.minerals,
                vespene: (unitData.vespeneCost ?? 0) - producerCost.vespene,
            };
        }
    }

    const techAlias = unitData.techAlias ?? [];
    // Add-on tech aliases (TECHLAB/REACTOR) cost nothing in the API
    if (techAlias.length === 0 || techAlias[0] === UnitType.TECHLAB || techAlias[0] === UnitType.REACTOR) {
        return null;
    }
    return {
        minerals: (unitData.mineralCost ?? 0) - Math.max(...techAlias.map((alias) => units[alias]?.mineralCost ?? 0)),
        vespene: (unitData.vespeneCost ?? 0) - Math.max(...techAlias.map((alias) => units[alias]?.vespeneCost ?? 0)),
    };
}

function unitCost(world: World, unitTypeId: number): Cost {
    const { data } = world;
    const unitData: SC2APIProtocol.UnitTypeData | undefined = data.get('units')[unitTypeId];
    if (!unitData?.abilityId) return { minerals: 0, vespene: 0 };

    const linkName = data.getAbilityData(unitData.abilityId)?.linkName ?? '';
    if (FREE_MORPH_LINK_NAMES.some((free) => linkName.includes(free))) return { minerals: 0, vespene: 0 };

    if (unitTypeId === UnitType.ZERGLING) {
        const { minerals, vespene } = toCost(unitData);
        return { minerals: minerals * 2, vespene: vespene * 2 };
    }

    const morph = morphCost(world, unitData);
    if (morph) return morph;

    const cost = toCost(unitData);
    // Zerg structures include the consumed drone
    if (unitData.race === Race.ZERG && (unitData.attributes ?? []).includes(Attribute.STRUCTURE)) {
        return { minerals: cost.minerals - 50, vespene: cost.vespene };
    }
    return cost;
}

export default function createAgent(blueprint: EventReader<AgentObject> = {} as EventReader<AgentObject>): Agent {
    debug('new bot created with options:', blueprint);

    return {
        ...macroHelpers,
        get supplyCap() {
            return this.foodCap ?? 0;
        },
        set supplyCap(value: number) {
            shadowWithValue(this, 'supplyCap', value);
        },
        get supplyUsed() {
            return (this.foodUsed ?? 0) + zergSupplyCorrection(this._world);
        },
        set supplyUsed(value: number) {
            shadowWithValue(this, 'supplyUsed', value);
        },
        get supplyLeft() {
            return this.supplyCap - this.supplyUsed;
        },
        set supplyLeft(value: number) {
            shadowWithValue(this, 'supplyLeft', value);
        },
        get supplyArmy() {
            return (this.foodArmy ?? 0) + zergSupplyCorrection(this._world);
        },
        set supplyArmy(value: number) {
            shadowWithValue(this, 'supplyArmy', value);
        },
        get supplyWorkers() {
            return this.foodWorkers ?? 0;
        },
        set supplyWorkers(value: number) {
            shadowWithValue(this, 'supplyWorkers', value);
        },
        calculateCost(unitTypeId) {
            if (unitTypeId === UnitType.REACTOR) return { minerals: 50, vespene: 50 };
            if (unitTypeId === UnitType.TECHLAB) return { minerals: 50, vespene: 25 };
            if (unitTypeId === UnitType.BANELING) return { minerals: 25, vespene: 25 };
            if (unitTypeId === UnitType.ARCHON) return toCost(this._world.data.get('units')[UnitType.ARCHON]);
            return unitCost(this._world, unitTypeId);
        },
        calculateUpgradeCost(upgradeId) {
            const upgradeData = this._world.data.getUpgradeData(upgradeId);
            if (!upgradeData) throw new NodeSC2Error(`No upgrade data for upgrade ${upgradeId}`);
            return toCost(upgradeData);
        },
        calculateSupplyCost(unitTypeId) {
            if (unitTypeId === UnitType.ZERGLING) return 1;
            if (unitTypeId === UnitType.BANELING) return 0;

            const units: SC2APIProtocol.UnitTypeData[] = this._world.data.get('units');
            const supplyCost = units[unitTypeId]?.foodRequired ?? 0;
            const producers = trainedFrom[unitTypeId] ?? [];
            if (supplyCost > 0 && producers.length === 1) {
                const producerSupply = units[producers[0]]?.foodRequired ?? 0;
                if (producerSupply <= supplyCost) return supplyCost - producerSupply;
            }
            return supplyCost;
        },
        canFeed(unitTypeId) {
            const required = this.calculateSupplyCost(unitTypeId);
            return required <= 0 || this.supplyLeft >= required;
        },
        ...blueprint,
        _world: null as unknown as World,
        inGame: false,
        systems: [],
        use(sys) {
            const addSys = (s: SystemWrapper<System>) => {
                this.systems.push(s);
                if (this.inGame) {
                    s.setup(this._world, true);
                }
            };

            if (Array.isArray(sys)) {
                sys.forEach((s) => addSys(s));
            } else {
                addSys(sys);
            }
        },
        settings: {
            type: PlayerType.PARTICIPANT,
            race: Race.RANDOM,
            ...blueprint.settings,
        },
        interface: blueprint.interface || { raw: true, score: true, rawCropToPlayableArea: true },
        canAfford(unitTypeId, { earmark, count = 1, supply = false } = {}) {
            const unitCost = this.calculateCost(unitTypeId);
            const total = { minerals: unitCost.minerals * count, vespene: unitCost.vespene * count };
            if (!affordable(this._world, total, earmark)) return false;
            if (supply && this.calculateSupplyCost(unitTypeId) * count > this.supplyLeft) return false;
            if (earmark) this._world.data.settleEarmark(earmark);
            return true;
        },
        canAffordUpgrade(upgradeId, { earmark } = {}) {
            if (!affordable(this._world, this.calculateUpgradeCost(upgradeId), earmark)) return false;
            if (earmark) this._world.data.settleEarmark(earmark);
            return true;
        },
        hasTechFor(unitTypeId) {
            return this.techRequirementProgress(unitTypeId) >= 1;
        },
        setup(world) {
            this._world = world;
            const { events } = world.resources.get();

            this.readerId = events.createReader('agent');
            return blueprint.setup ? blueprint.setup(world) : this.readerId;
        },
        async onStep(world, gameLoop, event) {
            const { frame, events } = world.resources.get();
            const observation = frame.getObservation();

            const previousUpgrades = this.upgradeIds ?? [];
            observation
                .rawData!.player!.upgradeIds!.filter((upgrade) => !previousUpgrades.includes(upgrade))
                .forEach((upgrade) => {
                    events.write({
                        name: 'upgradeComplete',
                        data: upgrade,
                    });
                });

            Object.assign(this, observation.rawData!.player, observation.playerCommon);

            if (!PLAYABLE_RACES.includes(this.opponent?.race!)) {
                const [enemy] = world.resources.get().units.getAlive(Alliance.ENEMY);
                const race = enemy && world.data.getUnitTypeData(enemy.unitType)?.race;
                if (race !== undefined && PLAYABLE_RACES.includes(race)) {
                    this.opponent = Object.assign(this.opponent ?? {}, { race });
                    events.write({ name: 'enemyRaceDetected', data: race });
                }
            }

            return blueprint.onStep ? blueprint.onStep(world, gameLoop ?? frame.getGameLoop(), event) : NOOP;
        },
        async onGameStart(world, data, event) {
            this.inGame = true;

            const { frame } = world.resources.get();

            const gameInfo = frame.getGameInfo();

            const thisPlayer = gameInfo.playerInfo!.find((player) => player.playerId === this.playerId);
            const enemyPlayer = gameInfo.playerInfo!.find((player) => player.playerId !== this.playerId);

            // missing only when reconnecting to a game where our playerId wasn't 1
            if (thisPlayer) {
                this.race = thisPlayer.raceActual;
            }

            // enemyPlayer is missing only on custom or test maps that don't assign playerIds sensibly
            const requested = enemyPlayer?.raceRequested;
            this.opponent = Object.assign(this.opponent ?? {}, {
                race: requested !== undefined && requested !== Race.RANDOM ? requested : Race.NORACE,
            });

            return blueprint.onGameStart ? blueprint.onGameStart(world, data, event) : NOOP;
        },
    };
}
