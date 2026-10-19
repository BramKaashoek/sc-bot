import { HARVEST_GATHER_MULE } from '../constants/ability.ts';
import { GRAVITONBEAM } from '../constants/buff.ts';
import { DisplayType } from '../constants/enums.ts';
import { gatheringAbilities, returningAbilities } from '../constants/groups.ts';
import type { Point2D, Unit } from '../types.ts';

type Position = Unit | Point2D;
type UnitPredicate = (unit: Unit, index: number, array: Unit[]) => unknown;

export const toPoint = (position: Position): Point2D => ('pos' in position ? position.pos : position);

const squaredDistance = (unit: Unit, position: Position): number => {
    const point = toPoint(position);
    return (unit.pos.x - point.x) ** 2 + (unit.pos.y - point.y) ** 2;
};

const usesAbility = (unit: Unit, abilityIds: number[]): boolean => {
    const [current] = unit.orders ?? [];
    return current !== undefined && abilityIds.includes(current.abilityId!);
};

// python-sc2 compares the remapped HARVEST_GATHER, which the MULE's raw id also maps to
const gatheringOrMuleAbilities = [...gatheringAbilities, HARVEST_GATHER_MULE];
const collectingAbilities = [...gatheringOrMuleAbilities, ...returningAbilities];

export const isFlying = (unit: Unit): boolean => Boolean(unit.isFlying) || (unit.buffIds ?? []).includes(GRAVITONBEAM);

const isUnitLike = (value: unknown): boolean => typeof value === 'object' && value !== null && 'tag' in value;

const unitsOrArray = <Mapped>(mapped: Mapped[]): Mapped[] => (mapped.every(isUnitLike) ? mapped : Array.from(mapped));

export class Units extends Array<Unit> {
    static override from(iterable: Iterable<Unit> | ArrayLike<Unit>): Units {
        return super.from(iterable) as Units;
    }

    override map<Mapped extends Unit>(
        callback: (unit: Unit, index: number, array: Unit[]) => Mapped,
        thisArg?: unknown,
    ): Units & Mapped[];
    override map<Mapped>(callback: (unit: Unit, index: number, array: Unit[]) => Mapped, thisArg?: unknown): Mapped[];
    override map<Mapped>(callback: (unit: Unit, index: number, array: Unit[]) => Mapped, thisArg?: unknown): Mapped[] {
        return unitsOrArray(super.map(callback, thisArg));
    }

    override flatMap<Mapped extends Unit>(
        callback: (unit: Unit, index: number, array: Unit[]) => Mapped | ReadonlyArray<Mapped>,
        thisArg?: unknown,
    ): Units & Mapped[];
    override flatMap<Mapped>(
        callback: (unit: Unit, index: number, array: Unit[]) => Mapped | ReadonlyArray<Mapped>,
        thisArg?: unknown,
    ): Mapped[];
    override flatMap<Mapped>(
        callback: (unit: Unit, index: number, array: Unit[]) => Mapped | ReadonlyArray<Mapped>,
        thisArg?: unknown,
    ): Mapped[] {
        return unitsOrArray(super.flatMap(callback, thisArg));
    }

    override filter<Narrowed extends Unit>(
        predicate: (unit: Unit, index: number, array: Unit[]) => unit is Narrowed,
        thisArg?: unknown,
    ): Units & Narrowed[];
    override filter(predicate: UnitPredicate, thisArg?: unknown): Units;
    override filter(predicate: UnitPredicate, thisArg?: unknown): Units {
        return super.filter(predicate, thisArg) as Units;
    }

    override slice(start?: number, end?: number): Units {
        return super.slice(start, end) as Units;
    }

    override concat(...items: (Unit | ConcatArray<Unit>)[]): Units {
        return super.concat(...items) as Units;
    }

    override splice(start: number, deleteCount?: number, ...items: Unit[]): Units;
    override splice(...args: [start: number, deleteCount?: number, ...items: Unit[]]): Units {
        return super.splice(...(args as [number, number, ...Unit[]])) as Units;
    }

    override reverse(): Units {
        return super.reverse() as Units;
    }

    get amount(): number {
        return this.length;
    }

    get empty(): boolean {
        return this.length === 0;
    }

    get exists(): boolean {
        return this.length > 0;
    }

    get first(): Unit {
        this.assertNotEmpty();
        return this[0];
    }

