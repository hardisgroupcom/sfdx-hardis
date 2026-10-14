#!/usr/bin/env node
/*
 * Writes the CI files of a real CI end to end repository (runbook section 6quinquies): the
 * sfdx-hardis templates of the provider, with as few changes as possible:
 *
 *   - before the sfdx-hardis commands, a step that clones sfdx-hardis on the branch under test,
 *     builds it and links it with `sf plugins link`, so the jobs run the code of the branch, not the
 *     release of the Docker image;
 *   - the SFDX_AUTH_URL_<BRANCH> logins, so the four major branches log in to a throwaway org
 *     without the JWT connected app a real project uses (GitHub: secrets passed in the env block of
 *     the step; GitLab: project CI/CD variables, which reach the jobs with no change to the YAML;
 *     Azure: secret pipeline variables mapped in the env block; Bitbucket: secured repository
 *     variables, which reach the steps with no change to the YAML).
 *
 *   node ci-workflows-prepare.cjs [--provider github|gitlab|azure|bitbucket] [--bundle <file>] \
 *     <sfdx-hardis root> <repository root> <sfdx-hardis branch>
 *
 * Every file written is parsed back as YAML and checked (the link step is there, the logins are
 * mapped...) before the script ends, so a syntax error stops the run before a repository exists and
 * before a build minute is spent. --provider bitbucket also validates the file against the public
 * JSON schema of bitbucket-pipelines.yml (one GET; when it cannot be read, a warning, not a stop).
 *
 * --provider github (default): .github/workflows/check-deploy.yml and process-deploy.yml.
 * --provider gitlab: .gitlab-ci.yml, where the sfdx-hardis jobs (check_deploy_to_target_branch_org,
 *   check_deploy_to_current_branch_org, deploy_to_org) get a before_script with the link step, and
 *   .gitlab-ci-config.yml, where DEPLOY_BRANCHES names the four major branches and USE_SCRATCH_ORGS
 *   is "false" (no Dev Hub in this test). The jobs keep the `tags` of the template: GITLAB_RUNNER_TAG
 *   (default `ubuntu`) must be one of them, or the script stops, since the group runners of the test
 *   group do not run untagged jobs.
 *   --bundle <file> also writes the two GitLab files as one document (the include replaced by the
 *   variables it holds), for the CI lint API, which cannot resolve a local include it does not hold.
 * --provider azure: azure-pipelines-checks.yml and azure-pipelines-deployment.yml at the root of the
 *   repository (the paths the pipeline definitions point at). A step before the sfdx-hardis one links
 *   the branch; the logins come from secret pipeline variables mapped in the env block; the checks
 *   pipeline gets `trigger: none` (the build validation policy of each major branch runs it on Pull
 *   Requests, which the template comment asks to set by hand), the deployment pipeline a CI trigger
 *   on the four major branches and `pr: none`. The MegaLinter job of the checks template is left
 *   out: the free tier has one parallel job and 1800 minutes a month. AZURE_E2E_CI_TOKEN=pat maps
 *   CI_SFDX_HARDIS_AZURE_TOKEN to a secret variable holding the PAT instead of $(System.AccessToken)
 *   (see ci-provider-azure.sh).
 * --provider bitbucket: bitbucket-pipelines.yml, the link commands before `sf hardis:auth:login` in
 *   both steps, with a cache of the clone (`sfdxhardislink`, /tmp/sfdx-hardis: a later step fetches
 *   the branch into it and reuses node_modules). The MegaLinter step of the pull request pipeline is
 *   left out (build minutes). The logins and the token are repository variables, set by
 *   ci-provider-bitbucket.sh.
 *
 * With SFDX_HARDIS_IMAGE set (ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:beta for instance), the jobs
 * run in that image instead of `:latest`, and the branch argument may be `-`: no link step, the jobs
 * run the release the image holds. A step prints `sf plugins` so the version can be asserted.
 *
 * A new provider adds a writer to WRITERS: it receives (root, target, branch), writes its files and
 * returns them as [{ file, check(doc) }], check throwing when the parsed document is wrong.
 */
const fs = require('fs');
const path = require('path');
const env = require('./env-lib.cjs');

