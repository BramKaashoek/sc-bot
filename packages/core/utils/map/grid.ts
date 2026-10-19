import chalk from 'chalk';
import type { Grid2D, Grids, Point2D } from '../../types.ts';

function debugGrid(grid: Grid2D, playable: { p0: Point2D; p1: Point2D }, height = false) {
    const pointInRect = ({ p0, p1 }: { p0: Point2D; p1: Point2D }, x: number, y: number) =>
        x > p0.x && x < p1.x && y > p0.y && y < p1.y;

    const displayGrid = grid.slice().reverse();

    displayGrid.forEach((row, x) => {
        console.log(
            [...row]
                .map((pixel, y) => {
                    if (height === true) {
                        return chalk.rgb(0, Number(pixel), 0)('X');
                    }
                    switch (pixel) {
                        case 0:
                            if (!pointInRect(playable, x, y)) {
                                return chalk.bgRed` `;
                            } else {
                                return chalk.bgGreen` `;
                            }
                        case 1:
                            return '░';
                        case 66:
                            return chalk.bgBlue` `;
                        case 114:
                            // @ts-ignore
                            return chalk.bgCyanBright`░`;
                        case 104:
                            return;
                        case 72:
                            // @ts-ignore
                            return chalk.bgRed`░`;
                        default:
                            return pixel;
                    }
                })
                .join(''),
        );
    });
}

function readSingleBit(buffer: Uint8Array, i: number, bit: number) {
    return (buffer[i] >> bit) % 2;
}

function consumeImageData(imageData: SC2APIProtocol.ImageData, width: number, height = Infinity): Grid2D {
    if (!width) {
        throw new Error('Map width needed to digest raw grids!');
    }

    let data = Array.from(imageData.data!);
    const BITS_PER_PIXEL = imageData.bitsPerPixel;

    if (BITS_PER_PIXEL === 1) {
        data = data.reduce<number[]>((pixels, byte) => {
            pixels.push(
                (byte >> 7) & 1,
                (byte >> 6) & 1,
                (byte >> 5) & 1,
                (byte >> 4) & 1,
                (byte >> 3) & 1,
                (byte >> 2) & 1,
                (byte >> 1) & 1,
                (byte >> 0) & 1,
            );

            return pixels;
        }, []);
    }

    const result: number[][] = [];

    while (data.length > 0) {
        if (result.length >= height) {
            break;
        }

        result.push(data.splice(0, width));
    }

    return result;
}

function consumeRawGrids(raw: SC2APIProtocol.StartRaw): Grids {
    const { mapSize, placementGrid: plGrid, pathingGrid: paGrid, terrainHeight: teGrid } = raw;
    const { x, y } = mapSize!;

    const placementGrid2D = consumeImageData(plGrid!, x!, y);

    const pathingGrid2D = consumeImageData(paGrid!, x!, y).map((row) => row.map((cell) => (cell === 0 ? 1 : 0)));

    const heightGrid2D = consumeImageData(teGrid!, x!, y);

    const height = heightGrid2D.map((row) => {
        return row.map((tile) => {
            const approx = Math.ceil(Math.round(((tile - 127) / 8) * 10) / 5) * 5;
            if (approx < 0) return 0;
            else return approx;
        });
    });

    const miniMap = placementGrid2D.map((row, y) => {
        return row.map((pixel, x) => {
            if (pixel === 1 && pathingGrid2D[y][x] === 0) {
                return 66;
            } else if (pixel === 0 && pathingGrid2D[y][x] === 0) {
                return 114;
            } else {
                return pixel;
            }
        });
    });

    return {
        height,
        miniMap,
        placement: placementGrid2D,
        pathing: pathingGrid2D,
    };
}

export { consumeRawGrids, consumeImageData, debugGrid };
