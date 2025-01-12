import fs from 'fs-extra';
import dotenv from 'dotenv';
import * as path from 'path';
import * as os from 'os';
import { isCI } from '../../common/utils/index.js';
import { Hook } from '@oclif/core';

const hook: Hook<'init'> = async (options) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.id || 'unknown';
  if (!commandId.startsWith('hardis')) {
    return;
  }
  // Set argv as global as sf arch messes with it !
  globalThis.processArgv = [...options.argv];
  // Set ENV vars
  dotenv.config();
  // Debug env variables
  if (process.env.SFDX_HARDIS_DEBUG_ENV === 'true') {
    console.log('ENV VARS:\n' + JSON.stringify(process.env, null, 2));
    process.env.SFDX_ENV = 'development'; // So when there is an error, the stack is displayed
  }
  if (!isCI) {
    // Initialize log file name (in the current directory if not empty)
    const reportsDir =
      fs.readdirSync(process.cwd()).length === 0 ? path.join(os.tmpdir(), 'hardis-report') : './hardis-report';
    await fs.ensureDir(reportsDir);
    const commandsLogFolder = path.join(reportsDir, 'commands');
    await fs.ensureDir(commandsLogFolder);
    const logFileName = (new Date().toJSON().slice(0, 19) + '-' + commandId + '.log').replace(/:/g, '-');
    const hardisLogFile = path.resolve(path.join(commandsLogFolder, logFileName));
    globalThis.hardisLogFileStream = fs.createWriteStream(hardisLogFile, { flags: 'a' });
    globalThis.hardisLogFileStream.write(globalThis.processArgv.join(' '));
  }
};

export default hook;
