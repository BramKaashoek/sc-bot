import { describe, expect, it } from 'bun:test';

describe('protoss_building_placements.yml', () => {
    it('parses with Bun.YAML', async () => {
        const text = await Bun.file(new URL('./protoss_building_placements.yml', import.meta.url)).text();
        const data = Bun.YAML.parse(text) as Record<string, unknown>;
        expect(Object.keys(data)).toHaveLength(7);
    });
});
