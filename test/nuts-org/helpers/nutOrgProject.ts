/**
 * Helpers to run sfdx-hardis commands against a real Salesforce org inside a NUT.
 *
 * The plugin repository is not an SFDX project, and hardis:project:deploy:smart needs one
 * *with git history* (it computes a delta between branches). So each session copies the
 * fixture project into the TestSession directory and initializes a git repository in it.
 *
 * The scratch org is created by `sf hardis:scratch:create`, not by the testkit, so that the
 * whole sfdx-hardis scratch org creation and initialization pipeline is validated too:
 * source push, permission set assignment, Apex init scripts and SFDMU data import.
 *
 * Scratch orgs are a scarce resource on a Developer Edition Dev Hub (3 active / 6 daily),
 * so a single org is shared by every scenario of a file and the scenarios are ordered
 * rather than isolated. Salesforce also serializes deployments per org, which is why the
 * org NUTs must never run with mocha --parallel.
 */
import { TestSession, execCmd } from '@salesforce/cli-plugins-testkit';
import fs from '../../../src/common/utils/fsUtils.js';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PROJECT_DIR = path.resolve(currentDir, '../../fixtures/nut-org-project');
export const FIXTURE_BROKEN_DIR = path.resolve(currentDir, '../../fixtures/nut-org-project-broken');

export interface NutOrgContext {
  session: TestSession;
  projectDir: string;
  /** Alias of the scratch org created by hardis:scratch:create (CI- prefixed, see below) */
  orgAlias: string;
  devHubUsername: string;
  /** Console output of hardis:scratch:create, so scenarios can assert on the init steps */
  scratchCreateOutput: string;
  /** True when an existing org was reused instead of created (see NUT_REUSE_ORG_ENV) */
  reused: boolean;
}

/**
 * Name of the env var that makes the NUTs reuse the scratch org of a previous run.
 *
 * A Developer Edition Dev Hub only allows 6 scratch org creations per rolling 24h, which is
 * spent in two runs when iterating on the tests. Set `SFDX_HARDIS_NUT_REUSE_ORG=true` to keep
 * working on the same org instead:
 *   SFDX_HARDIS_NUT_REUSE_ORG=true yarn test:nuts:org
 * The first run creates the org and saves its alias and SFDX auth URL in NUT_REUSE_FILE; the
 * next ones log back into it. The scratch org creation scenarios are skipped when reusing,
 * since nothing was created.
 *
 * Opt-in on purpose: the file holds a refresh token, so it is only written when asked for.
 */
export const NUT_REUSE_ORG_ENV = 'SFDX_HARDIS_NUT_REUSE_ORG';

/** Where the reusable org credentials are stored, outside of any TestSession directory */
export const NUT_REUSE_FILE = path.resolve(currentDir, '../../../.nut-org-reuse.json');

/** Run a git command inside the fixture project */
export function git(projectDir: string, command: string): string {
  return execSync(`git ${command}`, {
    cwd: projectDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Where the sf CLI keeps the plugins installed on this machine.
 *
 * TestSession relocates HOME so that a test never touches the developer's own configuration, but
 * the sf CLI resolves its installed plugins from there too: inside a session `sf sfdmu:run` and
 * `sf sgd:source:delta` are reported as "not a sf command", and a delta deployment then fails on
 * the package.xml sfdx-git-delta never got to write. Windows is unaffected because the plugins
 * live under LOCALAPPDATA, which is why this only ever failed on Linux.
 *
 * Resolved at import time, before any session exists, and pinned for every command the tests run.
 */
const SF_DATA_DIR = process.env.SF_DATA_DIR || defaultSfDataDir();

/**
 * Errors that mean "ask again later", not "the code under test is wrong".
 *
 * The scenarios hit the same org back to back, much faster than any real pipeline would:
 * Salesforce rejects a deployment started seconds after the previous one finished, and a query
 * occasionally loses its connection.
 */
const TRANSIENT_ORG_ERRORS = [
  'Could not find HEAD',
  'ALREADY_IN_PROCESS',
  'UNABLE_TO_LOCK_ROW',
  'Your request exceeded the time limit for processing',
  'fetch failed',
  'ECONNRESET',
  'ETIMEDOUT',
];

function isTransientOrgError(output: string): boolean {
  return TRANSIENT_ORG_ERRORS.some((message) => output.includes(message));
}

/** Cross-platform synchronous wait: `sleep` does not exist on Windows and `timeout` needs a console */
function waitSeconds(seconds: number): void {
  execSync(`node -e "setTimeout(() => undefined, ${seconds * 1000})"`, { stdio: 'ignore' });
}

function defaultSfDataDir(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'sf');
  }
  const home = process.env.HOME || os.homedir();
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'sf');
}

