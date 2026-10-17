/*
 * The node side of env-lib.sh: the environment first, then the .env file at the root of the
 * sfdx-hardis working copy, then defaults derived from where this skill sits. Nothing prints a value.
 *
 *   const env = require('./env-lib.cjs');
 *   env.loadEnv(['GITLAB_RUNNER_TAG']);   // fills process.env from .env for unset names
 *   env.extDir();                         // EXT, else <main working copy>/../vscode-sfdx-hardis
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const root = process.env.E2E_ROOT || git(['rev-parse', '--show-toplevel'], __dirname) || path.resolve(__dirname, '../../../..');
let mainRoot = process.env.E2E_MAIN_ROOT || '';
if (!mainRoot) {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], root);
  mainRoot = common && path.basename(common) === '.git' ? path.dirname(common) : root;
}
let envFile = process.env.E2E_ENV_FILE || path.join(root, '.env');
if (!process.env.E2E_ENV_FILE && !fs.existsSync(envFile)) {
  envFile = path.join(mainRoot, '.env');
}

function dotenvValue(name) {
  if (!fs.existsSync(envFile)) {
    return '';
  }
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(new RegExp(`^(?:export +)?${name}=(.*)$`));
    if (m) {
      return m[1].replace(/^["']/, '').replace(/["']$/, '');
    }
  }
  return '';
}

function loadEnv(names) {
  for (const name of names) {
    if (process.env[name] === undefined) {
      const value = dotenvValue(name);
      if (value) {
        process.env[name] = value;
      }
    }
  }
}

function extDir() {
  return process.env.EXT || path.join(path.dirname(mainRoot), 'vscode-sfdx-hardis');
}

module.exports = { root, mainRoot, envFile, loadEnv, extDir };
