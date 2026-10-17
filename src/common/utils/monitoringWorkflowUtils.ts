// The GitHub monitoring workflow runs from the default branch: GitHub only schedules, and only offers
// "Run workflow" for, the workflows of that branch. It lists the monitored branches in a matrix and
// passes each one's authentication secrets, in several jobs. These helpers add a monitored org to
// it, so that nobody has to copy the file to main and edit every MANUAL block by hand.

export const GITHUB_MONITORING_WORKFLOW_PATH = '.github/workflows/org-monitoring.yml';

// The example values the template ships with, removed as soon as a real org is added
const PLACEHOLDER = /MYCLIENT/i;

function authVariableNames(branchName: string): string[] {
  const suffix = branchName.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return [`SFDX_CLIENT_ID_${suffix}`, `SFDX_CLIENT_KEY_${suffix}`];
}

/**
 * Returns the workflow text with `branchName` in every matrix of monitored branches and its two
 * authentication secrets in every block of authentication variables. The template's example
 * branches and secrets are dropped, the orgs already listed are kept, and the text is returned
 * unchanged when the org is already there.
 */
export function addOrgToGithubMonitoringWorkflow(workflowText: string, branchName: string): string {
  const eol = workflowText.includes('\r\n') ? '\r\n' : '\n';
  const lines = workflowText.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Matrix of monitored branches: "branch:" followed by "- <branch>" items
    const matrix = line.match(/^(\s*)branch:\s*$/);
    if (matrix) {
      out.push(line);
      i++;
      const items: string[] = [];
      let itemIndent = `${matrix[1]}  `;
      while (i < lines.length && /^\s*-\s+\S/.test(lines[i])) {
        itemIndent = lines[i].match(/^(\s*)-/)![1];
        items.push(lines[i].replace(/^\s*-\s+/, '').trim());
        i++;
      }
      const kept = items.filter((item) => !PLACEHOLDER.test(item));
      if (!kept.includes(branchName)) {
        kept.push(branchName);
      }
      for (const item of kept) {
        out.push(`${itemIndent}- ${item}`);
      }
      continue;
    }
    // Block of authentication variables: consecutive SFDX_CLIENT_ID_ / SFDX_CLIENT_KEY_ lines
    if (/^\s*SFDX_CLIENT_(ID|KEY)_\w+:/.test(line)) {
      const indent = line.match(/^(\s*)/)![1];
      const names: string[] = [];
      while (i < lines.length && /^\s*SFDX_CLIENT_(ID|KEY)_\w+:/.test(lines[i])) {
        names.push(lines[i].trim().split(':')[0]);
        i++;
      }
      const kept = names.filter((name) => !PLACEHOLDER.test(name));
      for (const name of authVariableNames(branchName)) {
        if (!kept.includes(name)) {
          kept.push(name);
        }
      }
      for (const name of kept) {
        out.push(`${indent}${name}: \${{ secrets.${name} }}`);
      }
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join(eol);
}
