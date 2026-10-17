#!/usr/bin/env node
// Proves the git provider storage of the scratch org pool against a real repository.
//
// It adds fake scratch orgs to the "Scratch Orgs Pool Dashboard" of a THROWAWAY repository, lets
// several jobs take them at the same time, and checks that no scratch org is given twice. Then it
// checks the key rotation and removes what it created. No Salesforce org is used.
//
// Usage: yarn compile, then
//   node scripts/pool-storage-real-check.mjs github|gitlab|azure|bitbucket [--keep]
//
// --keep leaves the dashboard open with two scratch orgs in it, to look at it: the key rotation
// is then not checked, and the dashboard has to be closed by hand.
//
// Variables read, per provider (the token variables are the ones sfdx-hardis reads in CI):
//   github:    GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo)
//   gitlab:    CI_SFDX_HARDIS_GITLAB_TOKEN, CI_SERVER_URL, CI_PROJECT_ID
//   azure:     CI_SFDX_HARDIS_AZURE_TOKEN, SYSTEM_COLLECTIONURI, SYSTEM_TEAMPROJECT, BUILD_REPOSITORYNAME
//   bitbucket: CI_SFDX_HARDIS_BITBUCKET_TOKEN, CI_SFDX_HARDIS_BITBUCKET_EMAIL (optional),
//              BITBUCKET_WORKSPACE, BITBUCKET_REPO_SLUG

const PROVIDER_VARIABLES = {
  github: ['GITHUB_TOKEN', 'GITHUB_REPOSITORY'],
  gitlab: ['CI_SFDX_HARDIS_GITLAB_TOKEN', 'CI_SERVER_URL', 'CI_PROJECT_ID'],
  azure: ['CI_SFDX_HARDIS_AZURE_TOKEN', 'SYSTEM_COLLECTIONURI', 'SYSTEM_TEAMPROJECT', 'BUILD_REPOSITORYNAME'],
  bitbucket: ['CI_SFDX_HARDIS_BITBUCKET_TOKEN', 'BITBUCKET_WORKSPACE', 'BITBUCKET_REPO_SLUG'],
};
const TOKEN_VARIABLES = ['GITHUB_TOKEN', 'CI_SFDX_HARDIS_GITHUB_TOKEN', 'CI_JOB_TOKEN', 'CI_SFDX_HARDIS_GITLAB_TOKEN', 'SYSTEM_ACCESSTOKEN', 'CI_SFDX_HARDIS_AZURE_TOKEN', 'AZURE_DEVOPS_EXT_PAT', 'CI_SFDX_HARDIS_BITBUCKET_TOKEN'];
const ORGS = 3;
const TAKERS = 6;

const provider = process.argv[2];
const keep = process.argv.includes('--keep');
if (!PROVIDER_VARIABLES[provider]) {
  console.error('Usage: node scripts/pool-storage-real-check.mjs github|gitlab|azure|bitbucket');
  process.exit(2);
}
const missing = PROVIDER_VARIABLES[provider].filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing variables for ${provider}: ${missing.join(', ')}`);
  process.exit(2);
}
// Only the provider under test must be detected
for (const name of TOKEN_VARIABLES) {
  if (!PROVIDER_VARIABLES[provider].includes(name)) {
    delete process.env[name];
  }
}
if (provider === 'gitlab') {
  process.env.GITLAB_CI = 'true';
}
if (provider === 'azure') {
  process.env.SYSTEM_ACCESSTOKEN = process.env.CI_SFDX_HARDIS_AZURE_TOKEN;
}
process.env.SFDX_HARDIS_POOL_ENCRYPTION_KEY = 'real-check-key-' + Date.now();
// Entries of a previous key are only removed by a CI job
process.env.CI = 'true';

const { GitProviderPoolStorage } = await import('../lib/common/keyValueProviders/gitProviderPool.js');
const { GitProvider } = await import('../lib/common/gitProvider/index.js');
const { POOL_DASHBOARD_TITLE } = await import('../lib/common/utils/poolDashboardUtils.js');

class KeepDashboard extends Error { }

const failures = [];
function check(label, condition, details = '') {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${details ? ` (${details})` : ''}`);
  if (!condition) {
    failures.push(label);
  }
}

function fakeScratchOrg(index) {
  const runId = Date.now().toString(36);
  return {
    status: 0,
    scratchOrgAlias: `PO-check-${runId}-${index}`,
    scratchOrgUsername: `check-${runId}-${index}@hardis-scratch.example.com`,
    scratchOrgPassword: 'not-a-real-password',
    scratchOrgSfdxAuthUrl: `force://PlatformCLI::not-a-real-token-${index}@example.my.salesforce.com`,
    scratchOrgInfo: { orgId: `00D0000000000${index}0AAA` },
    authFileJson: { result: { instanceUrl: 'https://example.my.salesforce.com', expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) } },
  };
}

const context = (index) => ({ by: `taker-${index}`, branch: 'real-check', pullRequest: '', jobUrl: '' });

async function newStorage() {
  const storage = new GitProviderPoolStorage();
  await storage.initialize({});
  return storage;
}