env.loadEnv(['GITLAB_RUNNER_TAG', 'AZURE_E2E_CI_TOKEN', 'SFDX_HARDIS_IMAGE']);
const MAJOR_BRANCHES = ['INTEGRATION', 'UAT', 'PREPROD', 'MAIN'];
const SFDX_HARDIS_REPO = 'https://github.com/hardisgroupcom/sfdx-hardis.git';
const BITBUCKET_SCHEMA_URL = 'https://api.bitbucket.org/schemas/pipelines-configuration';
const LINK_MARKER = 'sf plugins link /tmp/sfdx-hardis';
// An Azure Pipelines container job runs its steps as a user the agent creates, not as root, and the
// image keeps the plugins in a folder of root (SF_DATA_DIR=/usr/local/lib): the link needs sudo,
// which the image ships for that agent. HOME is root's for that command: with the HOME of the step
// user, root creates ~/.sf and the next sf command of the job cannot write its log there
const AZURE_LINK_PREFIX = 'sudo env "PATH=$PATH" "SF_DATA_DIR=$SF_DATA_DIR" HOME=/root ';
const image = process.env.SFDX_HARDIS_IMAGE || '';

const { provider, bundle, positional } = parseArgs(process.argv.slice(2));
const [root, target, branch] = positional;
if (!root || !target || !branch) {
  console.error(
    'usage: ci-workflows-prepare.cjs [--provider github|gitlab|azure|bitbucket] [--bundle <file>] <sfdx-hardis root> <repository root> <sfdx-hardis branch>',
  );
  process.exit(2);
}
const WRITERS = { github: writeGitHub, gitlab: writeGitLab, azure: writeAzure, bitbucket: writeBitbucket };
if (!WRITERS[provider]) {
  console.error(`unknown provider ${provider}: ${Object.keys(WRITERS).join(', ')}`);
  process.exit(2);
}
const written = WRITERS[provider](root, target, branch) || [];
checkWrittenFiles(written, provider === 'bitbucket').catch((e) => fail(`YAML check failed: ${e.message}`));

function parseArgs(args) {
  const result = { provider: 'github', bundle: '', positional: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider') {
      result.provider = args[++i] || '';
    } else if (args[i] === '--bundle') {
      result.bundle = args[++i] || '';
    } else {
      result.positional.push(args[i]);
    }
  }
  return result;
}

// ------------------------------------------------------------------ GitHub Actions
function writeGitHub(sfdxHardisRoot, repositoryRoot, sfdxHardisBranch) {
  const versionStep = [
    `      # E2E ONLY: sfdx-hardis of the image ${image}`,
    `      - name: E2E ONLY - sfdx-hardis version`,
    '        run: sf plugins',
  ];
  const linkStep =
    sfdxHardisBranch === '-'
      ? versionStep
      : [
          `      # E2E ONLY: sfdx-hardis built from its branch ${sfdxHardisBranch}`,
          `      - name: E2E ONLY - sfdx-hardis from ${sfdxHardisBranch}`,
          '        run: |',
          ...linkCommands(sfdxHardisBranch, '').map((l) => `          ${l}`),
        ];
  const authLines = MAJOR_BRANCHES.map((b) => `          SFDX_AUTH_URL_${b}: \${{ secrets.SFDX_AUTH_URL_${b} }}`);

  const outDir = path.join(repositoryRoot, '.github', 'workflows');
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const name of ['check-deploy.yml', 'process-deploy.yml']) {
    const lines = readTemplate(path.join(sfdxHardisRoot, 'defaults', 'ci', '.github', 'workflows', name));
    const loginIndex = lines.findIndex((l) => /^ {6}- name: Login & /.test(l));
    if (loginIndex < 0) {
      fail(`${name}: no "Login & ..." step`);
    }
    const envIndex = lines.findIndex((l, i) => i > loginIndex && /^ {8}env:\s*$/.test(l));
    if (envIndex < 0) {
      fail(`${name}: no env block in the sfdx-hardis step`);
    }
    if (image) {
      const containerIndex = lines.findIndex((l) => /^ {4}container: /.test(l));
      if (containerIndex < 0) {
        fail(`${name}: no container line`);
      }
      lines[containerIndex] = `    container: ${image}`;
    }
    lines.splice(envIndex + 1, 0, ...authLines);
    lines.splice(loginIndex, 0, ...linkStep);
    const file = path.join(outDir, name);
    fs.writeFileSync(file, lines.join('\n'));
    console.log(`written ${file}`);
    files.push({ file, check: (doc, text) => checkText(name, text, sfdxHardisBranch, ['SFDX_AUTH_URL_MAIN: ${{ secrets.SFDX_AUTH_URL_MAIN }}']) });
  }
  return files;
}

