import * as UnitType from '../constants/unit-type.ts';
import * as Ability from '../constants/ability.ts';
import { TownhallRace } from '../constants/race-map.ts';
import * as Buff from '../constants/buff.ts';
import * as Upgrade from '../constants/upgrade.ts';
import {
    Alliance,
    WeaponTargetType,
    Attribute,
    CloakState,
    Race,
    AbilityDataTarget,
    DisplayType,
} from '../constants/enums.ts';
import {
    damageBonusPerUpgrade,
    offCreepSpeedIncrease,
    offCreepSpeedUpgrade,
    speedAlteringBuffs,
    speedIncrease,
    speedIncreaseOnCreep,
    speedUpgrade,
} from '../constants/combat.ts';
import {
    attackingAbilities,
    carryingMineralsBuffs,
    carryingVespeneBuffs,
    repairingAbilities,
    scvConstructionAbilities,
    transformingAbility,
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
    burrowedTypes,
    toggleAbilities,
} from '../constants/groups.ts';
import { distanceSquared } from '../utils/geometry/point.ts';
import { isFlying, toPoint } from '../resources/units-collection.ts';
import type { DamageVsTarget, Point2D, Point3D, Unit, World } from '../types.ts';
import { GAME_LOOPS_PER_SECOND } from '../constants/time.ts';

type UnitBlueprint = Omit<Unit, keyof SC2APIProtocol.Unit> & Pick<Unit, 'tag'> & ThisType<Required<Unit>>;

const groundTargets: number[] = [WeaponTargetType.GROUND, WeaponTargetType.ANY];
const airTargets: number[] = [WeaponTargetType.AIR, WeaponTargetType.ANY];
const noDamage: DamageVsTarget = [0, 0, 0];
// unit data speeds are per normal-speed second, which is 16 game loops
const LOOPS_PER_NORMAL_SECOND = 16;

const weaponsOf = (unit: Unit): SC2APIProtocol.Weapon[] => unit.data().weapons ?? [];
const hasAttribute = (unit: Unit, attribute: number): boolean => (unit.data().attributes ?? []).includes(attribute);
const isMine = (unit: Unit): boolean => unit.alliance === Alliance.SELF;

// The proto lists no weapons for these two
const canAttack = (unit: Unit): boolean =>
    weaponsOf(unit).length > 0 || unit.unitType === UnitType.BATTLECRUISER || unit.unitType === UnitType.ORACLE;

const canAttackGround = (unit: Unit): boolean =>
    unit.unitType === UnitType.BATTLECRUISER ||
    unit.unitType === UnitType.ORACLE ||
    weaponsOf(unit).some((weapon) => groundTargets.includes(weapon.type!));

const canAttackAir = (unit: Unit): boolean =>
    unit.unitType === UnitType.BATTLECRUISER || weaponsOf(unit).some((weapon) => airTargets.includes(weapon.type!));

const weaponFor = (unit: Unit, targets: number[]): SC2APIProtocol.Weapon | undefined =>
    weaponsOf(unit).find((weapon) => targets.includes(weapon.type!));

const dpsOf = (weapon?: SC2APIProtocol.Weapon): number =>
    weapon ? (weapon.damage! * weapon.attacks!) / weapon.speed! : 0;

const DISPLAY_TYPE_FIXED_BASE_BUILD = 82457;