    get random(): Unit {
        this.assertNotEmpty();
        return this[Math.floor(Math.random() * this.length)];
    }

    get center(): Point2D {
        this.assertNotEmpty();
        return {
            x: this.reduce((sum, unit) => sum + unit.pos.x, 0) / this.length,
            y: this.reduce((sum, unit) => sum + unit.pos.y, 0) / this.length,
        };
    }

    get tags(): Set<Unit['tag']> {
        return new Set(this.map((unit) => unit.tag));
    }

    get ready(): Units {
        return this.filter((unit) => unit.buildProgress! >= 1);
    }

    get notReady(): Units {
        return this.filter((unit) => unit.buildProgress! < 1);
    }

    get idle(): Units {
        return this.filter((unit) => unit.isIdle());
    }

    get flying(): Units {
        return this.filter((unit) => isFlying(unit));
    }

    get notFlying(): Units {
        return this.filter((unit) => !isFlying(unit));
    }

    get structures(): Units {
        return this.filter((unit) => unit.isStructure());
    }

    get notStructures(): Units {
        return this.filter((unit) => !unit.isStructure());
    }

    get selected(): Units {
        return this.filter((unit) => Boolean(unit.isSelected));
    }

    get visible(): Units {
        return this.filter((unit) => unit.displayType === DisplayType.VISIBLE && !unit.isSnapshot());
    }

    get mineralFields(): Units {
        return this.filter((unit) => unit.isMineralField());
    }

    get gathering(): Units {
        return this.filter((unit) => usesAbility(unit, gatheringOrMuleAbilities));
    }

    get returning(): Units {
        return this.filter((unit) => usesAbility(unit, returningAbilities));
    }

    get collecting(): Units {
        return this.filter((unit) => usesAbility(unit, collectingAbilities));
    }

    get preferIdle(): Units {
        return this.sorted((unit) => unit.isIdle(), true);
    }

    copy(): Units {
        return Units.from(this);
    }

    union(other: Iterable<Unit>): Units {
        const known = this.tags;
        return Units.from([...this, ...Array.from(other).filter((unit) => !known.has(unit.tag!))]);
    }

    intersection(other: Iterable<Unit>): Units {
        const known = this.tags;
        return Units.from(Array.from(other).filter((unit) => known.has(unit.tag!)));
    }

    difference(other: Iterable<Unit>): Units {
        const excluded = new Set(Array.from(other).map((unit) => unit.tag!));
        return this.filter((unit) => !excluded.has(unit.tag!));
    }

    findByTag(tag: string): Unit | undefined {
        return this.find((unit) => unit.tag === tag);
    }

    byTag(tag: string): Unit {
        const unit = this.findByTag(tag);
        if (!unit) {
            throw new Error(`Unit not found: ${tag}`);
        }
        return unit;
    }

    take(count: number): Units {
        return count >= this.length ? this : this.slice(0, count);
    }

    randomOr<Fallback>(fallback: Fallback): Unit | Fallback {
        return this.length > 0 ? this.random : fallback;
    }

    randomGroupOf(count: number): Units {
        if (count < 1) return new Units();
        if (count >= this.length) return this;

        const pool = [...this];
        for (let index = 0; index < count; index += 1) {
            const pick = index + Math.floor(Math.random() * (pool.length - index));
            [pool[index], pool[pick]] = [pool[pick], pool[index]];
        }
        return Units.from(pool.slice(0, count));
    }

    inAttackRangeOf(unit: Unit, bonusDistance = 0): Units {
        return this.filter((target) => unit.targetInRange(target, bonusDistance));
    }

    closestDistanceTo(position: Position): number {
        this.assertNotEmpty();
        return Math.sqrt(Math.min(...this.map((unit) => squaredDistance(unit, position))));
    }

    furthestDistanceTo(position: Position): number {
        this.assertNotEmpty();
        return Math.sqrt(Math.max(...this.map((unit) => squaredDistance(unit, position))));
    }

    closestTo(position: Position): Unit {
        this.assertNotEmpty();
        return this.reduce((best, unit) =>
            squaredDistance(unit, position) < squaredDistance(best, position) ? unit : best,
        );
    }

    furthestTo(position: Position): Unit {
        this.assertNotEmpty();
        return this.reduce((best, unit) =>
            squaredDistance(unit, position) > squaredDistance(best, position) ? unit : best,
        );
    }

