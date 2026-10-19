import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMap, launcher, resolveSc2Install } from './launcher.ts';

const fakeInstall = (parent: string, name: string, build: number) => {
    const basePath = join(parent, name);
    const versionDir = join(basePath, 'Versions', `Base${build}`);
    mkdirSync(versionDir, { recursive: true });
    return { basePath, executablePath: join(versionDir, 'SC2_x64') };
};

describe.skipIf(process.platform !== 'linux')('resolveSc2Install', () => {
    const savedSc2Path = process.env.SC2PATH;
    let home: string;

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), 'sc2-home-'));
        delete process.env.SC2PATH;
    });

    afterEach(() => {
        if (savedSc2Path === undefined) delete process.env.SC2PATH;
        else process.env.SC2PATH = savedSc2Path;
    });

    it('prefers ExecuteInfo.txt over SC2PATH', () => {
        const fromExecuteInfo = fakeInstall(join(home, 'games'), 'StarCraft II', 1);
        const executeInfoDir = join(home, 'Documents', 'StarCraft II');
        mkdirSync(executeInfoDir, { recursive: true });
        writeFileSync(join(executeInfoDir, 'ExecuteInfo.txt'), `executable = ${fromExecuteInfo.executablePath}\n`);
        process.env.SC2PATH = fakeInstall(home, 'sc2path', 2).basePath;

        expect(resolveSc2Install(home)).toEqual(fromExecuteInfo);
    });

    it('falls back to the newest Versions/Base* under SC2PATH without ExecuteInfo.txt', () => {
        const install = fakeInstall(home, 'sc2path', 75689);
        mkdirSync(join(install.basePath, 'Versions', 'Base9999'));
        process.env.SC2PATH = install.basePath;
        fakeInstall(home, 'StarCraftII', 1);

        expect(resolveSc2Install(home)).toEqual({
            basePath: install.basePath,
            executablePath: join(install.basePath, 'Versions', 'Base75689', 'SC2_x64'),
        });
    });

    it('falls back to ~/StarCraftII when neither ExecuteInfo.txt nor SC2PATH is present', () => {
        const install = fakeInstall(home, 'StarCraftII', 3);

        expect(resolveSc2Install(home)).toEqual(install);
    });

    it('finds a map by its path, or by bare or whitespace-free name one folder deep, in Maps/ or maps/', async () => {
        const { basePath } = fakeInstall(home, 'sc2path', 1);
        process.env.SC2PATH = basePath;
        mkdirSync(join(basePath, 'Maps', 'Melee'), { recursive: true });
        mkdirSync(join(basePath, 'maps', 'Ladder'), { recursive: true });
        writeFileSync(join(basePath, 'Maps', 'Melee', 'Simple64.SC2Map'), '');
        writeFileSync(join(basePath, 'maps', 'Ladder', 'BlueshiftLE.SC2Map'), '');

        expect(
            await Promise.all(['Melee/Simple64', 'Simple64', 'Blueshift LE'].map((mapName) => findMap(mapName, home))),
        ).toEqual([
            join(basePath, 'Maps', 'Melee', 'Simple64.SC2Map'),
            join(basePath, 'Maps', 'Melee', 'Simple64.SC2Map'),
            join(basePath, 'maps', 'Ladder', 'BlueshiftLE.SC2Map'),
        ]);
        await expect(findMap('Nowhere', home)).rejects.toThrow(
            `Map "Nowhere" not found under ${join(basePath, 'Maps')} or ${join(basePath, 'maps')}`,
        );
    });

    it('rejects the launch when the SC2 binary cannot be spawned', async () => {
        process.env.SC2PATH = fakeInstall(home, 'sc2path', 1).basePath;
        // a real ExecuteInfo.txt under the actual home would win over SC2PATH and launch the real SC2
        const homedir = spyOn(os, 'homedir').mockReturnValue(home);

        try {
            await expect(launcher({ port: 5899 })).rejects.toThrow('ENOENT');
        } finally {
            homedir.mockRestore();
        }
    });
});
