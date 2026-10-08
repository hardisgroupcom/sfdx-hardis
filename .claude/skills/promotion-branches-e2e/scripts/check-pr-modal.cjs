#!/usr/bin/env node
/*
 * Asserts what the single Pull Request modal of the vscode-sfdx-hardis DevOps Pipeline shows in its
 * Deployment Actions, Validation, Code Quality and Deployment tabs, for every Pull Request of the test
 * repository, open and merged alike (runbook section 4ter).
 *
 * It makes the calls the extension makes, nothing of its own:
 *   - Validation, Code Quality, Deployment, and the status column of Deployment Actions:
 *     `sf hardis:project:action:list --with-status --pr-ids N --with-workflows --workflow-pr-ids N
 *     --json`, run with the provider token ONLY in the environment, which is all the extension
 *     passes (collectProviderCredentialEnvVars): no GITHUB_REPOSITORY, no CI_PROJECT_ID.
 *   - the action list of Deployment Actions: the extension's own compiled
 *     completePullRequestsWithActions(..., { fetch: true }), as getPrInfoForModal calls it.
 * Then it compares them with what the provider really holds:
 *   - a validation comment (message key deployment-check-*) must be a validation run of the tab,
 *     with the status of its run-summary marker when it has one;
 *   - a deployment comment (message key deployment-*) must be a deployment run of the tab, same;
 *   - a MegaLinter comment must be a megalinter run;
 *   - the tabs must not be hidden: the CLI must answer, with an array for the Pull Request;
 *   - every cell of the "Status by org" table of the Deployment Actions comment must be a
 *     status the CLI returns (actionId, orgBranch), and the cells of the target branch are the pills
 *     the modal shows;
 *   - the action list of a story equals the ids of its actions file (source branch of an open one,
 *     the file as merged for a merged one).
 *
 *   PROVIDER=github REPO=owner/name WORK=<clone> DEV=<sfdx-hardis bin/run.js> EXT=<extension> \
 *     node check-pr-modal.cjs [--prs 1,2,3] [--json out.json]
 *   PROVIDER=gitlab GL_HOST=https://gitlab.example.com GL_TOKEN=... PROJECT_ID=1234 ... (same)
 *   PROVIDER=azure AZ_ORG=... AZ_PROJECT=... AZ_REPO_ID=<guid> AZ_TOKEN=<PAT> ... (same)
 *   PROVIDER=bitbucket BB_WORKSPACE=... BB_REPO=... BB_EMAIL=<account email, empty for an Access
 *     Token> BB_TOKEN=... ... (same)
 *   or, with the provider library sourced through promotion-provider.sh: p_pr_modal_check [--prs ...]
 *
 * The provider comments are read the way the CLI reads them: GitHub issue comments, GitLab notes
 * (system notes left out), Azure DevOps thread comments (deleted threads and comments left out),
 * Bitbucket Pull Request comments (content.raw, deleted ones left out).
 *
 * Exit 1 when any Pull Request disagrees. Each CLI start costs 10 to 30 seconds on Windows: a repository
 * of 60 Pull Requests takes about half an hour.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const PROVIDER = process.env.PROVIDER || 'github';
const WORK = process.env.WORK;
const DEV = process.env.DEV;
const EXT = process.env.EXT || 'C:/git/vscode-sfdx-hardis';
if (!WORK || !DEV) {
  console.error('WORK and DEV are required');
  process.exit(2);
}
// The same fallbacks as e2e-lib-azure.sh and e2e-lib-bitbucket.sh (from the environment only here)
process.env.AZ_TOKEN = process.env.AZ_TOKEN || process.env.AZURE_PERSONAL_ACCESS_TOKEN || '';
process.env.BB_TOKEN = process.env.BB_TOKEN || process.env.ATLASSIAN_TOKEN || '';
if (process.env.BB_EMAIL === undefined) {
  process.env.BB_EMAIL = process.env.ATLASSIAN_EMAIL || '';
}
const REQUIRED = {
  github: ['REPO'],
  gitlab: ['GL_HOST', 'GL_TOKEN', 'PROJECT_ID'],
  azure: ['AZ_ORG', 'AZ_PROJECT', 'AZ_REPO_ID', 'AZ_TOKEN'],
  bitbucket: ['BB_WORKSPACE', 'BB_REPO', 'BB_TOKEN'],
}[PROVIDER];
if (!REQUIRED) {
  console.error(`unknown PROVIDER ${PROVIDER}: github, gitlab, azure or bitbucket`);
  process.exit(2);
}
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`PROVIDER=${PROVIDER} needs ${missing.join(', ')}`);
  process.exit(2);
}
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const onlyPrs = (argValue('--prs') || '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);
const jsonOut = argValue('--json');

// ------------------------------------------------------------------ provider reads (ground truth)
function ghApi(url) {
  const out = execFileSync('gh', ['api', '--paginate', url], { encoding: 'utf8', maxBuffer: 1 << 28 });
  // --paginate concatenates JSON arrays: "][" between pages
  return JSON.parse(out.replace(/\]\s*\[/g, ','));
}
function glApi(url) {
  const items = [];
  for (let page = 1; page < 50; page++) {
    const sep = url.includes('?') ? '&' : '?';
    const out = execFileSync(
      'curl',
      ['-sS', '-H', `PRIVATE-TOKEN: ${process.env.GL_TOKEN}`, `${process.env.GL_HOST}/api/v4/${url}${sep}per_page=100&page=${page}`],
      { encoding: 'utf8', maxBuffer: 1 << 28 },
    );
    const parsed = JSON.parse(out);
    if (!Array.isArray(parsed)) {
      return parsed;
    }
    items.push(...parsed);
    if (parsed.length < 100) {
      break;
    }
  }
  return items;
}
// Azure DevOps: Basic auth with an empty user and the PAT, the paging of the REST API ($top/$skip)
const AZ_REPO_API = PROVIDER === 'azure' ? `https://dev.azure.com/${process.env.AZ_ORG}/${process.env.AZ_PROJECT}/_apis/git/repositories/${process.env.AZ_REPO_ID}` : '';
function curlJson(url, auth) {
  const out = execFileSync('curl', ['-sS', ...auth, url], { encoding: 'utf8', maxBuffer: 1 << 28 });
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`not JSON from ${url.split('?')[0]}: ${out.slice(0, 200)}`);
  }
}
function azApi(pathAndQuery) {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  return curlJson(`${AZ_REPO_API}/${pathAndQuery}${sep}api-version=7.1`, ['-u', `:${process.env.AZ_TOKEN}`]);
}
function azPullRequests() {
  const items = [];
  for (let skip = 0; skip < 5000; skip += 500) {
    const page = azApi(`pullrequests?searchCriteria.status=all&$top=500&$skip=${skip}`).value || [];
    items.push(...page);
    if (page.length < 500) {
      break;
    }
  }
  return items;
}
// Bitbucket Cloud: Basic auth with the Atlassian account email for an API token, Bearer for an
// Access Token (the same rule as the CLI and the extension), and the "next" link for paging
const BB_API = PROVIDER === 'bitbucket' ? `https://api.bitbucket.org/2.0/repositories/${process.env.BB_WORKSPACE}/${process.env.BB_REPO}` : '';
function bbAuth() {
  return process.env.BB_EMAIL ? ['-u', `${process.env.BB_EMAIL}:${process.env.BB_TOKEN}`] : ['-H', `Authorization: Bearer ${process.env.BB_TOKEN}`];
}
function bbPaged(url) {
  const items = [];
  let next = url;
  while (next) {
    const page = curlJson(next, bbAuth());
    if (!Array.isArray(page.values)) {
      throw new Error(`Bitbucket answered ${JSON.stringify(page).slice(0, 200)}`);
    }
    items.push(...page.values);
    next = page.next || null;
  }
  return items;
}
function listPullRequests() {
  if (PROVIDER === 'azure') {
    return azPullRequests().map((p) => ({
      number: p.pullRequestId,
      state: p.status === 'completed' ? 'merged' : p.status === 'active' ? 'open' : 'closed',
      sourceBranch: (p.sourceRefName || '').replace('refs/heads/', ''),
      targetBranch: (p.targetRefName || '').replace('refs/heads/', ''),
      title: p.title,
    }));
  }
  if (PROVIDER === 'bitbucket') {
    // Every state named: without it Bitbucket lists the open ones only
    return bbPaged(`${BB_API}/pullrequests?state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED&pagelen=50`).map((p) => ({
      number: p.id,
      state: p.state === 'MERGED' ? 'merged' : p.state === 'OPEN' ? 'open' : 'closed',
      sourceBranch: p.source?.branch?.name || '',
      targetBranch: p.destination?.branch?.name || '',
      title: p.title,
    }));
  }
  if (PROVIDER === 'github') {
    return ghApi(`repos/${process.env.REPO}/pulls?state=all&per_page=100`).map((p) => ({
      number: p.number,
      state: p.merged_at ? 'merged' : p.state === 'open' ? 'open' : 'closed',
      sourceBranch: p.head.ref,
      targetBranch: p.base.ref,
      title: p.title,
    }));
  }
  return glApi(`projects/${process.env.PROJECT_ID}/merge_requests?state=all`).map((m) => ({
    number: m.iid,
    state: m.state === 'merged' ? 'merged' : m.state === 'opened' ? 'open' : 'closed',
    sourceBranch: m.source_branch,
    targetBranch: m.target_branch,
    title: m.title,
  }));
}
function listComments(number) {
  if (PROVIDER === 'azure') {
    // AzureDevopsProvider.listPullRequestCommentsByMarker: every comment of every thread, the
    // deleted threads and the deleted comments left out (getThreads still returns those)
    const bodies = [];
    for (const thread of azApi(`pullrequests/${number}/threads`).value || []) {
      if (thread.isDeleted) {
        continue;
      }
      for (const comment of thread.comments || []) {
        if (!comment.isDeleted) {
          bodies.push(comment.content || '');
        }
      }
    }
    return bodies;
  }
  if (PROVIDER === 'bitbucket') {
    // BitbucketProvider.listPullRequestCommentsByMarker: content.raw, deleted comments left out
    return bbPaged(`${BB_API}/pullrequests/${number}/comments?pagelen=50`)
      .filter((c) => !c.deleted)
      .map((c) => c.content?.raw || '');
  }
  if (PROVIDER === 'github') {
    return ghApi(`repos/${process.env.REPO}/issues/${number}/comments?per_page=100`).map((c) => c.body || '');
  }
  return glApi(`projects/${process.env.PROJECT_ID}/merge_requests/${number}/notes?sort=asc`)
    .filter((n) => !n.system)
    .map((n) => n.body || '');
}

// The same classification as getPrCommentKind / parseWorkflowRunsFromComments of sfdx-hardis
function expectedRuns(comments) {
  const runs = [];
  let actionsState = null;
  for (const body of comments) {
    if (body.includes('<!-- sfdx-hardis deployment-actions-state -->')) {
      actionsState = body;
      continue;
    }
    if (body.includes('<!-- megalinter:') || /^#+ .*MegaLinter.*analysis: *([^\n]*)$/im.test(body)) {
      runs.push({ kind: 'megalinter', status: null });
      continue;
    }
    // The key holds the CI job name, spaces included on GitHub Actions: read up to the end of the marker
    const key = (body.match(/<!-- sfdx-hardis message-key (.+?) -->/) || [])[1];
    if (!key || !key.startsWith('deployment-')) {
      continue;
    }
    const kind = key.startsWith('deployment-check-') ? 'validation' : 'deployment';
    let status = null;
    const summary = body.match(/<!-- sfdx-hardis run-summary ([A-Za-z0-9+/=]+) -->/);
    if (summary) {
      try {
        status = JSON.parse(Buffer.from(summary[1], 'base64').toString('utf8')).status || null;
      } catch {
        status = 'UNREADABLE';
      }
    }
    runs.push({ kind, status, key });
  }
  return { runs, actionsState };
}

// The cells of the "Status by org" table: [{ actionId, orgBranch, cell }]
function stateCells(body) {
  if (!body) {
    return [];
  }
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\| Action \| When \|/.test(l));
  if (start < 0) {
    return [];
  }
  const header = lines[start].split('|').map((s) => s.trim());
  const orgs = header.slice(3, header.length - 1);
  const cells = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const parts = lines[i].split('|').map((s) => s.trim());
    const actionId = (parts[1].match(/actionId:(\S+)/) || [])[1];
    if (!actionId) {
      continue;
    }
    orgs.forEach((org, j) => {
      const cell = parts[3 + j] || '';
      // ⬜ is "not run in this org branch yet": no status, the tab says the same
      if (cell && cell !== '-' && !cell.startsWith('⬜')) {
        cells.push({ actionId, orgBranch: org, cell });
      }
    });
  }
  return cells;
}

// ------------------------------------------------------------------ what the modal gets
function runActionList(number) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    // AZURE_DEVOPS_EXT_PAT and PAT select a provider too: a leftover one would win over the token below
    if (/^(GITHUB_|CI_|GITLAB_|SYSTEM_|BUILD_|BITBUCKET_|AZURE_DEVOPS_EXT_PAT$|PAT$|NODE_OPTIONS$|CI$)/.test(k)) {
      delete env[k];
    }
  }
  // What collectProviderCredentialEnvVars of the extension passes, and nothing else: the CLI finds the
  // repository from the git remote
  if (PROVIDER === 'github') {
    env.GITHUB_TOKEN = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } else if (PROVIDER === 'gitlab') {
    env.CI_SFDX_HARDIS_GITLAB_TOKEN = process.env.GL_TOKEN;
  } else if (PROVIDER === 'azure') {
    env.CI_SFDX_HARDIS_AZURE_TOKEN = process.env.AZ_TOKEN;
    env.SYSTEM_ACCESSTOKEN = process.env.AZ_TOKEN;
  } else if (PROVIDER === 'bitbucket') {
    env.CI_SFDX_HARDIS_BITBUCKET_TOKEN = process.env.BB_TOKEN;
    if (process.env.BB_EMAIL) {
      env.CI_SFDX_HARDIS_BITBUCKET_EMAIL = process.env.BB_EMAIL;
    }
  }
  const started = Date.now();
  const res = spawnSync(
    'node',
    [DEV, 'hardis:project:action:list', '--with-status', '--pr-ids', String(number), '--with-workflows', '--workflow-pr-ids', String(number), '--json'],
    { cwd: WORK, env, encoding: 'utf8', input: '', maxBuffer: 1 << 28, timeout: 300000 },
  );
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    parsed = null;
  }
  return { parsed, ms: Date.now() - started, stderr: (res.stderr || '').slice(-500) };
}

// The extension's completePullRequestsWithActions, loaded from its tsc output with a vscode stub
let completeWithActions = null;
function loadExtension() {
  const Module = require('module');
  const origLoad = Module._load;
  const stub = {
    workspace: {
      getConfiguration: () => ({ get: () => undefined, has: () => false, update: async () => {} }),
      workspaceFolders: [{ uri: { path: WORK, fsPath: WORK }, name: 'e2e', index: 0 }],
      onDidChangeConfiguration: () => ({ dispose() {} }),
      fs: {},
    },
    env: { language: 'en' },
    window: {
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
    },
    commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => undefined },
    Uri: { file: (p) => ({ fsPath: p, path: p }) },
    EventEmitter: class {
      constructor() {
        this.event = () => ({ dispose() {} });
      }
      fire() {}
      dispose() {}
    },
    ProgressLocation: { Notification: 15, Window: 10 },
    ExtensionMode: { Development: 1, Production: 2, Test: 3 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  };
  Module._load = function (request) {
    if (request === 'vscode') {
      return stub;
    }
    return origLoad.apply(this, arguments);
  };
  try {
    completeWithActions = require(path.join(EXT, 'out', 'utils', 'prePostCommandsUtils.js')).completePullRequestsWithActions;
  } catch (e) {
    console.error(`Cannot load the extension's prePostCommandsUtils: compile it first (cd ${EXT} && yarn compile): ${e}`);
    process.exit(2);
  }
}

function gitShow(ref, file) {
  const res = spawnSync('git', ['show', `${ref}:${file}`], { cwd: WORK, encoding: 'utf8' });
  return res.status === 0 ? res.stdout : null;
}
// Ids of the actions file of a Pull Request, as the branch holds it
function fileActionIds(pr) {
  const ref = pr.state === 'merged' ? `origin/${pr.targetBranch}` : `origin/${pr.sourceBranch}`;
  const content = gitShow(ref, `scripts/actions/.sfdx-hardis.${pr.number}.yml`);
  if (content === null) {
    return null;
  }
  return [...content.matchAll(/^\s*-?\s*id:\s*["']?([\w.-]+)/gm)].map((m) => m[1]);
}

// ------------------------------------------------------------------ main
(async () => {
  loadExtension();
  process.chdir(WORK);
  spawnSync('git', ['fetch', '-q', 'origin'], { cwd: WORK });
  let prs = listPullRequests().filter((p) => p.state !== 'closed');
  if (onlyPrs.length) {
    prs = prs.filter((p) => onlyPrs.includes(p.number));
  }
  prs.sort((a, b) => a.number - b.number);
  const majors = new Set(['integration', 'uat', 'preprod', 'main']);
  const report = [];
  let failures = 0;
  for (const pr of prs) {
    const problems = [];
    const notes = [];
    const { runs: expected, actionsState } = expectedRuns(listComments(pr.number));
    const { parsed, ms, stderr } = runActionList(pr.number);
    const result = parsed?.status === 0 ? parsed.result : null;
    const shown = result?.workflows?.[String(pr.number)];
    if (!result) {
      problems.push(`action:list did not answer (${parsed?.message || stderr.split('\n').filter(Boolean).pop() || 'no JSON'}): the three tabs are hidden`);
    } else if (result.gitProvider === false) {
      problems.push('action:list ran without git provider: statuses hidden');
    }
    if (result && !Array.isArray(shown)) {
      problems.push('no workflows array for the Pull Request: Validation, Code Quality and Deployment tabs hidden');
    }
    const shownRuns = Array.isArray(shown) ? shown : [];
    for (const kind of ['validation', 'deployment', 'megalinter']) {
      const want = expected.filter((r) => r.kind === kind);
      const got = shownRuns.filter((r) => r.kind === kind);
      if (want.length !== got.length) {
        problems.push(`${kind}: ${want.length} comment(s) on the provider, ${got.length} run(s) in the tab`);
        continue;
      }
      want.forEach((w, i) => {
        if (w.status && got[i] && got[i].status !== w.status) {
          problems.push(`${kind}: comment says ${w.status}, the tab says ${got[i].status}`);
        }
      });
    }
    // Deployment Actions: statuses
    const cells = stateCells(actionsState);
    const statuses = result?.statuses?.[String(pr.number)] || [];
    for (const c of cells) {
      if (!statuses.some((s) => s.actionId === c.actionId && s.orgBranch === c.orgBranch)) {
        problems.push(`Deployment Actions: ${c.actionId} in ${c.orgBranch} is "${c.cell}" in the comment, no status in the tab`);
      }
    }
    const pills = statuses.filter((s) => s.orgBranch === pr.targetBranch).length;
    // Deployment Actions: the list, from the extension's own code
    const isStory = !majors.has(pr.sourceBranch) && !pr.sourceBranch.startsWith('promotion/');
    let listed = null;
    if (isStory) {
      const modalPr = { number: pr.number, state: pr.state, sourceBranch: pr.sourceBranch, targetBranch: pr.targetBranch, title: pr.title };
      try {
        const [completed] = await completeWithActions([modalPr], { fetch: true, workspaceRoot: WORK });
        listed = (completed.deploymentActions || []).map((a) => a.id);
        const fileIds = fileActionIds(pr);
        if (fileIds && fileIds.join(',') !== listed.join(',')) {
          problems.push(`Deployment Actions list: file has [${fileIds}], the modal lists [${listed}] (source ${completed.deploymentActionsSource})`);
        }
        const missingInList = [...new Set(cells.map((c) => c.actionId))].filter((id) => fileIds && fileIds.includes(id) && !listed.includes(id));
        if (missingInList.length) {
          problems.push(`Deployment Actions list misses ${missingInList} that the comment reports`);
        }
      } catch (e) {
        problems.push(`completePullRequestsWithActions threw: ${e.message}`);
      }
    }
    if (pr.state === 'merged' && majors.has(pr.targetBranch) && !expected.some((r) => r.kind === 'deployment')) {
      notes.push('merged into a major branch, no deployment comment on the provider');
    }
    const line = {
      number: pr.number,
      state: pr.state,
      branches: `${pr.sourceBranch} -> ${pr.targetBranch}`,
      comments: expected.map((r) => `${r.kind}${r.status ? ':' + r.status : ''}`).join(' '),
      tab: shownRuns.map((r) => `${r.kind}:${r.status}`).join(' '),
      actionCells: cells.length,
      pills,
      listed: listed ? listed.join(',') : '-',
      seconds: Math.round(ms / 1000),
      problems,
      notes,
    };
    report.push(line);
    if (problems.length) {
      failures++;
    }
    console.log(
      `#${pr.number} ${pr.state} ${line.branches} | comments [${line.comments}] | tab [${line.tab}] | action cells ${cells.length}, pills ${pills} | list [${line.listed}] | ${line.seconds}s | ${problems.length ? 'FAIL: ' + problems.join('; ') : 'OK'}${notes.length ? ' | note: ' + notes.join('; ') : ''}`,
    );
  }
  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  }
  console.log(`PR MODAL CHECK: ${report.length - failures} OK, ${failures} FAIL over ${report.length} Pull Requests`);
  process.exit(failures ? 1 : 0);
})();