    closerThan(distance: number, position: Position): Units {
        return this.filter((unit) => squaredDistance(unit, position) < distance ** 2);
    }

    furtherThan(distance: number, position: Position): Units {
        return this.filter((unit) => squaredDistance(unit, position) > distance ** 2);
    }

    inDistanceBetween(position: Position, minDistance: number, maxDistance: number): Units {
        return this.filter((unit) => {
            const squared = squaredDistance(unit, position);
            return minDistance ** 2 < squared && squared < maxDistance ** 2;
        });
    }

    closestNUnits(position: Position, count: number): Units {
        return this.sortedByDistanceTo(position).slice(0, count);
    }

    furthestNUnits(position: Position, count: number): Units {
        return this.sortedByDistanceTo(position).slice(-count);
    }

    inDistanceOfGroup(other: Units, distance: number): Units {
        if (other.length === 0) {
            throw new Error('Other units object is empty');
        }
        return this.filter((unit) => other.some((target) => squaredDistance(unit, target) < distance ** 2));
    }

    inClosestDistanceToGroup(other: Units): Unit {
        this.assertNotEmpty();
        if (other.length === 0) {
            throw new Error('Given units object is empty');
        }
        const nearestSquared = (unit: Unit) => Math.min(...other.map((target) => squaredDistance(unit, target)));
        return this.reduce((best, unit) => (nearestSquared(unit) < nearestSquared(best) ? unit : best));
    }

    nClosestToDistance(position: Position, distance: number, count: number): Units {
        return this.sortedByDistanceFrom(position, distance).slice(0, count);
    }

    nFurthestToDistance(position: Position, distance: number, count: number): Units {
        return this.sortedByDistanceFrom(position, distance).slice(-count);
    }

    sorted<Key>(key: (unit: Unit) => Key, reverse = false): Units {
        const direction = reverse ? -1 : 1;
        return Units.from(
            [...this].sort((left, right) => {
                const leftKey = key(left);
                const rightKey = key(right);
                if (leftKey < rightKey) return -direction;
                if (leftKey > rightKey) return direction;
                return 0;
            }),
        );
    }

    sortedByDistanceTo(position: Position, reverse = false): Units {
        return this.sorted((unit) => squaredDistance(unit, position), reverse);
    }

    tagsIn(other: Iterable<string>): Units {
        const wanted = other instanceof Set ? other : new Set(other);
        return this.filter((unit) => wanted.has(unit.tag!));
    }

    tagsNotIn(other: Iterable<string>): Units {
        const excluded = other instanceof Set ? other : new Set(other);
        return this.filter((unit) => !excluded.has(unit.tag!));
    }

    ofType(unitTypes: number | number[]): Units {
        const wanted = new Set(Array.isArray(unitTypes) ? unitTypes : [unitTypes]);
        return this.filter((unit) => wanted.has(unit.unitType));
    }

    excludeType(unitTypes: number | number[]): Units {
        const excluded = new Set(Array.isArray(unitTypes) ? unitTypes : [unitTypes]);
        return this.filter((unit) => !excluded.has(unit.unitType));
    }

    sameTech(unitTypes: number[]): Units {
        const techTypes = new Set(unitTypes);
        const [anyUnit] = this;
        unitTypes.forEach((unitType) => {
            anyUnit?.typeData(unitType)?.techAlias?.forEach((alias) => techTypes.add(alias));
        });
        return this.filter(
            (unit) => techTypes.has(unit.unitType) || unit.data().techAlias?.some((alias) => techTypes.has(alias)),
        );
    }

    sameUnit(unitTypes: number | number[]): Units {
        const requested = Array.isArray(unitTypes) ? unitTypes : [unitTypes];
        const aliasTypes = new Set(requested);
        const [anyUnit] = this;
        requested.forEach((unitType) => {
            aliasTypes.add(anyUnit?.typeData(unitType)?.unitAlias ?? 0);
        });
        aliasTypes.delete(0);
        return this.filter((unit) => aliasTypes.has(unit.unitType) || aliasTypes.has(unit.data().unitAlias ?? 0));
    }

    private sortedByDistanceFrom(position: Position, distance: number): Units {
        return this.sorted((unit) => Math.abs(Math.sqrt(squaredDistance(unit, position)) - distance));
    }

    private assertNotEmpty(): void {
        if (this.length === 0) {
            throw new Error('Units object is empty');
        }
    }
}
