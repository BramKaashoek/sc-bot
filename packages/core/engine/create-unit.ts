import * as UnitType from "../constants/unit-type.ts";
import * as Ability from "../constants/ability.ts";
import { TownhallRace } from "../constants/race-map.ts";
import { Alliance, WeaponTargetType, Attribute, CloakState, Race } from "../constants/enums.ts";
import {
    techLabTypes,
    reactorTypes,
    workerTypes,
    gasMineTypes,
    combatTypes,
    mineralFieldTypes,
    gatheringAbilities,
    returningAbilities,
    townhallTypes,
    constructionAbilities,
} from "../constants/groups.ts";
import type { AbilityOptions, Point2D, Unit, World } from "../types.ts";

type ActionResult = Promise<SC2APIProtocol.ResponseAction | undefined>;

type UnitBlueprint = Omit<Unit, keyof SC2APIProtocol.Unit | 'inject' | 'blink' | 'burrow' | 'toggle'>
    & Pick<Unit, 'tag'>
    & {
        inject(target?: Unit): ActionResult;
        blink(target: Point2D, opts?: AbilityOptions): ActionResult;
        burrow(opts?: AbilityOptions): ActionResult;
        toggle(options?: AbilityOptions): ActionResult;
    }
    & ThisType<Required<Unit>>;

/**
 * Unit factory - exclusively for UnitManager use
 */