/** Base environment shared by every hardis command run in the NUTs */
function baseEnv(devHubUsername: string): Record<string, string> {
  return {
    // Keep the plugins reachable even though TestSession moved HOME
    SF_DATA_DIR,
    // isCI must be true so sfdx-hardis never prompts
    CI: 'true',
    USER_EMAIL: 'nut@sfdx-hardis.test',
    DEVHUB_ALIAS: devHubUsername,
    SCRATCH_ORG_DURATION: '1',
    SFDX_HARDIS_DISABLE_NOTIF: 'true',
    SFDX_DISABLE_FLOW_DIFF: 'true',
    SF_DISABLE_TELEMETRY: 'true',
  };
}

/**
 * Run a plain `sf` command (not an sfdx-hardis one).
 *
 * The testkit invokes ./bin/run.js, which only exposes the sfdx-hardis commands, so
 * `sf data query` style commands have to go through the real CLI binary instead.
 * Returns the parsed --json payload, or null when the command failed.
 */
export function runSf<T = any>(
  command: string,
  options: {
    cwd?: string;
    devHubUsername?: string;
    tolerateFailure?: boolean;
    env?: Record<string, string>;
    retriesLeft?: number;
  } = {}
): { status: number; result: T | null; output: string } {
  const env = {
    ...process.env,
    SF_DATA_DIR,
    ...(options.devHubUsername ? baseEnv(options.devHubUsername) : {}),
    ...(options.env ?? {}),
  } as Record<string, string>;
  let output = '';
  let execErrorMessage = '';
  // Parsing must stay out of this try: a JSON syntax error is not an exec error, and its
  // exception carries no stdout/stderr, so handling both in one catch loses the real output.
  try {
    output = execSync(`sf ${command}`, {
      cwd: options.cwd ?? process.cwd(),
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (e: any) {
    output = `${e?.stdout ?? ''}${e?.stderr ?? ''}`;
    execErrorMessage = e?.message ?? '';
  }

  // Strip ANSI escape sequences before parsing: when the job runs with FORCE_COLOR the CLI
  // colorizes even its --json output, and the escape codes make JSON.parse fail on what looks
  // like perfectly valid JSON in the logs (log viewers hide the codes).
  // The CLI can also prefix its JSON with a banner (an "update available" warning for example),
  // so start parsing at the first brace rather than assuming the output is pure JSON.
  // eslint-disable-next-line no-control-regex
  const cleanOutput = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  let parsed: any = null;
  let parseErrorMessage = '';
  const jsonStart = cleanOutput.indexOf('{');
  if (jsonStart >= 0) {
    try {
      parsed = JSON.parse(cleanOutput.slice(jsonStart));
    } catch (e: any) {
      parsed = null;
      parseErrorMessage = e?.message ?? '';
    }
  }

  const status = parsed?.status ?? 1;
  // Never fail silently: a helper that returns an empty result on error makes every assertion
  // built on it fail with a meaningless "expected 0 to equal 2" and no way to tell why.
  if (!options.tolerateFailure && (status !== 0 || parsed === null)) {
    // A query that lost its connection to Salesforce says nothing about the code under test
    if (isTransientOrgError(cleanOutput) && (options.retriesLeft ?? 1) > 0) {
      // eslint-disable-next-line no-console
      console.log(`[nuts-org] Transient error on "sf ${command.slice(0, 60)}...", retrying in 30s`);
      waitSeconds(30);
      return runSf<T>(command, { ...options, retriesLeft: (options.retriesLeft ?? 1) - 1 });
    }
    throw new Error(
      `sf ${command}\nfailed with status ${status}` +
      (execErrorMessage ? `\nexec error: ${execErrorMessage.slice(0, 500)}` : '') +
      (parseErrorMessage ? `\nparse error: ${parseErrorMessage.slice(0, 300)}` : '') +
      `\noutput: ${cleanOutput.slice(0, 2000) || '(empty)'}`
    );
  }
  return { status, result: (parsed?.result ?? null) as T | null, output };
}

/** Username prefix of every scratch org created by these tests, used to target cleanup safely */
export const NUT_SCRATCH_USERNAME_PREFIX = 'nut@hardis-scratch-';

/**
 * Delete the scratch orgs previously created by the NUTs, to free slots on the Dev Hub.
 *
 * A Developer Edition Dev Hub only allows 3 active scratch orgs, and a crashed job leaks its
 * org. Deleting the ScratchOrgInfo record on the Dev Hub frees the slot even when the scratch
 * org is not authenticated locally, which is always the case on a fresh CI runner.
 * Only orgs matching the NUT username prefix are deleted, never anything else on the Dev Hub.
 */
export function freeNutScratchOrgSlots(devHubUsername: string): number {
  const res = runSf<any>(
    `data query --query "SELECT Id, SignupUsername FROM ScratchOrgInfo WHERE Status = 'Active' AND SignupUsername LIKE '${NUT_SCRATCH_USERNAME_PREFIX}%'" --json --target-org ${devHubUsername}`,
    { tolerateFailure: true }
  );
  const records: any[] = res.result?.records ?? [];
  let deleted = 0;
  for (const record of records) {
    const del = runSf(
      `data delete record --sobject ScratchOrgInfo --record-id ${record.Id} --json --target-org ${devHubUsername}`,
      { tolerateFailure: true }
    );
    if (del.status === 0) {
      deleted++;
      // eslint-disable-next-line no-console
      console.log(`[nuts-org] Freed scratch org slot: ${record.SignupUsername}`);
    }
  }
  return deleted;
}

/**
 * Read the scratch org limits of the Dev Hub.
 *
 * Two different limits can block a run, and they are not fixed the same way:
 *  - ActiveScratchOrgs: how many can exist at once. Deleting orgs frees it immediately.
 *  - DailyScratchOrgs: how many can be created per rolling 24h. Deleting orgs does NOT
 *    give it back, so once it reaches 0 the only option is to wait.
 * A Developer Edition Dev Hub allows 3 active and 6 daily.
 */
export function getScratchOrgLimits(devHubUsername: string): { active: string; daily: string } {
  const res = runSf<any>(`org list limits --target-org ${devHubUsername} --json`, { tolerateFailure: true });
  const limits: any[] = res.result ?? [];
  const describe = (name: string) => {
    const limit = limits.find((l: any) => l.name === name);
    return limit ? `${limit.remaining}/${limit.max} remaining` : 'unknown';
  };
  return { active: describe('ActiveScratchOrgs'), daily: describe('DailyScratchOrgs') };
}

/**
 * Resolve the Dev Hub username authenticated by the testkit (TESTKIT_AUTH_URL).
 *
 * TestSession.create() moves HOME to an isolated directory, so the orgs authenticated on the
 * developer machine are invisible from inside a session: the Dev Hub has to be authenticated by
 * the testkit itself, from TESTKIT_AUTH_URL.
 */
function resolveDevHubUsername(session: TestSession): string {
  const fromSession = (session as any)?.hubOrg?.username;
  if (fromSession) {
    return fromSession as string;
  }
  if (process.env.TESTKIT_HUB_USERNAME) {
    return process.env.TESTKIT_HUB_USERNAME;
  }
  // Last resort, only useful if something authenticated the hub inside the session home
  const res = runSf<any>('org list --json', { tolerateFailure: true });
  const devHub = (res.result?.devHubs ?? []).find((o: any) => o.username);
  if (!devHub?.username) {
    throw new Error(
      'No Dev Hub is authenticated inside the test session.\n' +
      'Set TESTKIT_AUTH_URL to the SFDX auth URL of a Dev Hub enabled org:\n' +
      '  sf org display --target-org <devhub> --verbose --json   (read the sfdxAuthUrl field)\n' +
      'TestSession isolates HOME, so the orgs authenticated on the machine are not visible here.'
    );
  }
  return devHub.username;
}

/** True when the developer opted in to reusing the scratch org across runs */
function isOrgReuseEnabled(): boolean {
  return process.env[NUT_REUSE_ORG_ENV] === 'true';
}

/** Credentials of a scratch org kept between runs (see NUT_REUSE_ORG_ENV) */
interface ReusableOrg {
  alias: string;
  authUrl: string;
}

function readReusableOrg(): ReusableOrg | null {
  try {
    const saved = fs.readJsonSync(NUT_REUSE_FILE) as ReusableOrg;
    return saved?.alias && saved?.authUrl ? saved : null;
  } catch {
    return null;
  }
}

/** Save the org credentials outside of the session directory, so the next run can log back in */
function saveReusableOrg(projectDir: string, alias: string): void {
  const display = runSf<any>(`org display --target-org ${alias} --verbose --json`, {
    cwd: projectDir,
    tolerateFailure: true,
    // The CLI redacts secrets from `org display` output unless explicitly asked
    env: { SF_TEMP_SHOW_SECRETS: 'true' },
  });
  const authUrl = display.result?.sfdxAuthUrl;
  if (!authUrl) {
    // eslint-disable-next-line no-console
    console.log('[nuts-org] No SFDX auth URL returned by org display, the org will not be reusable.');
    return;
  }
  fs.writeJsonSync(NUT_REUSE_FILE, { alias, authUrl }, { spaces: 2 });
  // eslint-disable-next-line no-console
  console.log(`[nuts-org] Saved ${alias} in ${NUT_REUSE_FILE}, the next run will reuse it.`);
}

/**
 * Authenticate a previously saved scratch org inside the current session.
 * Returns false when the org expired or was deleted, so the caller creates a new one.
 */
function loginReusableOrg(projectDir: string, reusable: ReusableOrg): boolean {
  const urlFile = path.join(projectDir, 'nut-reuse-auth-url.txt');
  try {
    fs.writeFileSync(urlFile, reusable.authUrl, 'utf8');
    const login = runSf(
      `org login sfdx-url --sfdx-url-file "${urlFile}" --alias ${reusable.alias} --json`,
      { cwd: projectDir, tolerateFailure: true }
    );
    if (login.status !== 0) {
      return false;
    }
  } finally {
    fs.removeSync(urlFile);
  }
  const display = runSf<any>(`org display --target-org ${reusable.alias} --json`, {
    cwd: projectDir,
    tolerateFailure: true,
  });
  // A scratch org is reported with status "Active" and has no connectedStatus field,
  // unlike the non-scratch orgs listed by `sf org list`.
  return display.status === 0 && display.result?.status === 'Active';
}

/**
 * Create a TestSession, scaffold the git-initialized fixture project, and create a scratch org
 * through `sf hardis:scratch:create`.
 * `scenario` is only used to name the scratch org, to make CI logs readable.
 */
export async function createNutOrgSession(scenario: string): Promise<NutOrgContext> {
  const session = await TestSession.create({
    project: { sourceDir: FIXTURE_PROJECT_DIR },
    devhubAuthStrategy: 'AUTO',
  });
  // Everything below can throw. The session must always be cleaned, otherwise the stub that
  // TestSession puts on process.cwd survives and every later TestSession.create() fails with
  // "Attempted to wrap cwd which is already wrapped", turning one failure into a cascade.
  try {
    const projectDir = session.project.dir;
    const devHubUsername = resolveDevHubUsername(session);

    // hardis:project:deploy:smart reads the git history, so the fixture needs to be a real repo
    git(projectDir, 'init -b main');
    git(projectDir, 'config user.email "nut@sfdx-hardis.test"');
    git(projectDir, 'config user.name "sfdx-hardis NUT"');
    git(projectDir, 'config commit.gpgsign false');
    git(projectDir, 'add -A');
    git(projectDir, 'commit -m "chore: initial NUT fixture project" --no-verify');

    // sfdx-git-delta and the commits summary both run `git fetch origin`, which fails without
    // a remote. Give the fixture a local bare remote so the delta scenarios really work.
    const remoteDir = path.join(path.dirname(projectDir), `${path.basename(projectDir)}-remote.git`);
    await fs.ensureDir(remoteDir);
    execSync('git init --bare', { cwd: remoteDir, stdio: ['ignore', 'pipe', 'pipe'] });
    git(projectDir, `remote add origin "${remoteDir.replace(/\\/g, '/')}"`);
    git(projectDir, 'push -u origin main');

    await fs.ensureDir(path.join(projectDir, 'config', 'user'));

    // Reuse the org of a previous run when asked to, to spare the daily creation quota.
    if (isOrgReuseEnabled()) {
      const reusable = readReusableOrg();
      if (reusable && loginReusableOrg(projectDir, reusable)) {
        // eslint-disable-next-line no-console
        console.log(`[nuts-org] Reusing the scratch org ${reusable.alias} of a previous run`);
        return { session, projectDir, orgAlias: reusable.alias, devHubUsername, scratchCreateOutput: '', reused: true };
      }
      if (reusable) {
        // eslint-disable-next-line no-console
        console.log(`[nuts-org] The saved scratch org ${reusable.alias} is not usable anymore, creating a new one`);
      }
    }

    // hardis:scratch:create derives the scratch org username from the alias
    // (nut@hardis-scratch-<alias>.com). Salesforce refuses to reuse a scratch org username,
    // even once the org has been deleted, so the alias must be unique on every run.
    // Kept short: the command truncates aliases longer than 30 characters.
    const runSuffix = (process.env.GITHUB_RUN_ID || Date.now().toString(36)).slice(-8);
    const requestedAlias = `hardis-nut-${scenario}-${runSuffix}`;
    const orgAlias = `CI-${requestedAlias}`;

    const createScratchOrg = () =>
      execCmd(`hardis:scratch:create --target-dev-hub ${devHubUsername} --agent`, {
        cwd: projectDir,
        timeout: 1800000,
        env: {
          ...process.env,
          ...baseEnv(devHubUsername),
          SCRATCH_ORG_ALIAS: requestedAlias,
        } as Record<string, string>,
      });

    let createResult = createScratchOrg();
    let scratchCreateOutput = createResult.shellOutput.stdout + createResult.shellOutput.stderr;

    // The Dev Hub allows a limited number of active scratch orgs, and a crashed job leaks its
    // own. When we hit the limit, free the slots taken by previous NUT runs and try once more.
    if (createResult.shellOutput.code !== 0) {
      if (/LIMIT_EXCEEDED|active scratch org limit|no more scratch orgs available/i.test(scratchCreateOutput)) {
        // eslint-disable-next-line no-console
        console.log('[nuts-org] Scratch org limit reached, deleting the orgs left by previous runs...');
        const freed = freeNutScratchOrgSlots(devHubUsername);
        if (freed === 0) {
          // Nothing could be freed, so tell which limit is actually blocking: deleting orgs
          // frees ActiveScratchOrgs but never restores the daily creation quota.
          const limits = getScratchOrgLimits(devHubUsername);
          throw new Error(
            'Scratch org limit reached on the Dev Hub and no NUT scratch org could be freed.\n' +
            `ActiveScratchOrgs: ${limits.active}\n` +
            `DailyScratchOrgs: ${limits.daily}\n` +
            'If the daily quota is exhausted, deleting orgs does not help: it only resets after 24h.\n' +
            `Scratch org creation output:\n${scratchCreateOutput.slice(-2000)}`
          );
        }
        createResult = createScratchOrg();
        scratchCreateOutput = createResult.shellOutput.stdout + createResult.shellOutput.stderr;
        if (createResult.shellOutput.code !== 0) {
          throw new Error(
            `hardis:scratch:create failed again after freeing ${freed} scratch org slot(s):\n${scratchCreateOutput.slice(-4000)}`
          );
        }
      } else {
        throw new Error(`hardis:scratch:create failed:\n${scratchCreateOutput}`);
      }
    }

    if (isOrgReuseEnabled()) {
      saveReusableOrg(projectDir, orgAlias);
    }
    return { session, projectDir, orgAlias, devHubUsername, scratchCreateOutput, reused: false };
  } catch (e) {
    await session.clean().catch(() => undefined);
    throw e;
  }
}

/**
 * One scratch org is shared by every NUT file of the run.
 *
 * Creating one org per file would need 3 of the 3 slots a Developer Edition Dev Hub allows,
 * and would burn half the daily creation quota on a single run. The files run sequentially in
 * the same mocha process (never with --parallel), so a single session is safe, and it also
 * avoids TestSession stubbing process.cwd more than once.
 *
 * The org is NOT deleted between files: the CI job deletes it in its always() cleanup step,
 * which also catches orgs leaked by a crashed run.
 */
let sharedSession: NutOrgContext | null = null;

export async function getSharedNutOrgSession(): Promise<NutOrgContext> {
  if (sharedSession) {
    return sharedSession;
  }
  sharedSession = await createNutOrgSession('shared');
  if (sharedSession.reused) {
    purgeNutApexClasses(sharedSession);
  }
  return sharedSession;
}

/**
 * Apex classes that the scenarios really deploy, as SOQL LIKE patterns.
 *
 * Listed in one place so a scenario that starts deploying a class is declared here at the same
 * time, instead of being hunted down the day the coverage gate starts failing.
 */
const NUT_DEPLOYED_APEX_PATTERNS = ['HardisNutImpact%'];

/**
 * Remove from a reused org the Apex classes a previous run deployed into it.
 *
 * With NUT_REUSE_ORG_ENV the scratch org is handed over to the next run, so a class a scenario
 * really deployed stays there. No test covers those classes, so every run drags the org-wide
 * coverage down, and once it falls under 75% every deployment scenario fails on the coverage
 * gate instead of on what it was testing.
 */
export function purgeNutApexClasses(ctx: NutOrgContext): void {
  for (const pattern of NUT_DEPLOYED_APEX_PATTERNS) {
    const records = queryTooling(ctx, `SELECT Id, Name FROM ApexClass WHERE Name LIKE '${pattern}'`);
    for (const record of records) {
      const res = runSf(
        `data delete record --sobject ApexClass --record-id ${record.Id} --use-tooling-api --json --target-org ${ctx.orgAlias}`,
        { cwd: ctx.projectDir, devHubUsername: ctx.devHubUsername, tolerateFailure: true }
      );
      // eslint-disable-next-line no-console
      console.log(
        `[nuts-org] ${res.status === 0 ? 'Deleted' : 'Could not delete'} the Apex class ${record.Name} left in the org`
      );
    }
  }
}

/** Delete the scratch org created by hardis:scratch:create, then clean the test session */
export async function cleanNutOrgSession(ctx: NutOrgContext | undefined): Promise<void> {
  if (!ctx) {
    return;
  }
  try {
    // A reused org belongs to a previous run: deleting it would defeat the purpose
    if (!ctx.reused) {
      // The scratch org was created by sfdx-hardis, so TestSession.clean() does not know about it
      runSf(`org delete scratch --no-prompt --target-org ${ctx.orgAlias} --json`, { cwd: ctx.projectDir, tolerateFailure: true });
    }
  } catch {
    // Best effort: a leaked scratch org expires on its own after SCRATCH_ORG_DURATION days
  }
  // Always restore the process.cwd stub, even if the org deletion misbehaved
  await ctx.session?.clean().catch(() => undefined);
}

/** Write a branch-level sfdx-hardis config as YAML (used to declare deployment actions) */
export async function writeBranchConfig(projectDir: string, branch: string, yamlContent: string): Promise<void> {
  const branchConfigDir = path.join(projectDir, 'config', 'branches');
  await fs.ensureDir(branchConfigDir);
  await fs.writeFile(path.join(branchConfigDir, `.sfdx-hardis.${branch}.yml`), yamlContent, 'utf8');
}

/** Remove any branch-level config, so a scenario does not leak into the next one */
export async function clearBranchConfig(projectDir: string): Promise<void> {
  await fs.remove(path.join(projectDir, 'config', 'branches'));
}

/**
 * Declare an Apex class in the project manifest/package.xml.
 *
 * A class dropped in the source folder alone is never deployed: a full deployment only sends
 * what the manifest lists, and a delta deployment is filtered against that same manifest, so
 * an undeclared class silently disappears from the delta package.
 */
export async function addApexClassToManifest(projectDir: string, className: string): Promise<void> {
  const packageXmlFile = path.join(projectDir, 'manifest', 'package.xml');
  const packageXml = await fs.readFile(packageXmlFile, 'utf8');
  if (packageXml.includes(`<members>${className}</members>`)) {
    return;
  }
  const anchor = '<name>ApexClass</name>';
  if (!packageXml.includes(anchor)) {
    throw new Error(`No ApexClass section found in ${packageXmlFile}, cannot declare ${className}`);
  }
  await fs.writeFile(
    packageXmlFile,
    packageXml.replace(anchor, `<members>${className}</members>\n        ${anchor}`),
    'utf8'
  );
}

/** Copy the deliberately broken Apex class into the project, to make a deployment fail */
export async function addBrokenApexClass(projectDir: string): Promise<void> {
  const targetDir = path.join(projectDir, 'force-app', 'main', 'default', 'classes');
  await fs.ensureDir(targetDir);
  await fs.copy(path.join(FIXTURE_BROKEN_DIR, 'classes'), targetDir);
  await addApexClassToManifest(projectDir, 'HardisNutBroken');
}

/**
 * Run a hardis (or plain sf) command inside the fixture project.
 * `ensureExitCode` is left to the caller: failing-deployment scenarios expect a non-zero code.
 */

export function runHardis<T = any>(
  ctx: NutOrgContext,
  command: string,
  options: { ensureExitCode?: number | 'nonZero'; env?: Record<string, string>; timeout?: number } = {}
) {
  // The exit code is checked here rather than through the testkit `ensureExitCode` option:
  // the testkit assertion only reports the code, and a deployment that fails for an unexpected
  // reason is impossible to diagnose from a CI log without the command output.
  const runOnce = () =>
    execCmd<T>(command, {
      cwd: ctx.projectDir,
      timeout: options.timeout ?? 1800000,
      env: {
        ...process.env,
        ...baseEnv(ctx.devHubUsername),
        ...options.env,
      } as Record<string, string>,
    });
  const expected = options.ensureExitCode;
  const isUnexpected = (code: number) =>
    (expected === 'nonZero' && code === 0) || (typeof expected === 'number' && code !== expected);

  let result = runOnce();
  let output = `${result.shellOutput.stdout || ''}${result.shellOutput.stderr || ''}`;
  // Increasing waits: the only configuration where these scenarios never hit a transient error is
  // a developer machine, where each deployment takes minutes and the org gets that long to settle.
  for (const seconds of [60, 120]) {
    if (!isUnexpected(result.shellOutput.code) || !isTransientOrgError(output)) {
      break;
    }
    // eslint-disable-next-line no-console
    console.log(`[nuts-org] Transient org error, waiting ${seconds}s before running the command again`);
    waitSeconds(seconds);
    result = runOnce();
    output = `${result.shellOutput.stdout || ''}${result.shellOutput.stderr || ''}`;
  }

  if (isUnexpected(result.shellOutput.code)) {
    throw new Error(
      `sf ${command}\nexited with code ${result.shellOutput.code}, ` +
      `expected ${expected === 'nonZero' ? 'a non-zero code' : expected}\n` +
      `--- last 6000 characters of the command output ---\n${output.slice(-6000) || '(empty)'}`
    );
  }
  return result;
}

/**
 * Assert that a command output contains an expected text.
 *
 * Preferred over `expect(output).to.include(...)`: chai truncates the actual value, and a
 * deployment log is far too long to tell from the truncation what actually happened.
 */
export function expectOutputIncludes(output: string, expected: string, hint = ''): void {
  if (!output.includes(expected)) {
    throw new Error(
      `Expected the command output to include:\n  ${expected}\n` +
      (hint ? `${hint}\n` : '') +
      `--- last 6000 characters of the output ---\n${output.slice(-6000) || '(empty)'}`
    );
  }
}

/** Assert that a command output does NOT contain a text, showing where it appears when it does */
export function expectOutputExcludes(output: string, unexpected: string, hint = ''): void {
  const index = output.indexOf(unexpected);
  if (index >= 0) {
    throw new Error(
      `Expected the command output NOT to include:\n  ${unexpected}\n` +
      (hint ? `${hint}\n` : '') +
      `--- output around the unexpected text ---\n${output.slice(Math.max(0, index - 1500), index + 1500)}`
    );
  }
}

/** Count Account records matching a name, to assert that an action really touched the org */
export function countAccounts(ctx: NutOrgContext, namePattern: string): number {
  const res = runSf<any>(
    `data query --query "SELECT COUNT(Id) total FROM Account WHERE Name LIKE '${namePattern}'" --json --target-org ${ctx.orgAlias}`,
    { cwd: ctx.projectDir, devHubUsername: ctx.devHubUsername }
  );
  return Number(res.result?.records?.[0]?.total ?? 0);
}

/** Run a tooling API query and return the records, to assert metadata really exists in the org */
export function queryTooling(ctx: NutOrgContext, soql: string): any[] {
  const res = runSf<any>(`data query --query "${soql}" --use-tooling-api --json --target-org ${ctx.orgAlias}`, {
    cwd: ctx.projectDir,
    devHubUsername: ctx.devHubUsername,
  });
  return res.result?.records ?? [];
}

/** Run a standard SOQL query and return the records */
export function queryRecords(ctx: NutOrgContext, soql: string): any[] {
  const res = runSf<any>(`data query --query "${soql}" --json --target-org ${ctx.orgAlias}`, {
    cwd: ctx.projectDir,
    devHubUsername: ctx.devHubUsername,
  });
  return res.result?.records ?? [];
}

/**
 * Delete the Account records matching a name pattern.
 *
 * Used to reset a marker before the scenario that creates it, so an exact count assertion
 * stays meaningful when the scratch org is reused across runs (see NUT_REUSE_ORG_ENV).
 */
export function deleteAccounts(ctx: NutOrgContext, namePattern: string): number {
  const records = queryRecords(ctx, `SELECT Id FROM Account WHERE Name LIKE '${namePattern}'`);
  for (const record of records) {
    runSf(`data delete record --sobject Account --record-id ${record.Id} --json --target-org ${ctx.orgAlias}`, {
      cwd: ctx.projectDir,
      devHubUsername: ctx.devHubUsername,
      tolerateFailure: true,
    });
  }
  return records.length;
}

/** Read the deployment result report file written by hardis:project:deploy:smart */
export async function readDeployResultReport(
  projectDir: string,
  label = 'calculated-package-xml'
): Promise<any | null> {
  const reportFile = path.join(projectDir, 'hardis-report', `deploy-result-${label}.json`);
  if (!(await fs.pathExists(reportFile))) {
    return null;
  }
  return JSON.parse(await fs.readFile(reportFile, 'utf8'));
}
