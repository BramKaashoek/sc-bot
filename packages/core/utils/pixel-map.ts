import type { Point2D } from '../types.ts';

type ImageSource = {
    bitsPerPixel: number;
    size: { x: number; y: number };
    data: Uint8Array;
};

const NEIGHBOUR_OFFSETS: Array<[number, number]> = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
];

export class PixelMap {
    readonly width: number;
    readonly height: number;
    readonly bitsPerPixel: number;
    private readonly values: Uint8Array;

    constructor({ bitsPerPixel, size, data }: ImageSource) {
        this.width = size.x;
        this.height = size.y;
        this.bitsPerPixel = bitsPerPixel;

        const inBits = bitsPerPixel === 1;
        const pixelCount = this.width * this.height;
        if (pixelCount !== (inBits ? 8 : 1) * data.length) {
            throw new Error(`Image size ${this.width}x${this.height} does not match ${data.length} data bytes`);
        }

        if (inBits) {
            this.values = new Uint8Array(pixelCount);
            for (let index = 0; index < pixelCount; index += 1) {
                this.values[index] = (data[index >> 3] >> (7 - (index & 7))) & 1;
            }
        } else {
            this.values = Uint8Array.from(data);
        }
    }

    get(point: Point2D): number {
        return this.values[this.indexOf(point)];
    }

    set(point: Point2D, value: number): void {
        this.values[this.indexOf(point)] = value;
    }

    isSet(point: Point2D): boolean {
        return this.get(point) !== 0;
    }

    isEmpty(point: Point2D): boolean {
        return !this.isSet(point);
    }

    copy(): PixelMap {
        const clone = new PixelMap({ bitsPerPixel: 8, size: { x: this.width, y: this.height }, data: this.values });
        return Object.assign(Object.create(PixelMap.prototype), clone, { bitsPerPixel: this.bitsPerPixel });
    }

    floodFill(start: Point2D, predicate: (value: number) => boolean): Point2D[] {
        const visited = new Set<number>();
        const nodes: Point2D[] = [];
        const queue: Point2D[] = [start];

        while (queue.length > 0) {
            const { x, y } = queue.pop()!;

            if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;

            const index = y * this.width + x;
            if (visited.has(index) || !predicate(this.values[index])) continue;

            visited.add(index);
            nodes.push({ x, y });
            NEIGHBOUR_OFFSETS.forEach(([dx, dy]) => queue.push({ x: x + dx, y: y + dy }));
        }

        return nodes;
    }

    floodFillAll(predicate: (value: number) => boolean): Point2D[][] {
        const claimed = new Set<number>();
        const groups: Point2D[][] = [];

        for (let x = 0; x < this.width; x += 1) {
            for (let y = 0; y < this.height; y += 1) {
                if (claimed.has(y * this.width + x) || !predicate(this.values[y * this.width + x])) continue;

                const group = this.floodFill({ x, y }, predicate);
                group.forEach((point) => claimed.add(point.y * this.width + point.x));
                groups.push(group);
            }
        }

        return groups;
    }

    private indexOf({ x, y }: Point2D): number {
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            throw new TypeError(`Point (${x}, ${y}) is not an integer pixel`);
        }
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            throw new RangeError(`Point (${x}, ${y}) is outside the ${this.width}x${this.height} map`);
        }
        return y * this.width + x;
    }
}
