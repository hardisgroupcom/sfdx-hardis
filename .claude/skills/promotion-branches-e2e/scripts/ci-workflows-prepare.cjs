#!/usr/bin/env node
/*
 * Writes the GitHub Actions workflows of a CI end to end repository (runbook section 6quinquies):
 * the check-deploy.yml and process-deploy.yml templates of sfdx-hardis, with two changes only:
 *
 *   - a step before the sfdx-hardis one that clones sfdx-hardis on the branch under test, builds it
 *     and links it with `sf plugins link`, so the jobs run the code of the branch, not the release
 *     of the Docker image;
 *   - SFDX_AUTH_URL_<BRANCH> secrets, so the four major branches log in to a throwaway org without
 *     the JWT connected app a real project uses.
 *
 *   node ci-workflows-prepare.cjs <sfdx-hardis root> <repository root> <sfdx-hardis branch>
 */
const fs = require('fs');
const path = require('path');

const [root, target, branch] = process.argv.slice(2);
if (!root || !target || !branch) {
  console.error('usage: ci-workflows-prepare.cjs <sfdx-hardis root> <repository root> <sfdx-hardis branch>');
  process.exit(2);
}
const branches = ['INTEGRATION', 'UAT', 'PREPROD', 'MAIN'];
const linkStep = [
  `      # E2E ONLY: sfdx-hardis built from its branch ${branch}`,
  `      - name: E2E ONLY - sfdx-hardis from ${branch}`,
  '        run: |',
  `          git clone --depth 1 -b ${branch} https://github.com/hardisgroupcom/sfdx-hardis.git /tmp/sfdx-hardis`,
  '          cd /tmp/sfdx-hardis',
  '          npx --yes yarn@1.22.22 install --frozen-lockfile --ignore-scripts --network-timeout 600000',
  '          npx tsc -p . --pretty',
  '          sf plugins link /tmp/sfdx-hardis',
  '          git log --oneline -1',
  '          sf plugins',
];
const authLines = branches.map((b) => `          SFDX_AUTH_URL_${b}: \${{ secrets.SFDX_AUTH_URL_${b} }}`);

const outDir = path.join(target, '.github', 'workflows');
fs.mkdirSync(outDir, { recursive: true });
for (const name of ['check-deploy.yml', 'process-deploy.yml']) {
  const lines = fs.readFileSync(path.join(root, 'defaults', 'ci', '.github', 'workflows', name), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const loginIndex = lines.findIndex((l) => /^ {6}- name: Login & /.test(l));
  if (loginIndex < 0) {
    console.error(`${name}: no "Login & ..." step`);
    process.exit(1);
  }
  const envIndex = lines.findIndex((l, i) => i > loginIndex && /^ {8}env:\s*$/.test(l));
  if (envIndex < 0) {
    console.error(`${name}: no env block in the sfdx-hardis step`);
    process.exit(1);
  }
  lines.splice(envIndex + 1, 0, ...authLines);
  lines.splice(loginIndex, 0, ...linkStep);
  fs.writeFileSync(path.join(outDir, name), lines.join('\n'));
  console.log(`written ${path.join(outDir, name)}`);
}