const gitProvider = await GitProvider.getInstance();
check('git provider detected', gitProvider !== null && gitProvider.supportsDashboard(), gitProvider?.getLabel?.() || 'none');
if (failures.length > 0) {
  process.exit(1);
}
const existing = await gitProvider.findDashboard(gitProvider.getDashboardTitle(POOL_DASHBOARD_TITLE));
if (existing) {
  console.error(`A "${POOL_DASHBOARD_TITLE}" already exists on this repository (${existing.url}): use a throwaway repository.`);
  process.exit(2);
}

let dashboard = null;
try {
  // 1. Fill the pool
  const writer = await newStorage();
  for (let index = 0; index < ORGS; index++) {
    await writer.addOrg(fakeScratchOrg(index), 'last');
  }
  dashboard = await gitProvider.findDashboard(gitProvider.getDashboardTitle(POOL_DASHBOARD_TITLE));
  console.log(`Dashboard: ${dashboard?.url}`);
  let summary = await writer.getSummary();
  check(`${ORGS} scratch orgs available after the fill`, summary.available === ORGS, `available=${summary.available}`);
  check('the summary holds no credential', !JSON.stringify(summary).includes('not-a-real'));
  const listed = await writer.listOrgs();
  check('the scratch orgs are read back with their credentials', listed.length === ORGS && listed.every((org) => org.scratchOrgSfdxAuthUrl?.includes('not-a-real-token')));

  // 2. Several jobs take a scratch org at the same time
  const takers = await Promise.all(Array.from({ length: TAKERS }, () => newStorage()));
  const started = Date.now();
  const taken = await Promise.all(takers.map((storage, index) => storage.takeOrg(context(index))));
  const aliases = taken.filter((org) => org !== null).map((org) => org.scratchOrgAlias);
  console.log(`Taken in ${Date.now() - started} ms: ${aliases.join(', ')}`);
  check(`${ORGS} of ${TAKERS} simultaneous takers got a scratch org`, aliases.length === ORGS, `got=${aliases.length}`);
  check('no scratch org was given twice', new Set(aliases).size === aliases.length);
  summary = await writer.getSummary();
  check('the pool is empty afterwards', summary.available === 0, `available=${summary.available}`);
  check(`the history holds the ${ORGS} fetches`, summary.history.length === ORGS, `history=${summary.history.length}`);

  // 3. A refresh records itself, and a key rotation drops the entries of the previous key
  await writer.addOrg(fakeScratchOrg(9), 'last');
  await writer.finalizeRefresh({ jobUrl: '', devHubLimits: { activeScratchOrgs: { used: 1, max: 40 }, dailyScratchOrgs: { used: 2, max: 80 } } });
  summary = await writer.getSummary();
  check('the refresh is recorded', summary.lastRefresh !== null && summary.devHubLimits?.activeScratchOrgs?.max === 40);
  check('the scratch org added before the refresh is available', summary.available === 1, `available=${summary.available}`);
  if (keep) {
    await writer.addOrg(fakeScratchOrg(8), 'last');
    throw new KeepDashboard();
  }
  process.env.SFDX_HARDIS_POOL_PREVIOUS_ENCRYPTION_KEY = process.env.SFDX_HARDIS_POOL_ENCRYPTION_KEY;
  process.env.SFDX_HARDIS_POOL_ENCRYPTION_KEY = 'real-check-rotated-key-' + Date.now();
  summary = await writer.getSummary();
  check('another key is reported as a mismatch', summary.keyStatus === 'mismatch', `keyStatus=${summary.keyStatus}`);
  check('nothing can be taken with another key', (await writer.takeOrg(context(99))) === null);
  await writer.prepareRefresh();
  await writer.finalizeRefresh({ jobUrl: '', devHubLimits: null });
  summary = await writer.getSummary();
  check('the refresh after a key rotation drops the entries of the previous key', summary.available === 0 && summary.keyStatus === 'ok', `available=${summary.available}, keyStatus=${summary.keyStatus}`);
} catch (e) {
  if (!(e instanceof KeepDashboard)) {
    check('no error', false, e?.stack || String(e));
  }
} finally {
  // Remove what was created
  if (dashboard && keep) {
    console.log(`Dashboard left open: ${dashboard.url}`);
  } else if (dashboard) {
    try {
      if (provider === 'azure') {
        const auth = 'Basic ' + Buffer.from(':' + process.env.CI_SFDX_HARDIS_AZURE_TOKEN).toString('base64');
        const url = `${process.env.SYSTEM_COLLECTIONURI.replace(/\/$/, '')}/${encodeURIComponent(process.env.SYSTEM_TEAMPROJECT)}/_apis/wit/workitems/${dashboard.id}?api-version=7.1`;
        await fetch(url, { method: 'DELETE', headers: { Authorization: auth } });
      } else {
        await gitProvider.closeDashboard(dashboard);
      }
      console.log('Dashboard closed');
    } catch (e) {
      console.log(`Dashboard not closed: ${e.message}`);
    }
  }
}

console.log(failures.length === 0 ? '\nAll checks passed' : `\n${failures.length} check(s) failed: ${failures.join('; ')}`);
process.exit(failures.length === 0 ? 0 : 1);
