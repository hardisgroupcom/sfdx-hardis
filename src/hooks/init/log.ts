import { Hook } from '@oclif/core';

const hook: Hook<'init'> = async (options) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.id || 'unknown';
  if (!commandId.startsWith('hardis')) {
    return;
  }
  // Set argv as global as sf arch messes with it !
  globalThis.processArgv = [...options.argv];
  // Inline isCI check to avoid importing the heavy utils module (~2300 lines + transitive deps)
  const isCI = process.env.CI != null;
  // Dynamically import libraries in parallel to improve perfs when other commands are called
  const [
    { default: fs },
    path,
    os,
    dotenv,
  ] = await Promise.all([
    import('fs-extra'),
    import('path'),
    import('os'),
    import('dotenv'),
  ]);
  // Handle variables defined in .env file
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
    const commandsLogFolder = path.join(reportsDir, 'commands');
    await fs.ensureDir(commandsLogFolder); // ensureDir creates parent directories too
    const logFileName = (new Date().toJSON().slice(0, 19) + '-' + commandId + '.log').replace(/:/g, '-');
    const hardisLogFile = path.resolve(path.join(commandsLogFolder, logFileName));
    globalThis.hardisLogFileStream = fs.createWriteStream(hardisLogFile, { flags: 'a' });
    globalThis.hardisLogFileStream.write(commandId + ' ' + globalThis.processArgv.join(' ') + '\n');
  }
};

export default hook;
