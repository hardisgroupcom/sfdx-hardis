import c from 'chalk';
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { execSfdxJson, getCurrentGitBranch, git, uxLog } from '../../../../common/utils/index.js';
import {
  getExhaustedSnapshotLimit,
  getScratchSnapshotBranchConfig,
  getSnapshotDescription,
  getSnapshotName,
  getSnapshotRecord,
  getSnapshotScope,
  parsePositiveSetting,
  pruneScratchSnapshots,
  SCRATCH_SNAPSHOT_DISABLED_ENV,
  waitSnapshotActive,
} from '../../../../common/utils/scratchSnapshotUtils.js';
import { t } from '../../../../common/utils/i18n.js';
import { getEnvVar } from '../../../../config/index.js';
import ScratchCreate from '../create.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ScratchSnapshotRefresh extends SfCommand<any> {
  public static title = 'Refresh the scratch org snapshot of a branch';

  public static description = `## Command Behavior

**Takes a Dev Hub org snapshot of a scratch org that holds the current commit of a major branch, so that Pull Request scratch orgs are created from it.**

Run it in CI on every push to a major branch. It does nothing unless the branch config sets \`useScratchOrgSnapshot: true\`, so the same job can run on every major branch.

Key functionalities:

- **Snapshot of the branch head:** Creates an empty scratch org with [hardis:scratch:create](https://sfdx-hardis.cloudity.com/hardis/scratch/create/) (full deployment and the org initialization steps run when filling the pool), takes a snapshot of it, waits until the snapshot is Active, then deletes the scratch org.
- **One snapshot per branch and commit:** The snapshot name is \`SH\`, the first 7 characters of the commit sha and 6 characters of a hash of the project name (\`projectName\`) and the branch name, and its description holds the project, the branch and the full sha, so projects that share a Dev Hub never use or delete each other's snapshots. Running it again on the same commit does nothing.
- **Pruning:** Keeps the newest \`scratchOrgSnapshotKeep\` Active snapshots of the branch (default 2) and deletes the older ones. Keeping more lets Pull Requests whose branch is behind the target branch use a snapshot too, but every snapshot counts in the active snapshots allocation of the Dev Hub.
- **Daily limit:** The \`DailyOrgSnapshots\` and \`ActiveOrgSnapshots\` limits of the Dev Hub are read before the source org is created. When every active snapshot slot is taken and \`scratchOrgSnapshotKeep\` is 2 or more, the oldest snapshots of the branch are deleted first, down to \`scratchOrgSnapshotKeep\` minus one, to make room for the new one; the newest one always stays. When a limit still has nothing left, or the Dev Hub still refuses the snapshot because of a limit, it logs a warning and ends without error: Pull Requests keep using the previous snapshot, with a larger delta.

The Pull Request side is in [hardis:scratch:create](https://sfdx-hardis.cloudity.com/hardis/scratch/create/): in CI, it creates the scratch org from the newest Active snapshot of the target branch whose commit is in the history of the Pull Request, and deploys only what changed since that commit.

Requirements: Scratch Org Snapshots enabled on the Dev Hub, and the full git history in the Pull Request jobs.

<details markdown="1">
<summary>Technical explanations</summary>

- The scratch org of the snapshot is created with the environment variable \`${SCRATCH_SNAPSHOT_DISABLED_ENV}=true\`, so it never comes from a previous snapshot: every snapshot is a deployment from empty.
- \`sf org create snapshot\` has no wait option: the command polls \`OrgSnapshot.Status\` every 30 seconds until \`Active\` or \`Error\`, for at most \`SCRATCH_ORG_SNAPSHOT_WAIT\` minutes (default 60).
- A previous snapshot with the same name that is not Active (a failed run) is deleted first, so the name can be used again.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:scratch:snapshot:refresh --agent
\`\`\`

The command has no prompt.

`;

  public static examples = ['$ sf hardis:scratch:snapshot:refresh', '$ sf hardis:scratch:snapshot:refresh --agent'];

  /* jscpd:ignore-start */
  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-dev-hub': requiredHubFlagWithDeprecations,
  };
  /* jscpd:ignore-end */

  public static requiresProject = true;

  private debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ScratchSnapshotRefresh);
    this.debugMode = flags.debug || false;
    const devHubConn = flags['target-dev-hub'].getConnection();
    const devHubUsername = flags['target-dev-hub'].getUsername();
    const branch = (await getCurrentGitBranch()) || '';
    const { enabled, keep } = await getScratchSnapshotBranchConfig(branch);
    if (!enabled) {
      uxLog("log", this, c.grey(t('scratchSnapshotNotEnabled', { branch })));
      return { outputString: `Snapshots are not enabled for branch ${branch}` };
    }
    const sha = (await git().revparse(['HEAD'])).trim();
    const scope = await getSnapshotScope(branch);
    const name = getSnapshotName(scope, sha);
    const timeoutMinutes = parsePositiveSetting(getEnvVar('SCRATCH_ORG_SNAPSHOT_WAIT'), 60);

    const existing = await getSnapshotRecord(devHubConn, name);
    if (existing?.Status === 'Active') {
      uxLog("action", this, c.cyan(t('scratchSnapshotUpToDate', { name: c.green(name), branch })));
    } else if (existing && ['New', 'InProgress'].includes(existing.Status)) {
      // Another job is taking the snapshot of the same commit
      await waitSnapshotActive(devHubConn, name, timeoutMinutes, this);
    } else {
      if (existing) {
        await execSfdxJson(`sf org delete snapshot --snapshot ${name} --target-dev-hub ${devHubUsername} --no-prompt`, this, {
          fail: true,
          output: true,
          debug: this.debugMode,
        });
      }
      // A full source org takes a daily scratch org and the whole deployment: check the snapshot limits first
      let exhaustedLimit = getExhaustedSnapshotLimit(await this.readDevHubLimits(devHubConn));
      // The prune runs once the new snapshot is Active, so a full active allocation would never free itself.
      // The newest snapshot always stays, as the new one can still fail
      if (exhaustedLimit?.startsWith('ActiveOrgSnapshots') && keep > 1) {
        uxLog("action", this, c.cyan(t('scratchSnapshotMakingRoom', { branch })));
        if ((await pruneScratchSnapshots(devHubConn, devHubUsername, scope, keep - 1, this)).length > 0) {
          exhaustedLimit = null;
        }
      }
      if (exhaustedLimit) {
        uxLog("warning", this, c.yellow(t('scratchSnapshotLimitReached', { message: exhaustedLimit })));
        return { outputString: `Snapshot of branch ${branch} not taken: limit reached` };
      }
      const created = await this.createSnapshot(devHubConn, devHubUsername, branch, scope, sha, name, timeoutMinutes);
      if (!created) {
        return { outputString: `Snapshot of branch ${branch} not taken: limit reached` };
      }
    }

    const deleted = await pruneScratchSnapshots(devHubConn, devHubUsername, scope, keep, this);
    return { outputString: `Snapshot ${name} of branch ${branch} is Active`, snapshotName: name, sha, deleted };
  }

  // Null when the limits cannot be read: the refresh goes on, and a LIMIT_EXCEEDED from the snapshot call still stops it
  protected async readDevHubLimits(devHubConn: any): Promise<any> {
    try {
      return await devHubConn.limits();
    } catch (e) {
      uxLog("warning", this, c.yellow(t('scratchSnapshotLimitsUnread', { message: (e as Error).message })));
      return null;
    }
  }

  // Returns false when the Dev Hub refused the snapshot because of a limit
  protected async createSnapshot(devHubConn: any, devHubUsername: string, branch: string, scope: string, sha: string, name: string, timeoutMinutes: number): Promise<boolean> {
    process.env[SCRATCH_SNAPSHOT_DISABLED_ENV] = 'true';
    let createResult: any;
    try {
      // The refresh has no prompt, outside CI too: a missing userEmail fails instead of asking
      createResult = await ScratchCreate.run(['--forcenew', '--agent', '--target-dev-hub', devHubUsername, ...(this.debugMode ? ['--debug'] : [])]);
    } finally {
      delete process.env[SCRATCH_SNAPSHOT_DISABLED_ENV];
    }
    const sourceOrg = createResult?.scratchOrgUsername;
    if (!sourceOrg) {
      throw new SfError(t('scratchSnapshotSourceOrgFailed'));
    }
    try {
      uxLog("action", this, c.cyan(t('scratchSnapshotTaking', { name: c.green(name), branch, sha: sha.slice(0, 8) })));
      const snapshotResult = await execSfdxJson(
        `sf org create snapshot --source-org ${sourceOrg} --name ${name} --description "${getSnapshotDescription(scope, sha)}" --target-dev-hub ${devHubUsername}`,
        this,
        { fail: false, output: true, debug: this.debugMode }
      );
      if (snapshotResult?.status !== 0) {
        const message = String(snapshotResult?.message || snapshotResult?.errorMessage || '');
        // LIMIT_EXCEEDED is the Salesforce error code of org limits; a broader match would hide real failures
        if (/LIMIT_EXCEEDED/.test(message)) {
          uxLog("warning", this, c.yellow(t('scratchSnapshotLimitReached', { message })));
          return false;
        }
        throw new SfError(t('scratchSnapshotFailed', { name, error: message }));
      }
      await waitSnapshotActive(devHubConn, name, timeoutMinutes, this);
      uxLog("success", this, c.green(t('scratchSnapshotActive', { name, branch })));
      return true;
    } finally {
      await execSfdxJson(`sf org delete scratch --no-prompt --target-org ${sourceOrg}`, this, { fail: false, output: true, debug: this.debugMode });
    }
  }
}