function createUnit(unitData: SC2APIProtocol.Unit, { data, resources }: World): Unit {
    const { frame, units, actions } = resources.get();

    const { alliance } = unitData;

    const blueprint: UnitBlueprint = {
        tag: unitData.tag,
        lastSeen: frame.getGameLoop(),
        noQueue: unitData.orders!.length === 0,
        labels: new Map(),
        _availableAbilities: [],
        async inject(t) {
            if (this.canInject()) {
                let target;
                if (t) {
                    target = t;
                } else {
                    const [closestIdleHatch] = units.getClosest(
                        this.pos as Point2D,
                        units.getById(TownhallRace[Race.ZERG]),
                        3
                    ).filter(u => u.isIdle());

                    if (closestIdleHatch) {
                        target = closestIdleHatch;
                    } else {
                        return;
                    }
                }

                return actions.do(Ability.EFFECT_INJECTLARVA, this.tag, { target });
            }
        },
        async blink(target, opts = {}) {
            if (this.canBlink()) {
                return actions.do(Ability.EFFECT_BLINK, this.tag, { target, ...opts });
            }
        },
        async burrow(opts = {}) {
            if (this.is(UnitType.WIDOWMINE)) {
                return actions.do(Ability.BURROWDOWN, this.tag, opts);
            }
        },
        async toggle(options = {}) {
            const opts = {
                queue: true,
                ...options
            };

            if (this.is(UnitType.WARPPRISM)) {
                return actions.do(Ability.MORPH_WARPPRISMPHASINGMODE, this.tag, opts);
            } else if (this.is(UnitType.WARPPRISMPHASING)) {
                return actions.do(Ability.MORPH_WARPPRISMTRANSPORTMODE, this.tag, opts);
            } else if (this.is(UnitType.LIBERATOR)) {
                return actions.do(Ability.MORPH_LIBERATORAGMODE, this.tag, opts);
            } else if (this.is(UnitType.LIBERATORAG)) {
                return actions.do(Ability.MORPH_LIBERATORAAMODE, this.tag, opts);
            }
        },
        addLabel(name, value) {
            return this.labels.set(name, value);
        },
        hasLabel(name) {
            return this.labels.has(name);
        },
        removeLabel(name) {
            return this.labels.delete(name);
        },
        hasNoLabels() {
            return [...this.labels.keys()].length <= 0;
        },
        getLabel(name) {
            return this.labels.get(name);
        },
        getLife() {
            return this.health / this.healthMax * 100;
        },
        abilityAvailable(id) {
            return this._availableAbilities.includes(id);
        },
        availableAbilities() {
            return this._availableAbilities;
        },
        data() {
            return data.getUnitTypeData(this.unitType);
        },
        is(type) {
            return this.unitType === type;
        },
        isCloaked() {
            return this.cloak !== CloakState.NOTCLOAKED;
        },
        isConstructing() {
            return this.orders.some(o => constructionAbilities.includes(o.abilityId!));
        },
        isCombatUnit() {
            return combatTypes.includes(this.unitType);
        },
        isEnemy() {
            return this.alliance === Alliance.ENEMY;
        }, 
        isFinished() {
            return this.buildProgress >= 1;
        },
        isHolding() {
            return this.orders.some(o => o.abilityId! === Ability.HOLDPOSITION);
        },
        isTownhall() {
            return townhallTypes.includes(this.unitType);
        },
        isWorker() {
            return workerTypes.includes(this.unitType);
        },
        isMineralField() {
            return mineralFieldTypes.includes(this.unitType);
        },
        isGasMine() {
            return gasMineTypes.includes(this.unitType);
        },
        isReturning() {
            return this.orders.some(o => returningAbilities.includes(o.abilityId!));
        },
        isGathering(type) {
            return this.orders.some(o => {
                if (gatheringAbilities.includes(o.abilityId!)) {
                    if (!type) return true;

                    const gatherTarget = units.getByTag(o.targetUnitTag!);

                    if (gatherTarget) {
                        if (type === 'minerals') {
                            return gatherTarget.isMineralField();
                        }
    
                        if (type === 'vespene') {
                            return gatherTarget.isGasMine();
                        }
                    }
                }
            });
        },
        isCurrent() {
            // if this unit wasn't updated this frame, this will be false
            return this.lastSeen === frame.getGameLoop();
        },
        isIdle() {
            return this.noQueue;
        },
        isStructure() {
            return this.data().attributes!.includes(Attribute.STRUCTURE);
        },
        hasReactor() {
            const addon = units.getByTag(this.addOnTag!);
            return reactorTypes.includes(addon.unitType!);
        },
        hasTechLab() {
            const addon = units.getByTag(this.addOnTag!);
            return techLabTypes.includes(addon.unitType!);
        },
        canInject() {
            return this.abilityAvailable(Ability.EFFECT_INJECTLARVA);
        },
        canBlink() {
            return this.abilityAvailable(Ability.EFFECT_BLINK) || this.abilityAvailable(Ability.EFFECT_BLINK_STALKER);
        },
        canMove() {
            return this._availableAbilities.includes(Ability.MOVE);
        },
        canShootUp() {
            return this.data().weapons!.some(w => w.type !== WeaponTargetType.GROUND);
        },
        update(unit) {
            Object.assign(this, unit, {
                noQueue: unit.orders!.length === 0,
                lastSeen: frame.getGameLoop(),
            });

            /**
             * so this is a perf thing - depending on the version of node it actually
             * made a pretty big difference... but as of v10 it seems okay? keeping
             * for posterity -
             *
             * this.displayType = unit.displayType;
             * this.alliance = unit.alliance;
             * this.unitType = unit.unitType;
             * this.owner = unit.owner;
             * this.pos = unit.pos;
             * this.facing = unit.facing;
             * this.radius = unit.radius;
             * this.buildProgress = unit.buildProgress;
             * this.cloak = unit.cloak;
             * this.detectRange = unit.detectRange;
             * this.radarRange = unit.radarRange;
             * this.isSelected = unit.isSelected;
             * this.isOnScreen = unit.isOnScreen;
             * this.isBlip = unit.isBlip;
             * this.isPowered = unit.isPowered;
             * this.health = unit.health;
             * this.healthMax = unit.healthMax;
             * this.shield = unit.shield;
             * this.shieldMax = unit.shieldMax;
             * this.energy = unit.energy;
             * this.energyMax = unit.energyMax;
             * this.mineralContents = unit.mineralContents;
             * this.vespeneContents = unit.vespeneContents;
             * this.isFlying = unit.isFlying;
             * this.isBurrowed = unit.isBurrowed;
             * this.orders = unit.orders;
             * this.addOnTag = unit.addOnTag;
             * this.passengers = unit.passengers;
             * this.cargoSpaceTaken = unit.cargoSpaceTaken;
             * this.cargoSpaceMax = unit.cargoSpaceMax;
             * this.buffIds = unit.buffIds;
             * this.assignedHarvesters = unit.assignedHarvesters;
             * this.idealHarvesters = unit.idealHarvesters;
             * this.weaponCooldown = unit.weaponCooldown;
             * this.engagedTargetTag = unit.engagedTargetTag;
             * this.noQueue = unit.orders!.length === 0;
             * this.lastSeen = frame.getGameLoop();
             */
        },
    };

    // i promise there's a reason for this that one day i'll figure out
    switch (alliance) {
        case Alliance.ALLY:
        case Alliance.SELF: {
            // TODO(ts): blueprint's action methods may resolve undefined, which Unit's signatures don't allow
            return {
                ...unitData,
                ...blueprint,
            } as Unit;
        }
        case Alliance.ENEMY: {
            // TODO(ts): blueprint's action methods may resolve undefined, which Unit's signatures don't allow
            return {
                ...unitData,
                ...blueprint,
            } as Unit;
        }
        case Alliance.NEUTRAL: {
            // TODO(ts): blueprint's action methods may resolve undefined, which Unit's signatures don't allow
            return {
                ...unitData,
                ...blueprint,
            } as Unit;
        }
        default: {
            throw new Error('CANT CREATE A UNIT WITH NO ALLIANCE, THIS SHOULD NEVER HAPPEN');
        }
    }
}

export default createUnit;
