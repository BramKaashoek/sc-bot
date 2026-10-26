export function addCircle(
    data: Float32Array,
    width: number,
    height: number,
    cx: number,
    cy: number,
    radius: number,
    weight: number,
): void {
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const reach = Math.floor(radius);
    const r2 = radius * radius;
    const yStart = Math.max(0, y0 - reach);
    const yEnd = Math.min(height - 1, y0 + reach);
    for (let y = yStart; y <= yEnd; y++) {
        const dy = y - y0;
        const half = Math.floor(Math.sqrt(r2 - dy * dy));
        const xStart = Math.max(0, x0 - half);
        const xEnd = Math.min(width - 1, x0 + half);
        const row = y * width;
        for (let x = xStart; x <= xEnd; x++) data[row + x] += weight;
    }
}
