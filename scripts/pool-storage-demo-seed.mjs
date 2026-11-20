#!/usr/bin/env node
// Fills the "Scratch Orgs Pool Dashboard" of a THROWAWAY repository with a believable pool, to
// look at how the provider draws it or to take documentation screenshots. The scratch orgs are
// fictional: no Salesforce org is used. An existing dashboard is closed and replaced.
//
// Usage: yarn compile, then
//   node scripts/pool-storage-demo-seed.mjs github|gitlab|azure|bitbucket
//
// Variables: the same as scripts/pool-storage-real-check.mjs

const TOKEN_VARIABLES = {
  github: ['GITHUB_TOKEN'],
  gitlab: ['CI_SFDX_HARDIS_GITLAB_TOKEN'],
  azure: ['CI_SFDX_HARDIS_AZURE_TOKEN'],
  bitbucket: ['CI_SFDX_HARDIS_BITBUCKET_TOKEN'],
};
const ALL_TOKEN_VARIABLES = ['GITHUB_TOKEN', 'CI_SFDX_HARDIS_GITHUB_TOKEN', 'CI_JOB_TOKEN', 'CI_SFDX_HARDIS_GITLAB_TOKEN', 'SYSTEM_ACCESSTOKEN', 'CI_SFDX_HARDIS_AZURE_TOKEN', 'AZURE_DEVOPS_EXT_PAT', 'CI_SFDX_HARDIS_BITBUCKET_TOKEN'];

const provider = process.argv[2];
if (!TOKEN_VARIABLES[provider] || !process.env[TOKEN_VARIABLES[provider][0]]) {
  console.error('Usage: node scripts/pool-storage-demo-seed.mjs github|gitlab|azure|bitbucket (with the variables of that provider)');
  process.exit(2);
}
for (const name of ALL_TOKEN_VARIABLES) {
  if (!TOKEN_VARIABLES[provider].includes(name)) {
    delete process.env[name];
  }
}
if (provider === 'gitlab') {
  process.env.GITLAB_CI = 'true';
}
if (provider === 'azure') {
  process.env.SYSTEM_ACCESSTOKEN = process.env.CI_SFDX_HARDIS_AZURE_TOKEN;
}
process.env.SFDX_HARDIS_POOL_ENCRYPTION_KEY = 'demo-key-' + Date.now();

const { GitProviderPoolStorage } = await import('../lib/common/keyValueProviders/gitProviderPool.js');
const { GitProvider } = await import('../lib/common/gitProvider/index.js');
const { POOL_DASHBOARD_TITLE } = await import('../lib/common/utils/poolDashboardUtils.js');

const JOB_URLS = {
  github: (id) => `https://github.com/mycompany/mycompany-crm/actions/runs/${id}`,
  gitlab: (id) => `https://gitlab.com/mycompany/mycompany-crm/-/jobs/${id}`,
  azure: (id) => `https://dev.azure.com/mycompany/MyCompany-CRM/_build/results?buildId=${id}`,
  bitbucket: (id) => `https://bitbucket.org/mycompany/mycompany-crm/pipelines/results/${id}`,
};
const CI_ACCOUNTS = { github: 'github-actions[bot]', gitlab: 'sfdx-hardis-bot', azure: 'Project Build Service', bitbucket: 'sfdx-hardis-bot' };
const jobUrl = JOB_URLS[provider];

function scratchOrg(suffix, daysLeft) {
  const alias = `PO-${suffix}CI-main_202610${suffix.replace(/\D/g, '').padStart(2, '0').slice(0, 2) || '10'}_0312`;
  return {
    status: 0,
    scratchOrgAlias: alias,
    scratchOrgUsername: `ci@hardis-scratch-${alias.toLowerCase().replace(/_/g, '-')}.com`,
    scratchOrgPassword: 'not-a-real-password',
    scratchOrgSfdxAuthUrl: 'force://PlatformCLI::not-a-real-token@example.my.salesforce.com',
    scratchOrgInfo: { orgId: `00D7Z00000${suffix.padEnd(5, '0').slice(0, 5).toUpperCase()}UAA` },
    authFileJson: { result: { instanceUrl: 'https://mycompany--scratch.sandbox.my.salesforce.com', expirationDate: new Date(Date.now() + daysLeft * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) } },
  };
}

const gitProvider = await GitProvider.getInstance();
if (!gitProvider) {
  console.error('No git provider detected');
  process.exit(2);
}
const existing = await gitProvider.findDashboard(gitProvider.getDashboardTitle(POOL_DASHBOARD_TITLE));
if (existing) {
  await gitProvider.closeDashboard(existing);
  console.log(`Closed the existing dashboard ${existing.url}`);
  // The listing of a provider can still return a dashboard for a moment after it is closed
  for (let attempt = 0; attempt < 20 && (await gitProvider.findDashboard(gitProvider.getDashboardTitle(POOL_DASHBOARD_TITLE))); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

const storage = new GitProviderPoolStorage();
await storage.initialize({});
// Three scratch orgs that will be taken, then four that stay available
const taken = [scratchOrg('k3', 21), scratchOrg('p8', 22), scratchOrg('w2', 23)];
for (const org of taken) {
  await storage.addOrg(org, 'last');
}
const takers = [
  { by: CI_ACCOUNTS[provider], branch: 'features/dev/add-case-priority', pullRequest: '#128', jobUrl: jobUrl(48211) },
  { by: 'victor', branch: 'features/dev/lead-scoring', pullRequest: '', jobUrl: '' },
  { by: CI_ACCOUNTS[provider], branch: 'features/config/opportunity-layout', pullRequest: '#131', jobUrl: jobUrl(48305) },
];
for (const taker of takers) {
  const org = await storage.takeOrg(taker);
  console.log(`Taken: ${org?.scratchOrgAlias} by ${taker.by}`);
}
for (const [suffix, daysLeft] of [['a4', 24], ['d9', 26], ['m1', 27], ['x7', 28]]) {
  await storage.addOrg(scratchOrg(suffix, daysLeft), 'last');
}
await storage.recordFailure('The daily scratch org limit of the Dev Hub is reached', jobUrl(48390));
await storage.finalizeRefresh({ jobUrl: jobUrl(48402), devHubLimits: { activeScratchOrgs: { used: 9, max: 40 }, dailyScratchOrgs: { used: 6, max: 80 } } });
const summary = await storage.getSummary();
console.log(`Dashboard: ${summary.dashboardUrl} (${summary.available} available, ${summary.history.length} taken)`);
process.exit(0);
