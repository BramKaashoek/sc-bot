import createDebug from 'debug';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import findP from 'find-process';
import { NodeSC2Error } from './errors.ts';
import type { LauncherOptions, Sc2Install } from '../types.ts';

const debug = createDebug('sc2:debug:launcher');

const BINARY_PATH: Partial<Record<NodeJS.Platform, string>> = {
    win32: 'SC2_x64.exe',
    darwin: path.join('SC2.app', 'Contents', 'MacOS', 'SC2'),
};

function latestExecutable(basePath: string) {
    const versionsDir = path.join(basePath, 'Versions');
    const [latest] = fs
        .readdirSync(versionsDir)
        .filter((name) => /^Base\d+$/.test(name))
        .sort((left, right) => Number(right.slice(4)) - Number(left.slice(4)));

    if (!latest) throw new NodeSC2Error(`No Versions/Base* directory found in ${basePath}`);

    return path.join(versionsDir, latest, BINARY_PATH[os.platform()] ?? 'SC2_x64');
}

function fromExecuteInfo(executeInfoPath: string): Sc2Install {
    const executeInfoText = fs.readFileSync(executeInfoPath).toString();
    const executablePath = executeInfoText.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/m)![2];
    const parsedPath = executablePath.split(path.sep);
    const basePath = parsedPath
        .slice(0, parsedPath.findIndex((segment) => segment === 'StarCraft II') + 1)
        .join(path.sep);
    return { executablePath, basePath };
}

function resolveSc2Install(homeDir = os.homedir()): Sc2Install {
    const executeInfoPath =
        os.platform() === 'darwin'
            ? path.join(homeDir, 'Library', 'Application Support', 'Blizzard', 'StarCraft II', 'ExecuteInfo.txt')
            : path.join(homeDir, 'Documents', 'StarCraft II', 'ExecuteInfo.txt');
    if (fs.existsSync(executeInfoPath)) return fromExecuteInfo(executeInfoPath);

    const { SC2PATH } = process.env;
    if (SC2PATH) return { executablePath: latestExecutable(SC2PATH), basePath: SC2PATH };

    const linuxDefault = path.join(homeDir, 'StarCraftII');
    if (os.platform() === 'linux' && fs.existsSync(linuxDefault)) {
        return { executablePath: latestExecutable(linuxDefault), basePath: linuxDefault };
    }

    throw new NodeSC2Error(`StarCraft II not found: set SC2PATH, or provide ${executeInfoPath}`);
}

async function launcher(options: LauncherOptions = {}) {
    const { executablePath, basePath } = resolveSc2Install();
    const execName = path.basename(executablePath);
    const opts = {
        listen: '127.0.0.1',
        port: 5000,
        displayMode: 0,
        force: false,
        forceAll: false,
        ...options,
    };

    const [samePortProcess] = await findP('port', opts.port);
    if (samePortProcess && samePortProcess.pid !== 0) {
        // could show up as pid 0 for an old TIME_WAIT process
        debug('Existing process found running on same port: %o', samePortProcess);

        if (opts.force) {
            debug('"Force" enabled, killing process to restart...');
            if (samePortProcess.pid) {
                process.kill(samePortProcess.pid, 'SIGKILL');
            }
        } else {
            debug(
                'Skipping launch since the client already exists listening on this port (set { force: true } in options if you want to force restart it)',
            );
            return samePortProcess.pid;
        }
    }

    const existingProcesses = await findP('name', execName, true);
    if (existingProcesses.length > 0) {
        debug(`Existing ${execName} processes found running: %o`, existingProcesses);

        if (opts.forceAll) {
            debug(`ForceAll" enabled, killing *all* ${execName} processes before launching...`);

            existingProcesses.forEach((proc) => {
                if (proc.pid) {
                    process.kill(proc.pid, 'SIGKILL');
                }
            });
        } else {
            debug(
                'Not killing existing clients running on a different port, (set { forceAll: true } in options if you want this behavior)',
            );
        }
    } else {
        debug('no existing processes');
    }

    debug('Launching new process...');
    const clientProcess = spawn(
        executablePath,
        ['-listen', opts.listen, '-port', String(opts.port), '-displayMode', String(opts.displayMode)],
        {
            cwd: os.platform() === 'win32' ? path.join(basePath, 'Support64') : undefined,
            detached: true,
            stdio: 'ignore',
        },
    );

    let spawnError: Error | undefined;
    clientProcess.once('error', (error) => {
        spawnError = error;
    });

    debug(`Waiting for new process to start listening on port ${opts.port}...`);
    while (
        !spawnError &&
        { pid: 0, ...((await findP('port', opts.port))[0] as { pid?: number } | undefined) }.pid !== clientProcess.pid
    );
    if (spawnError) throw spawnError;
    debug('New client is up and running successfully');

    clientProcess.unref();
    return clientProcess;
}

const MAP_DIRS = ['Maps', 'maps'];
const SUFFIX = '.SC2Map';

async function findMap(mapName: string, homeDir = os.homedir()) {
    const { basePath } = resolveSc2Install(homeDir);
    const wanted = [mapName, mapName.replace(/\s/g, '')].map((name) => name + SUFFIX);
    const mapsDirs = MAP_DIRS.map((dir) => path.join(basePath, dir)).filter((dir) => fs.existsSync(dir));

    const direct = mapsDirs.flatMap((dir) => wanted.map((name) => path.join(dir, name)));
    const nested = mapsDirs.flatMap((dir) =>
        fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .flatMap((entry) => wanted.map((name) => path.join(dir, entry.name, path.basename(name)))),
    );

    const found = [...direct, ...nested].find(
        (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
    );
    if (!found)
        throw new NodeSC2Error(
            `Map "${mapName}" not found under ${mapsDirs.join(' or ') || path.join(basePath, 'Maps')}`,
        );

    debug(`Map ${mapName} found in path: ${found}`);
    return found;
}

export { launcher, findMap, resolveSc2Install };
