import type { Point2D } from '../../types.ts';

export type OverlordSpotInput = {
    walkable: number[][];
    terrainHeight: number[][];
    playable: { x0: number; y0: number; x1: number; y1: number };
};

const LEVEL_DIFFERENCE = 16;
const BORDER = 2;

export function computeOverlordSpots({ walkable, terrainHeight, playable }: OverlordSpotInput): Point2D[] {
    const h = terrainHeight.length;
    const w = terrainHeight[0].length;
    const seed = new Uint8Array(w * h);
    const handled = new Uint8Array(w * h);
    const inSet = new Uint8Array(w * h);

    for (let y = BORDER; y < h - BORDER; y++) {
        for (let x = BORDER; x < w - BORDER; x++) {
            if (walkable[y][x] !== 0) continue;
            const here = terrainHeight[y][x];
            const right = terrainHeight[y][x + 1];
            const left = terrainHeight[y][x - 1];
            if ((here >= right + LEVEL_DIFFERENCE && right > 0) || (here >= left + LEVEL_DIFFERENCE && left > 0)) {
                seed[y * w + x] = 1;
            }
        }
    }

    const fill = (startX: number, startY: number, target: number, mark: number, set: number[]): boolean => {
        const stack = [startY * w + startX];
        let accepted = true;
        while (stack.length > 0) {
            const key = stack.pop()!;
            if (inSet[key]) continue;
            const row = Math.floor(key / w);
            const col = key % w;
            set.push(key);
            inSet[key] = 1;

            const cellHeight = terrainHeight[row][col];
            if (target !== cellHeight) {
                if (target < cellHeight + LEVEL_DIFFERENCE) accepted = false;
                continue;
            }
            seed[key] = mark;

            if (row > 0) stack.push(key - w);
            if (col > 0) stack.push(key - 1);
            if (row < h - 1) stack.push(key + w);
            if (col < w - 1) stack.push(key + 1);
        }
        return accepted;
    };

    const spots: Point2D[] = [];
    for (let y = playable.y0; y < playable.y1; y++) {
        for (let x = playable.x0; x < playable.x1; x++) {
            const key = y * w + x;
            if (handled[key] || !seed[key]) continue;

            const set: number[] = [];
            const target = terrainHeight[y][x];
            if (fill(x, y, target, 1, set)) {
                let sumX = 0;
                let sumY = 0;
                for (const member of set) {
                    handled[member] = 1;
                    sumX += member % w;
                    sumY += Math.floor(member / w);
                }
                spots.push({ x: sumX / set.length, y: sumY / set.length });
            } else {
                for (const member of set) inSet[member] = 0;
                set.length = 0;
                fill(x, y, target, 0, set);
            }
            for (const member of set) inSet[member] = 0;
        }
    }
    return spots;
}