// ------------------------------------------------------------------ GitLab CI
function writeGitLab(sfdxHardisRoot, repositoryRoot, sfdxHardisBranch) {
  const runnerTag = process.env.GITLAB_RUNNER_TAG || 'ubuntu';
  const sfdxHardisJobs = ['check_deploy_to_target_branch_org', 'check_deploy_to_current_branch_org', 'deploy_to_org'];
  const templates = path.join(sfdxHardisRoot, 'defaults', 'ci');
  const main = readTemplate(path.join(templates, '.gitlab-ci.yml'));
  const config = readTemplate(path.join(templates, '.gitlab-ci-config.yml'));

  const commands =
    sfdxHardisBranch === '-'
      ? [`# E2E ONLY: sfdx-hardis of the image ${image}`, 'sf plugins']
      : [`# E2E ONLY: sfdx-hardis built from its branch ${sfdxHardisBranch}`, ...linkCommands(sfdxHardisBranch, '$CI_PROJECT_DIR')];
  const beforeScript = ['  before_script:', ...commands.map((l) => (l.startsWith('#') ? `    ${l}` : `    - ${yamlScalar(l)}`))];

  for (const job of sfdxHardisJobs) {
    const start = main.findIndex((l) => l === `${job}:`);
    if (start < 0) {
      fail(`.gitlab-ci.yml: no job ${job}`);
    }
    let end = main.findIndex((l, i) => i > start && /^\S/.test(l));
    if (end < 0) {
      end = main.length;
    }
    const body = main.slice(start, end);
    if (body.some((l) => /^ {2}before_script:/.test(l))) {
      fail(`.gitlab-ci.yml: job ${job} already has a before_script, the link step would replace it`);
    }
    const tagsIndex = body.findIndex((l) => /^ {2}tags:\s*$/.test(l));
    const tags = [];
    for (let i = tagsIndex + 1; tagsIndex >= 0 && i < body.length && /^ {4}(#|- )/.test(body[i]); i++) {
      const m = body[i].match(/^ {4}- (\S+)/);
      if (m) {
        tags.push(m[1]);
      }
    }
    if (!tags.includes(runnerTag)) {
      fail(`.gitlab-ci.yml: job ${job} has tags [${tags.join(', ')}], the runners need ${runnerTag} (GITLAB_RUNNER_TAG)`);
    }
    // right after the stage line: the job keeps every key of the template
    const stageIndex = body.findIndex((l) => /^ {2}stage:/.test(l));
    main.splice(start + (stageIndex < 0 ? 1 : stageIndex + 1), 0, ...beforeScript);
  }
  if (image) {
    const imageIndex = main.findIndex((l) => /^image: /.test(l));
    if (imageIndex < 0) {
      fail('.gitlab-ci.yml: no top-level image line');
    }
    main[imageIndex] = `image: ${image}`;
  }

  const e2eVariables = {
    DEPLOY_BRANCHES: '/^(integration|uat|preprod|main)$/ # E2E ONLY: the four major branches of the test',
    USE_SCRATCH_ORGS: '"false" # E2E ONLY: no Dev Hub in this test',
  };
  for (const [name, value] of Object.entries(e2eVariables)) {
    const index = config.findIndex((l) => new RegExp(`^ {2}${name}:`).test(l));
    if (index < 0) {
      fail(`.gitlab-ci-config.yml: no variable ${name}`);
    }
    config[index] = `  ${name}: ${value}`;
  }

  const mainFile = path.join(repositoryRoot, '.gitlab-ci.yml');
  const configFile = path.join(repositoryRoot, '.gitlab-ci-config.yml');
  fs.writeFileSync(mainFile, main.join('\n'));
  fs.writeFileSync(configFile, config.join('\n'));
  console.log(`written ${mainFile} and .gitlab-ci-config.yml`);
  if (bundle) {
    writeGitLabBundle(main, config, bundle);
  }
  return [
    {
      file: mainFile,
      check: (doc, text) => {
        checkText('.gitlab-ci.yml', text, sfdxHardisBranch, []);
        for (const job of sfdxHardisJobs) {
          if (!doc[job] || !Array.isArray(doc[job].before_script)) {
            throw new Error(`.gitlab-ci.yml: job ${job} has no before_script after parsing`);
          }
        }
      },
    },
    { file: configFile, check: () => {} },
  ];
}

// One document for the CI lint API: the include removed, the variables of the config file added to
// the variables block of the main file (the only key the config file holds)
function writeGitLabBundle(main, config, file) {
  const lines = [...main];
  const includeIndex = lines.findIndex((l) => /^include:\s*$/.test(l));
  if (includeIndex >= 0) {
    let end = includeIndex + 1;
    while (end < lines.length && /^ {2}/.test(lines[end])) {
      end++;
    }
    lines.splice(includeIndex, end - includeIndex);
  }
  const configVariables = config.filter((l) => /^ {2}\S/.test(l));
  if (config.some((l) => /^\S/.test(l) && !/^(#|variables:)/.test(l))) {
    fail('.gitlab-ci-config.yml holds more than variables: the bundle would drop it');
  }
  const variablesIndex = lines.findIndex((l) => /^variables:\s*$/.test(l));
  if (variablesIndex < 0) {
    fail('.gitlab-ci.yml: no top-level variables block');
  }
  lines.splice(variablesIndex + 1, 0, ...configVariables);
  fs.writeFileSync(file, lines.join('\n'));
  console.log(`written ${file} (lint bundle)`);
}

// ------------------------------------------------------------------ Azure Pipelines
function writeAzure(sfdxHardisRoot, repositoryRoot, sfdxHardisBranch) {
  const patToken = (process.env.AZURE_E2E_CI_TOKEN || 'system') === 'pat';
  const linkStep = [
    sfdxHardisBranch === '-'
      ? `      # E2E ONLY: sfdx-hardis of the image ${image}`
      : `      # E2E ONLY: sfdx-hardis built from its branch ${sfdxHardisBranch}`,
    '      - script: |',
    ...(sfdxHardisBranch === '-' ? ['sf plugins'] : ['set -e', ...linkCommands(sfdxHardisBranch, '', { linkPrefix: AZURE_LINK_PREFIX })]).map((l) => `          ${l}`),
    `        displayName: "E2E ONLY - sfdx-hardis ${sfdxHardisBranch === '-' ? 'version' : `from ${sfdxHardisBranch}`}"`,
  ];
  const authLines = MAJOR_BRANCHES.map((b) => `          SFDX_AUTH_URL_${b}: $(SFDX_AUTH_URL_${b})`);
  const triggers = {
    'azure-pipelines-checks.yml': [
      '',
      '# E2E ONLY: no CI run on a push, the build validation policy of each major branch runs this',
      '# pipeline on its Pull Requests (what the setup comment above asks to configure by hand)',
      'trigger: none',
    ],
    'azure-pipelines-deployment.yml': [
      '',
      '# E2E ONLY: the CI trigger the setup comment above asks to set by hand, on the four major branches',
      'trigger:',
      '  branches:',
      '    include:',
      ...MAJOR_BRANCHES.map((b) => `      - ${b.toLowerCase()}`),
      'pr: none',
    ],
  };

  const files = [];
  for (const name of Object.keys(triggers)) {
    const lines = readTemplate(path.join(sfdxHardisRoot, 'defaults', 'ci', name));
    if (name === 'azure-pipelines-checks.yml') {
      removeAzureMegaLinterJob(lines, name);
    }
    if (image) {
      const containerIndex = lines.findIndex((l) => /^ {4}container: /.test(l));
      if (containerIndex < 0) {
        fail(`${name}: no container line`);
      }
      lines[containerIndex] = `    container: ${image}`;
    }
    if (patToken) {
      const tokenIndex = lines.findIndex((l) => /^ {10}CI_SFDX_HARDIS_AZURE_TOKEN: \$\(System\.AccessToken\)/.test(l));
      if (tokenIndex < 0) {
        fail(`${name}: no CI_SFDX_HARDIS_AZURE_TOKEN line to map to the PAT`);
      }
      lines[tokenIndex] = '          CI_SFDX_HARDIS_AZURE_TOKEN: $(CI_SFDX_HARDIS_AZURE_TOKEN) # E2E ONLY: AZURE_E2E_CI_TOKEN=pat';
    }
    const loginIndex = lines.findIndex((l) => /^ {6}# Login & /.test(l));
    if (loginIndex < 0) {
      fail(`${name}: no "# Login & ..." step`);
    }
    const envIndex = lines.findIndex((l, i) => i > loginIndex && /^ {8}env:\s*$/.test(l));
    if (envIndex < 0) {
      fail(`${name}: no env block in the sfdx-hardis step`);
    }
    lines.splice(envIndex + 1, 0, ...authLines);
    lines.splice(loginIndex, 0, ...linkStep);
    const nameIndex = lines.findIndex((l) => /^name: /.test(l));
    if (nameIndex < 0) {
      fail(`${name}: no top-level name line`);
    }
    lines.splice(nameIndex + 1, 0, ...triggers[name]);
    const file = path.join(repositoryRoot, name);
    fs.writeFileSync(file, lines.join('\n'));
    console.log(`written ${file}`);
    files.push({
      file,
      check: (doc, text) => {
        checkText(name, text, sfdxHardisBranch, ['SFDX_AUTH_URL_MAIN: $(SFDX_AUTH_URL_MAIN)']);
        if (!Array.isArray(doc.jobs) || doc.jobs.length !== 1) {
          throw new Error(`${name}: expected one job, found ${Array.isArray(doc.jobs) ? doc.jobs.length : 'none'}`);
        }
        const job = doc.jobs[0];
        const sfdxStep = (job.steps || []).find((s) => typeof s.script === 'string' && s.script.includes('sf hardis:auth:login'));
        if (!sfdxStep || !sfdxStep.env || !sfdxStep.env.SFDX_AUTH_URL_INTEGRATION) {
          throw new Error(`${name}: the sfdx-hardis step does not map SFDX_AUTH_URL_INTEGRATION`);
        }
        const linkIndex = job.steps.findIndex((s) => typeof s.displayName === 'string' && s.displayName.startsWith('E2E ONLY'));
        if (linkIndex < 0 || linkIndex > job.steps.indexOf(sfdxStep)) {
          throw new Error(`${name}: the E2E ONLY step is missing or after the sfdx-hardis step`);
        }
        if (name === 'azure-pipelines-checks.yml' && doc.trigger !== 'none') {
          throw new Error(`${name}: trigger is not none`);
        }
        if (name === 'azure-pipelines-deployment.yml' && (!doc.trigger || !doc.trigger.branches || doc.trigger.branches.include.length !== 4)) {
          throw new Error(`${name}: the CI trigger does not name the four major branches`);
        }
      },
    });
  }
  return files;
}

// The MegaLinter job of the checks template, with the comment lines just above it
function removeAzureMegaLinterJob(lines, name) {
  const jobIndex = lines.findIndex((l) => /^ {2}- job: MegaLinter\s*$/.test(l));
  if (jobIndex < 0) {
    fail(`${name}: no MegaLinter job to leave out`);
  }
  let start = jobIndex;
  while (start > 0 && /^ {2}#/.test(lines[start - 1])) {
    start--;
  }
  let end = lines.findIndex((l, i) => i > jobIndex && /^( {2}- job:|\S)/.test(l));
  if (end < 0) {
    end = lines.length;
  }
  const removed = ['  # E2E ONLY: the MegaLinter job of the template is left out (one free parallel job, 1800 minutes a month)'];
  lines.splice(start, end - start, ...(end === lines.length ? [...removed, ''] : removed));
}

// ------------------------------------------------------------------ Bitbucket Pipelines
function writeBitbucket(sfdxHardisRoot, repositoryRoot, sfdxHardisBranch) {
  const name = 'bitbucket-pipelines.yml';
  const lines = readTemplate(path.join(sfdxHardisRoot, 'defaults', 'ci', name));
  if (image) {
    const imageIndex = lines.findIndex((l) => /^image: /.test(l));
    if (imageIndex < 0) {
      fail(`${name}: no top-level image line`);
    }
    lines[imageIndex] = `image: ${image}`;
  }

  // The MegaLinter step and the parallel block around it: the simulate step stays alone, one
  // sequence item deeper, which is still a valid sequence under the "**" key
  const parallelIndex = lines.findIndex((l) => /^ {6}- parallel:\s*$/.test(l));
  const megaIndex = lines.findIndex((l) => /^ {10}# Run MegaLinter\s*$/.test(l));
  const simulateIndex = lines.findIndex((l) => /^ {10}# Simulate deployment\s*$/.test(l));
  if (parallelIndex < 0 || megaIndex < 0 || simulateIndex < megaIndex) {
    fail(`${name}: the parallel MegaLinter step of the template has changed, update writeBitbucket`);
  }
  lines.splice(megaIndex, simulateIndex - megaIndex);
  lines[parallelIndex] = '      # E2E ONLY: the MegaLinter step of the template is left out (build minutes)';

  if (sfdxHardisBranch !== '-') {
    const definitionsIndex = lines.findIndex((l) => /^definitions:\s*$/.test(l));
    if (definitionsIndex < 0) {
      fail(`${name}: no definitions block`);
    }
    lines.splice(definitionsIndex + 1, 0, '  # E2E ONLY: the clone and build of sfdx-hardis, reused by the next steps', '  caches:', '    sfdxhardislink: /tmp/sfdx-hardis');
  }
  const commands =
    sfdxHardisBranch === '-'
      ? ['sf plugins']
      : linkCommands(sfdxHardisBranch, '$BITBUCKET_CLONE_DIR', { cached: true, tscPrefix: 'NODE_OPTIONS=--max-old-space-size=3072 ' });
  let steps = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)- sf hardis:auth:login\s*$/);
    if (!m) {
      continue;
    }
    const indent = m[1];
    const insert = [
      `${indent}# E2E ONLY: ${sfdxHardisBranch === '-' ? `sfdx-hardis of the image ${image}` : `sfdx-hardis built from its branch ${sfdxHardisBranch}`}`,
      ...commands.map((c) => `${indent}- ${yamlScalar(c)}`),
    ];
    lines.splice(i, 0, ...insert);
    i += insert.length;
    steps++;
    if (sfdxHardisBranch !== '-') {
      // the step that holds this script: add the cache after its name line
      let s = i;
      while (s > 0 && !/^\s*- step:\s*$/.test(lines[s])) {
        s--;
      }
      const stepIndent = lines[s].match(/^(\s*)/)[1] + '    ';
      const nameIndex = lines.findIndex((l, k) => k > s && l.startsWith(`${stepIndent}name:`));
      if (nameIndex < 0 || nameIndex > i) {
        fail(`${name}: no name line in the step of line ${i}`);
      }
      lines.splice(nameIndex + 1, 0, `${stepIndent}caches:`, `${stepIndent}  - sfdxhardislink`);
      i += 2;
    }
  }
  if (steps !== 2) {
    fail(`${name}: expected 2 steps running sf hardis:auth:login, found ${steps}`);
  }
  const file = path.join(repositoryRoot, name);
  fs.writeFileSync(file, lines.join('\n'));
  console.log(`written ${file}`);
  return [
    {
      file,
      check: (doc, text) => {
        checkText(name, text, sfdxHardisBranch, []);
        const pr = doc.pipelines && doc.pipelines['pull-requests'] && doc.pipelines['pull-requests']['**'];
        if (!Array.isArray(pr) || pr.length !== 1 || !pr[0].step) {
          throw new Error(`${name}: the pull request pipeline is not one single step`);
        }
        const branchKey = Object.keys((doc.pipelines && doc.pipelines.branches) || {}).find((k) =>
          MAJOR_BRANCHES.every((b) => k.includes(b.toLowerCase())),
        );
        if (!branchKey) {
          throw new Error(`${name}: no branches pipeline naming the four major branches`);
        }
        for (const step of [pr[0].step, doc.pipelines.branches[branchKey][0].step]) {
          const script = step.script.map((c) => (typeof c === 'string' ? c : '')).join('\n');
          if (sfdxHardisBranch !== '-' && (!script.includes(LINK_MARKER) || !(step.caches || []).includes('sfdxhardislink'))) {
            throw new Error(`${name}: step "${step.name}" has no link command or no cache`);
          }
        }
      },
    },
  ];
}

// ------------------------------------------------------------------ shared helpers

// The shell lines of the link step, shared by every provider. They end back in the checkout of the
// project: on GitLab and Bitbucket the link commands and the script share one shell.
// options.cached: /tmp/sfdx-hardis may come back from a cache, fetch the branch into it then.
// options.tscPrefix: an environment prefix for tsc (a heap limit on small runners)
// options.linkPrefix: a prefix for the link command (sudo where the steps do not run as root)
function linkCommands(sfdxHardisBranch, backTo, options = {}) {
  const clone = `git clone --depth 1 -b ${sfdxHardisBranch} ${SFDX_HARDIS_REPO} /tmp/sfdx-hardis`;
  return [
    options.cached
      ? `if [ -d /tmp/sfdx-hardis/.git ]; then git -C /tmp/sfdx-hardis fetch -q --depth 1 origin ${sfdxHardisBranch} && git -C /tmp/sfdx-hardis reset -q --hard FETCH_HEAD; else ${clone}; fi`
      : clone,
    'cd /tmp/sfdx-hardis',
    'npx --yes yarn@1.22.22 install --frozen-lockfile --ignore-scripts --network-timeout 600000',
    `${options.tscPrefix || ''}npx tsc -p . --pretty`,
    `${options.linkPrefix || ''}${LINK_MARKER}`,
    'git log --oneline -1',
    ...(backTo ? [`cd "${backTo}"`] : []),
    'sf plugins',
  ];
}

function readTemplate(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
}

// The text of a written file holds the link step (or the version step) and the expected lines
function checkText(name, text, sfdxHardisBranch, mustHold) {
  if (sfdxHardisBranch !== '-' && !text.includes(LINK_MARKER)) {
    throw new Error(`${name}: no "${LINK_MARKER}"`);
  }
  if (!text.includes('sf plugins')) {
    throw new Error(`${name}: no "sf plugins" step`);
  }
  for (const line of mustHold) {
    if (!text.includes(line)) {
      throw new Error(`${name}: no "${line}"`);
    }
  }
}

// Parse every written file back, run its check, and validate Bitbucket against its public schema
async function checkWrittenFiles(files, withBitbucketSchema) {
  const yaml = requireFromSfdxHardis('js-yaml');
  for (const { file, check } of files) {
    const text = fs.readFileSync(file, 'utf8');
    const doc = yaml.load(text);
    check(doc, text);
    if (withBitbucketSchema) {
      await validateBitbucketSchema(file, doc);
    }
    console.log(`checked ${file}: valid YAML, link step and logins in place`);
  }
}

async function validateBitbucketSchema(file, doc) {
  let schema;
  try {
    const answer = await fetch(BITBUCKET_SCHEMA_URL, { signal: AbortSignal.timeout(20000) });
    if (!answer.ok) {
      throw new Error(`HTTP ${answer.status}`);
    }
    schema = await answer.json();
  } catch (e) {
    console.warn(`WARN ${file}: the schema ${BITBUCKET_SCHEMA_URL} could not be read (${e.message}): checked as YAML only`);
    return;
  }
  let Ajv;
  try {
    Ajv = requireFromSfdxHardis('ajv');
  } catch {
    console.warn(`WARN ${file}: ajv is not in the node_modules of sfdx-hardis: checked as YAML only`);
    return;
  }
  const ajv = new Ajv({ allErrors: true, schemaId: 'auto', unknownFormats: 'ignore', validateSchema: false });
  const validate = ajv.compile(schema);
  if (!validate(doc)) {
    throw new Error(`${file} does not match ${BITBUCKET_SCHEMA_URL}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
  }
  console.log(`checked ${file} against ${BITBUCKET_SCHEMA_URL}`);
}

function requireFromSfdxHardis(name) {
  return require(require.resolve(name, { paths: [root, env.root, __dirname] }));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// A YAML plain scalar when safe, double quoted otherwise
function yamlScalar(value) {
  return /^[A-Za-z][^:#"'{}[\]&*!|>%@`]*$/.test(value) ? value : JSON.stringify(value);
}
