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
import fs from 'fs-extra';
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
}

/** Run a git command inside the fixture project */
export function git(projectDir: string, command: string): string {
  return execSync(`git ${command}`, {
    cwd: projectDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Base environment shared by every hardis command run in the NUTs */
function baseEnv(devHubUsername: string): Record<string, string> {
  return {
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
  options: { cwd?: string; devHubUsername?: string; tolerateFailure?: boolean } = {}
): { status: number; result: T | null; output: string } {
  const env = {
    ...process.env,
    ...(options.devHubUsername ? baseEnv(options.devHubUsername) : {}),
  } as Record<string, string>;
  let output = '';
  let parsed: any = null;
  try {
    output = execSync(`sf ${command}`, {
      cwd: options.cwd ?? process.cwd(),
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    });
    parsed = JSON.parse(output);
  } catch (e: any) {
    output = `${e?.stdout ?? ''}${e?.stderr ?? ''}`;
    try {
      parsed = JSON.parse(e?.stdout ?? '');
    } catch {
      parsed = null;
    }
  }
  const status = parsed?.status ?? 1;
  // Never fail silently: a helper that returns an empty result on error makes every assertion
  // built on it fail with a meaningless "expected 0 to equal 2" and no way to tell why.
  if (!options.tolerateFailure && (status !== 0 || parsed === null)) {
    throw new Error(`sf ${command}\nfailed with status ${status}:\n${output.slice(0, 2000)}`);
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

/** Resolve the Dev Hub username authenticated by the testkit (TESTKIT_AUTH_URL) */
function resolveDevHubUsername(session: TestSession): string {
  const fromSession = (session as any)?.hubOrg?.username;
  if (fromSession) {
    return fromSession as string;
  }
  if (process.env.TESTKIT_HUB_USERNAME) {
    return process.env.TESTKIT_HUB_USERNAME;
  }
  // Last resort: ask the CLI for the default Dev Hub
  const res = runSf<any>('org list --json', { tolerateFailure: true });
  const devHub = (res.result?.devHubs ?? []).find((o: any) => o.username);
  if (!devHub?.username) {
    throw new Error('Unable to resolve a Dev Hub username. Is TESTKIT_AUTH_URL set and is the org a Dev Hub?');
  }
  return devHub.username;
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

    // hardis:scratch:create derives the scratch org username from the alias
    // (nut@hardis-scratch-<alias>.com). Salesforce refuses to reuse a scratch org username,
    // even once the org has been deleted, so the alias must be unique on every run.
    // Kept short: the command truncates aliases longer than 30 characters.
    const runSuffix = (process.env.GITHUB_RUN_ID || Date.now().toString(36)).slice(-8);
    const requestedAlias = `hardis-nut-${scenario}-${runSuffix}`;
    const orgAlias = `CI-${requestedAlias}`;

    const createScratchOrg = (ensureExitCode: number | undefined) =>
      execCmd(`hardis:scratch:create --target-dev-hub ${devHubUsername} --agent`, {
        cwd: projectDir,
        ensureExitCode,
        timeout: 1800000,
        env: {
          ...process.env,
          ...baseEnv(devHubUsername),
          SCRATCH_ORG_ALIAS: requestedAlias,
        } as Record<string, string>,
      });

    let createResult = createScratchOrg(undefined);
    let scratchCreateOutput = createResult.shellOutput.stdout + createResult.shellOutput.stderr;

    // The Dev Hub allows a limited number of active scratch orgs, and a crashed job leaks its
    // own. When we hit the limit, free the slots taken by previous NUT runs and try once more.
    if (createResult.shellOutput.code !== 0) {
      if (/LIMIT_EXCEEDED|active scratch org limit|no more scratch orgs available/i.test(scratchCreateOutput)) {
        // eslint-disable-next-line no-console
        console.log('[nuts-org] Scratch org limit reached, deleting the orgs left by previous runs...');
        const freed = freeNutScratchOrgSlots(devHubUsername);
        if (freed === 0) {
          throw new Error(
            'Scratch org limit reached on the Dev Hub, and no NUT scratch org could be freed. ' +
            'Delete some orgs in the "Active Scratch Orgs" tab of the Dev Hub.'
          );
        }
        createResult = createScratchOrg(0);
        scratchCreateOutput = createResult.shellOutput.stdout + createResult.shellOutput.stderr;
      } else {
        throw new Error(`hardis:scratch:create failed:\n${scratchCreateOutput}`);
      }
    }

    return { session, projectDir, orgAlias, devHubUsername, scratchCreateOutput };
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
  return sharedSession;
}

/** Delete the scratch org created by hardis:scratch:create, then clean the test session */
export async function cleanNutOrgSession(ctx: NutOrgContext | undefined): Promise<void> {
  if (!ctx) {
    return;
  }
  try {
    // The scratch org was created by sfdx-hardis, so TestSession.clean() does not know about it
    runSf(`org delete scratch --no-prompt --target-org ${ctx.orgAlias} --json`, { cwd: ctx.projectDir, tolerateFailure: true });
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

/** Copy the deliberately broken Apex class into the project, to make a deployment fail */
export async function addBrokenApexClass(projectDir: string): Promise<void> {
  const targetDir = path.join(projectDir, 'force-app', 'main', 'default', 'classes');
  await fs.ensureDir(targetDir);
  await fs.copy(path.join(FIXTURE_BROKEN_DIR, 'classes'), targetDir);
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
  return execCmd<T>(command, {
    cwd: ctx.projectDir,
    ensureExitCode: options.ensureExitCode,
    timeout: options.timeout ?? 1800000,
    env: {
      ...process.env,
      ...baseEnv(ctx.devHubUsername),
      ...options.env,
    } as Record<string, string>,
  });
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
