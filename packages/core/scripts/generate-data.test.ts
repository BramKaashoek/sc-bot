import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const COMMITTED = join(ROOT, 'constants');
const SCRIPT = join(ROOT, 'scripts', 'generate-data.ts');

const run = (constantsDir: string, ...args: string[]) =>
    Bun.spawnSync(['bun', SCRIPT, ...args], { cwd: ROOT, env: { ...process.env, CONSTANTS_DIR: constantsDir } });

const snapshot = (dir: string) =>
    new Map(
        (readdirSync(dir, { recursive: true }) as string[])
            .filter((file) => file.endsWith('.ts'))
            .map((file) => [file, readFileSync(join(dir, file), 'utf8')]),
    );

describe('generate-data', () => {
    let scratch: string;
    let copy: string;

    beforeAll(() => {
        scratch = mkdtempSync(join(tmpdir(), 'generate-data-'));
        copy = join(scratch, 'constants');
        cpSync(COMMITTED, copy, { recursive: true });
    });
    afterAll(() => rmSync(scratch, { recursive: true, force: true }));

    it('regenerates the committed constants byte for byte', () => {
        expect(run(copy).success).toBe(true);
        expect(snapshot(copy)).toEqual(snapshot(COMMITTED));
    });

    it('--check passes on the committed constants without writing', () => {
        const before = snapshot(COMMITTED);
        expect(run(COMMITTED, '--check').exitCode).toBe(0);
        expect(snapshot(COMMITTED)).toEqual(before);
    });

    it('--check fails and names a hand-edited generated file', () => {
        const target = join(copy, 'dicts', 'researched-from.ts');
        writeFileSync(target, `${readFileSync(target, 'utf8')}// hand edit\n`);

        const result = run(copy, '--check');

        expect(result.exitCode).toBe(1);
        expect(result.stderr.toString()).toContain(target);
        expect(readFileSync(target, 'utf8')).toEndWith('// hand edit\n');
    });
});
