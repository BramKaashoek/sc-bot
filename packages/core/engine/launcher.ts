import createDebug from 'debug';
import os from 'node:os';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import path from 'node:path';
import findP from 'find-process';
import type { LauncherOptions } from '../types.ts';

const debug = createDebug('sc2:debug:launcher');

let EXECUTE_INFO_PATH: string;
let executablePath: string;
let execName: string;
let basePath: string;

async function launcher(options: LauncherOptions = {}) {
    setupFilePaths();
    const opts = {
        listen: '127.0.0.1',
        port: 5000,
        displayMode: 0,
        force: false,
        killAll: false,
        ...options,
    };

    const [samePortProcess] = await findP('port', opts.port);
    if (samePortProcess && samePortProcess.pid !== 0) { // could show up as pid 0 for an old TIME_WAIT process
        debug('Existing process found running on same port: %o', samePortProcess);

        if (options.force) {
            debug('"Force" enabled, killing process to restart...');
            if (samePortProcess.pid) {
                process.kill(samePortProcess.pid, 'SIGKILL');
            }
            // parent can also be killed using the `ppid` prop.. but don't see a need for that atm
        } else {
            debug('Skipping launch since the client already exists listening on this port (set { force: true } in options if you want to force restart it)');
            return samePortProcess.pid;
        }
    }

    const existingProcesses = await findP('name', execName, true);
    if (existingProcesses.length > 0) {
        debug(`Existing ${execName} processes found running: %o`, existingProcesses);

        if (options.forceAll) {
            debug(`ForceAll" enabled, killing *all* ${execName} processes before launching...`);

            existingProcesses.forEach((proc) => {
                if (proc.pid) {
                    process.kill(proc.pid, 'SIGKILL');
                }
                // parent can also be killed using the `ppid` prop.. but don't see a need for that atm
            });
        } else {
            debug('Not killing existing clients running on a different port, (set { forceAll: true } in options if you want this behavior)');
        }
    } else {
        debug('no existing processes');
    }

    debug('Launching new process...');
    const clientProcess = spawn(executablePath, [
        '-listen', opts.listen,
        '-port', String(opts.port),
        '-displayMode', String(opts.displayMode)
    ], {
        cwd: os.platform() === 'win32' ? path.join(basePath, 'Support64') : undefined,
        detached: true,
        stdio: 'ignore',
    });

    // don't try this at home kids...
    debug(`Waiting for new process to start listening on port ${opts.port}...`);
    while({ pid: 0, ...(await findP('port', opts.port))[0] as { pid?: number } | undefined }.pid !== clientProcess.pid);
    debug('New client is up and running successfully');

    clientProcess.unref();
    return clientProcess;
}

const accessP = promisify(fs.access);
const MAP_DIR = 'Maps';
const SUFFIX = ".SC2Map";

async function findMap(mapName: string) {
    const tryPath1 = (path.join(basePath, MAP_DIR, mapName + SUFFIX));
    const tryPath2 = (path.join(basePath, MAP_DIR, mapName.replace(/\s/g, '') + SUFFIX));

    try {
        await accessP(tryPath1, fs.constants.F_OK);
        debug(`Map ${mapName} found in path: ${tryPath1}`);
        return tryPath1;
    } catch (e) {
        debug(`${tryPath1} does not exist... trying alternative`);
    }

    try {
        await accessP(tryPath2, fs.constants.F_OK);
        debug(`Map ${mapName} found in path: ${tryPath2}`);
        return tryPath2;
    } catch (e) {
        debug(`${tryPath2} also does not exist... cannot find map`);
    }

    throw new Error(`Map "${mapName}" not found`);
}

function setupFilePaths() {
    if (os.platform() === 'darwin') {
        EXECUTE_INFO_PATH = path.join('Library', 'Application Support', 'Blizzard', 'StarCraft II', 'ExecuteInfo.txt');
    } else {
        EXECUTE_INFO_PATH = path.join('Documents', 'StarCraft II', 'ExecuteInfo.txt');
    }
    
    const HOME_DIR = os.homedir();
    
    const executeInfoText = fs.readFileSync(path.join(HOME_DIR, EXECUTE_INFO_PATH)).toString();
    executablePath = executeInfoText.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/m)![2];
    
    const parsedPath = executablePath.split(path.sep);
    execName = parsedPath[parsedPath.length - 1];
    
    basePath = parsedPath.slice(0, parsedPath.findIndex(s => s === 'StarCraft II') + 1).join(path.sep);
}

export { launcher, findMap };