function createUnit(unitData: SC2APIProtocol.Unit, world: World): Unit {
    const { data, resources } = world;
    const { frame, units, actions } = resources.get();

    const { alliance } = unitData;

    const blueprint: UnitBlueprint = {
        tag: unitData.tag!,
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
                    const [closestIdleHatch] = units
                        .getById(TownhallRace[Race.ZERG])
                        .closestNUnits(this.pos as Point2D, 3)
                        .filter((u) => u.isIdle());

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
            if (burrowedTypes[this.unitType]) {
                return actions.do(Ability.BURROWDOWN, this.tag, opts);
            }
        },
        async toggle(options = {}) {
            const opts = {
                queue: true,
                ...options,
            };

            const abilityId = toggleAbilities[this.unitType];
            if (abilityId) {
                return actions.do(abilityId, this.tag, opts);
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
            return (this.health / this.healthMax) * 100;
        },
        abilityAvailable(id) {
            return this._availableAbilities.includes(id);
        },
        availableAbilities() {
            return this._availableAbilities;
        },
        async fetchAvailableAbilities() {
            const gameLoop = frame.getGameLoop();
            if (this._availableAbilitiesLoop === gameLoop) return this._availableAbilities;

            const response = await actions.sendQuery({ abilities: [{ unitTag: this.tag }] });
            const [abilitiesOfUnit] = response.abilities ?? [];
            this._availableAbilities = (abilitiesOfUnit?.abilities ?? []).map((available) => available.abilityId!);
            this._availableAbilitiesLoop = gameLoop;
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
            return this.orders.some((o) => constructionAbilities.includes(o.abilityId!));
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
            return this.orders.some(
                (o) => o.abilityId! === Ability.HOLDPOSITION || o.abilityId! === Ability.GENERAL_HOLDPOSITION,
            );
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
            return this.orders.some((o) => returningAbilities.includes(o.abilityId!));
        },
        isGathering(type) {
            return this.orders.some((o) => {
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
            return this.lastSeen === frame.getGameLoop();
        },
        isIdle() {
            return this.noQueue;
        },
        isStructure() {
            return this.typeData(this.unitType!)?.attributes?.includes(Attribute.STRUCTURE) ?? false;
        },
        hasReactor() {
            return reactorTypes.includes(units.getByTag(this.addOnTag!)?.unitType!);
        },
        hasTechLab() {
            return techLabTypes.includes(units.getByTag(this.addOnTag!)?.unitType!);
        },
        canInject() {
            return this.abilityAvailable(Ability.EFFECT_INJECTLARVA);
        },
        canBlink() {
            return this.abilityAvailable(Ability.EFFECT_BLINK) || this.abilityAvailable(Ability.EFFECT_BLINK_STALKER);
        },
        canMove() {
            return (
                this._availableAbilities.includes(Ability.MOVE) ||
                this._availableAbilities.includes(Ability.GENERAL_MOVE)
            );
        },
        canShootUp() {
            return this.data().weapons!.some((w) => w.type !== WeaponTargetType.GROUND);
        },
        typeData(unitTypeId) {
            return data.get('units')?.[unitTypeId];
        },
        isUsingAbility(abilityIds) {
            const [current] = this.orders;
            if (!current) return false;
            const wanted = Array.isArray(abilityIds) ? abilityIds : [abilityIds];
            const remapped = data.getAbilityData(current.abilityId!)?.remapsToAbilityId;
            return wanted.includes(current.abilityId!) || (!!remapped && wanted.includes(remapped));
        },
        isMoving() {
            return this.isUsingAbility([Ability.MOVE, Ability.GENERAL_MOVE]);
        },
        isAttacking() {
            return this.isUsingAbility(attackingAbilities);
        },
        isPatrolling() {
            return this.isUsingAbility([Ability.PATROL, Ability.GENERAL_PATROL]);
        },
        isRepairing() {
            return this.isUsingAbility(repairingAbilities);
        },
        isCollecting() {
            return this.isUsingAbility([Ability.HARVEST_GATHER, Ability.HARVEST_RETURN]);
        },
        isConstructingScv() {
            return this.isUsingAbility(scvConstructionAbilities);
        },
        isTransforming() {
            const ability = transformingAbility[this.unitType];
            return ability !== undefined && this.isUsingAbility(ability);
        },
        buffs() {
            return new Set(this.buffIds);
        },
        hasBuff(buffId) {
            return this.buffIds.includes(buffId);
        },
        isCarryingMinerals() {
            return this.buffIds.some((buffId) => carryingMineralsBuffs.includes(buffId));
        },
        isCarryingVespene() {
            return this.buffIds.some((buffId) => carryingVespeneBuffs.includes(buffId));
        },
        isCarryingResource() {
            return this.isCarryingMinerals() || this.isCarryingVespene();
        },
        hasAddOn() {
            return !!this.addOnTag && this.addOnTag !== '0';
        },
        addOnPosition() {
            return { x: this.pos.x + 2.5, y: this.pos.y - 0.5 };
        },
        addOnLandPosition() {
            return { x: this.pos.x - 2.5, y: this.pos.y + 0.5 };
        },
        surplusHarvesters() {
            return this.assignedHarvesters - this.idealHarvesters;
        },
        isLight() {
            return hasAttribute(this, Attribute.LIGHT);
        },
        isArmored() {
            return hasAttribute(this, Attribute.ARMORED);
        },
        isBiological() {
            return hasAttribute(this, Attribute.BIOLOGICAL);
        },
        isMechanical() {
            return hasAttribute(this, Attribute.MECHANICAL);
        },
        isMassive() {
            return hasAttribute(this, Attribute.MASSIVE);
        },
        isPsionic() {
            return hasAttribute(this, Attribute.PSIONIC);
        },
        groundDps() {
            return canAttackGround(this) ? dpsOf(weaponFor(this, groundTargets)) : 0;
        },
        airDps() {
            return canAttackAir(this) ? dpsOf(weaponFor(this, airTargets)) : 0;
        },
        groundRange() {
            if (this.unitType === UnitType.ORACLE) return 4;
            if (this.unitType === UnitType.BATTLECRUISER) return 6;
            return weaponFor(this, groundTargets)?.range ?? 0;
        },
        airRange() {
            if (this.unitType === UnitType.BATTLECRUISER) return 6;
            return weaponFor(this, airTargets)?.range ?? 0;
        },
        sightRange() {
            return this.data().sightRange ?? 0;
        },
        movementSpeed() {
            return this.data().movementSpeed ?? 0;
        },
        realSpeed() {
            const baseSpeed = this.movementSpeed();
            const upgrades = isMine(this) ? (world.agent?.upgradeIds ?? []) : [];
            let speed = baseSpeed;

            if (upgrades.includes(speedUpgrade[this.unitType])) {
                speed *= speedIncrease[this.unitType];
            }

            if (this.unitType in speedIncreaseOnCreep || this.unitType in offCreepSpeedUpgrade) {
                if (resources.get().map.hasCreep(this.pos)) {
                    speed *= speedIncreaseOnCreep[this.unitType] ?? 1;
                } else if (upgrades.includes(offCreepSpeedUpgrade[this.unitType])) {
                    speed *= offCreepSpeedIncrease[this.unitType];
                }

                // Frenzied makes ultralisks immune to speed altering buffs
                if (this.unitType === UnitType.ULTRALISK) return speed;
            }

            if (this.unitType === UnitType.MEDIVAC || this.unitType === UnitType.VOIDRAY) {
                if (this.hasBuff(Buff.MEDIVACSPEEDBOOST)) {
                    speed = baseSpeed * 1.7;
                } else if (this.hasBuff(Buff.VOIDRAYSWARMDAMAGEBOOST)) {
                    speed = baseSpeed * 0.75;
                }
            }

            return this.buffIds.reduce((altered, buffId) => altered * (speedAlteringBuffs[buffId] ?? 1), speed);
        },
        distanceToWeaponReady() {
            const cooldown = canAttack(this) ? this.weaponCooldown : -1;
            return (this.realSpeed() / LOOPS_PER_NORMAL_SECOND) * cooldown;
        },
        weaponReady() {
            return canAttack(this) && this.weaponCooldown === 0;
        },
        targetInRange(target, bonusDistance = 0) {
            let range: number;
            if (canAttackGround(this) && !isFlying(target)) {
                range = this.groundRange();
            } else if (canAttackAir(this) && (isFlying(target) || target.unitType === UnitType.COLOSSUS)) {
                range = this.airRange();
            } else {
                return false;
            }
            return distanceSquared(this.pos, target.pos) <= (this.radius + target.radius! + range + bonusDistance) ** 2;
        },
        inAbilityCastRange(abilityId, target, bonusDistance = 0) {
            const { castRange = 0, target: targetType } = data.getAbilityData(abilityId) ?? {};
            if ('pos' in target) {
                if (targetType !== AbilityDataTarget.UNIT && targetType !== AbilityDataTarget.POINTORUNIT) return false;
                return (
                    distanceSquared(this.pos, target.pos) <=
                    (castRange + this.radius + target.radius! + bonusDistance) ** 2
                );
            }
            if (targetType !== AbilityDataTarget.POINT && targetType !== AbilityDataTarget.POINTORUNIT) return false;
            return Math.sqrt(distanceSquared(this.pos, target)) <= castRange + this.radius + bonusDistance;
        },
        calculateDamageVsTarget(target, ignoreArmor = false, includeOverkillDamage = true) {
            const isBattlecruiser = this.unitType === UnitType.BATTLECRUISER;
            if (!isBattlecruiser && this.unitType !== UnitType.BUNKER) {
                if (!canAttack(this)) return noDamage;
                if (target.unitType !== UnitType.COLOSSUS) {
                    if (!canAttackGround(this) && !isFlying(target)) return noDamage;
                    if (!canAttackAir(this) && isFlying(target)) return noDamage;
                }
            }
            if (!this.isFinished()) return noDamage;

            const ownUpgrades = world.agent?.upgradeIds ?? [];
            const attackLevel = this.attackUpgradeLevel ?? 0;
            const targetHealth = target.health ?? 0;
            const targetShield = target.shield ?? 0;
            let targetHasGuardianShield = false;
            let enemyArmor = 0;
            let enemyShieldArmor = 0;
            if (!ignoreArmor) {
                enemyArmor = (target.data().armor ?? 0) + (target.armorUpgradeLevel ?? 0);
                enemyShieldArmor = target.shieldUpgradeLevel ?? 0;
                // Chitinous plating is only visible on own units
                if (
                    (target.unitType === UnitType.ULTRALISK || target.unitType === UnitType.ULTRALISKBURROWED) &&
                    isMine(target) &&
                    ownUpgrades.includes(Upgrade.CHITINOUSPLATING)
                ) {
                    enemyArmor += 2;
                }
                targetHasGuardianShield = target.hasBuff(Buff.GUARDIANSHIELD);
                if (target.hasBuff(Buff.RAVENSHREDDERMISSILETINT)) {
                    enemyArmor -= 2;
                    enemyShieldArmor -= 2;
                }
            }

            // The proto lists no battlecruiser weapon
            if (isBattlecruiser) {
                if (targetHasGuardianShield) {
                    enemyArmor += 2;
                    enemyShieldArmor += 2;
                }
                const weaponDamage = (isFlying(target) ? 5 : 8) + attackLevel;
                return [weaponDamage - (targetShield ? enemyShieldArmor : enemyArmor), 0.224, 6];
            }

            if (this.unitType === UnitType.BUNKER && this.isEnemy()) {
                // Assumes a bunker full of marines
                return this.isActive ? [24, 0.854, 6] : noDamage;
            }

            const requiredTargets =
                target.unitType === UnitType.COLOSSUS
                    ? [...groundTargets, ...airTargets]
                    : isFlying(target)
                      ? airTargets
                      : groundTargets;
            const targetAttributes = target.data().attributes ?? [];
            const upgradeBonus = damageBonusPerUpgrade[this.unitType] ?? {};

            const damages = weaponsOf(this)
                .filter((weapon) => requiredTargets.includes(weapon.type!))
                .map((weapon): DamageVsTarget => {
                    const weaponBonus = upgradeBonus[weapon.type!] ?? {};
                    let enemyHealth = targetHealth;
                    let enemyShield = targetShield;
                    let attacksLeft = weapon.attacks!;
                    let weaponSpeed = weapon.speed!;
                    let weaponRange = weapon.range!;
                    let remainingDamage = 0;

                    let damagePerAttack = weapon.damage! + (attackLevel ? attackLevel * (weaponBonus.base ?? 1) : 0);
                    const attributeBonuses = (weapon.damageBonus ?? [])
                        .filter((bonus) => targetAttributes.includes(bonus.attribute!))
                        .map((bonus) => {
                            const bonusPerUpgrade = attackLevel ? (weaponBonus[bonus.attribute!] ?? 0) : 0;
                            // Enemy upgrades aren't observable, so only own hellions can get blue flame
                            const blueFlame =
                                bonus.attribute === Attribute.LIGHT &&
                                this.unitType === UnitType.HELLION &&
                                isMine(this) &&
                                ownUpgrades.includes(Upgrade.HIGHCAPACITYBARRELS)
                                    ? 5
                                    : 0;
                            return bonus.bonus! + attackLevel * bonusPerUpgrade + blueFlame;
                        });
                    if (attributeBonuses.length > 0) {
                        damagePerAttack += Math.max(...attributeBonuses);
                    }

                    // Guardian shield only reduces ranged attacks
                    const guardianArmor = targetHasGuardianShield && weaponRange >= 2 ? 2 : 0;
                    if (targetShield > 0) {
                        while (attacksLeft > 0 && enemyShield > 0) {
                            enemyShield -= Math.max(0.5, damagePerAttack - (enemyShieldArmor + guardianArmor));
                            attacksLeft -= 1;
                        }
                        if (enemyShield < 0) {
                            remainingDamage = -enemyShield;
                            enemyShield = 0;
                        }
                    }

                    const healthArmor = enemyArmor + guardianArmor;
                    if (remainingDamage > 0) {
                        enemyHealth -= Math.max(0.5, remainingDamage - healthArmor);
                    }
                    while (attacksLeft > 0 && (includeOverkillDamage || enemyHealth > 0)) {
                        enemyHealth -= Math.max(0.5, damagePerAttack - healthArmor);
                        attacksLeft -= 1;
                    }

                    if (!includeOverkillDamage) {
                        enemyHealth = Math.max(0, enemyHealth);
                        enemyShield = Math.max(0, enemyShield);
                    }
                    const totalDamage = targetHealth + targetShield - enemyHealth - enemyShield;

                    const upgrades = isMine(this) ? ownUpgrades : [];
                    if (this.unitType === UnitType.ZERGLING && upgrades.includes(Upgrade.ZERGLINGATTACKSPEED)) {
                        weaponSpeed /= 1.4;
                    } else if (this.unitType === UnitType.ADEPT && upgrades.includes(Upgrade.ADEPTPIERCINGATTACK)) {
                        weaponSpeed /= 1.45;
                    } else if (this.unitType === UnitType.MARINE && this.hasBuff(Buff.STIMPACK)) {
                        weaponSpeed /= 1.5;
                    } else if (this.unitType === UnitType.MARAUDER && this.hasBuff(Buff.STIMPACKMARAUDER)) {
                        weaponSpeed /= 1.5;
                    } else if (this.unitType === UnitType.HYDRALISK && upgrades.includes(Upgrade.EVOLVEGROOVEDSPINES)) {
                        weaponRange += 1;
                    } else if (this.unitType === UnitType.PHOENIX && upgrades.includes(Upgrade.PHOENIXRANGEUPGRADE)) {
                        weaponRange += 2;
                    } else if (
                        [UnitType.PLANETARYFORTRESS, UnitType.MISSILETURRET, UnitType.AUTOTURRET].includes(
                            this.unitType,
                        ) &&
                        upgrades.includes(Upgrade.HISECAUTOTRACKING)
                    ) {
                        weaponRange += 1;
                    }

                    return [totalDamage, weaponSpeed, weaponRange];
                });

            return damages.reduce<DamageVsTarget>(
                (best, damage) => (damage[0] > best[0] ? damage : best),
                damages[0] ?? noDamage,
            );
        },
        calculateDpsVsTarget(target, ignoreArmor = false, includeOverkillDamage = true) {
            const [damage, weaponSpeed] = this.calculateDamageVsTarget(target, ignoreArmor, includeOverkillDamage);
            return weaponSpeed === 0 ? 0 : damage / weaponSpeed;
        },
        isSnapshot() {
            // SC2 before 5.0.4 misreports displayType; python-sc2 falls back to the visibility grid (s2client-proto#167)
            if (world.baseBuild !== undefined && world.baseBuild < DISPLAY_TYPE_FIXED_BASE_BUILD)
                return !resources.get().map.isVisible(this.pos);
            return this.displayType === DisplayType.SNAPSHOT;
        },
        isFlyingOrGravitoned() {
            return isFlying(this);
        },
        isMemory() {
            return !this.isCurrent() && !this.labels.has('dead');
        },
        age() {
            return (frame.getGameLoop() - this.lastSeen) / GAME_LOOPS_PER_SECOND;
        },
        async useAbility(abilityId, options = {}) {
            return actions.do(abilityId, this.tag, options);
        },
        distanceTo(target) {
            const point = toPoint(target);
            return Math.hypot(point.x - this.pos.x, point.y - this.pos.y);
        },
        isFacing(other, angleError = 0.05) {
            let angle = Math.atan2(other.pos.y - this.pos.y, other.pos.x - this.pos.x);
            if (angle < 0) angle += Math.PI * 2;
            return Math.abs(angle - this.facing) < angleError;
        },
        update(unit) {
            Object.assign(this, unit, {
                noQueue: unit.orders!.length === 0,
                lastSeen: frame.getGameLoop(),
            });
        },
    };

    switch (alliance) {
        case Alliance.ALLY:
        case Alliance.SELF:
        case Alliance.ENEMY:
        case Alliance.NEUTRAL: {
            return {
                ...unitData,
                pos: unitData.pos as Point3D,
                unitType: unitData.unitType!,
                ...blueprint,
            };
        }
        default: {
            throw new Error('CANT CREATE A UNIT WITH NO ALLIANCE, THIS SHOULD NEVER HAPPEN');
        }
    }
}

export default createUnit;
