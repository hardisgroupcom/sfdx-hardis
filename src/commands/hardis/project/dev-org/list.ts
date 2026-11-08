/* jscpd:ignore-start */
import c from 'chalk';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { CONSTANTS } from '../../../../config/index.js';
import { uxLog } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { logDevOrgsSummary } from '../../../../common/utils/devOrgsCommandUtils.js';
import {
  DEV_ORGS_DOC_URL,
  DevOrgsRegistry,
  getCurrentGitUser,
  getDevOrgsStaleDays,
  isDevOrgsRegistryEnabled,
} from '../../../../common/utils/devOrgsRegistry.js';
import { buildDevOrgsSummary, analyzeDevOrgComments } from '../../../../common/utils/devOrgsRules.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DevOrgList extends SfCommand<any> {
  public static title = 'List the development orgs';

  public static description = `
## Command Behavior

**Lists the developer sandboxes and scratch orgs of the project, the major branch each of them targets, and how many Pull Requests were merged into that branch since the org last received a backpromote.**

The list lives in a "Development Orgs Dashboard" of the git provider: an issue on GitHub and GitLab, a work item on Azure DevOps, a dedicated Pull Request on Bitbucket. sfdx-hardis fills it on its own: [hardis:work:new](${CONSTANTS.DOC_URL_ROOT}/hardis/work/new/), [hardis:work:save](${CONSTANTS.DOC_URL_ROOT}/hardis/work/save/), [hardis:work:backpromote](${CONSTANTS.DOC_URL_ROOT}/hardis/work/backpromote/) and [hardis:org:create](${CONSTANTS.DOC_URL_ROOT}/hardis/org/create/) register the org they work with, and a release manager registers or edits one with [hardis:project:dev-org:register](${CONSTANTS.DOC_URL_ROOT}/hardis/project/dev-org/register/).

For each org, the command shows:

- the target branch, the owner and the users;
- the Pull Requests merged into the target branch since the last backpromote of the org from that branch, or since the org was registered. A Pull Request that only moves others (a major branch merged into the next one, a promotion) counts as one, with the Pull Requests it carries;
- the last backpromote and the last activity. An org with no activity for \`devOrgsStaleDays\` days (30 by default) is marked stale. Removing it stays a decision of the release manager.

The merged Pull Requests are listed again by the deployment job of a major branch after each merge. \`--refresh\` lists them again now, from the git provider.

Read more in the [Development orgs](${DEV_ORGS_DOC_URL}) documentation.

<details markdown="1">
<summary>Technical explanations</summary>

- The dashboard holds one comment per org and one per target branch (the merged Pull Requests). The data of a comment is a base64url token, so no markup of the provider can alter it. The body of the dashboard is rebuilt from the comments at every write: never edit it by hand.
- The newest comment of an org is the one that counts, so a comment that its writer was not allowed to delete changes nothing. A removal is written as a comment too.
- A sandbox registered under a new org id with the name of a registered one is its refresh: it replaces the old entry, as a new sandbox. An expired scratch org leaves the list.
- \`isMine\` is true when the git user of the checkout (\`user.email\`) is the owner or one of the users.
- The merged Pull Requests are read with the provider listing filtered on the merge date, from the oldest start date of the orgs of the branch, at most 180 days back.
- With \`--json\`, \`devOrgs\` holds \`enabled\`, \`dashboardUrl\`, \`currentUser\`, \`staleDays\`, \`orgs\` (\`orgId\`, \`orgType\`, \`name\`, \`alias\`, \`instanceUrl\`, \`expirationDate\`, \`targetBranch\`, \`owner\`, \`users\`, \`featureBranches\`, \`registeredAt\`, \`lastActivityAt\`, \`lastBackpromote\`, \`isMine\`, \`stale\`, \`startDate\`, \`behind\`), \`branches\` and \`warnings\`. \`behind\` is null until the merged Pull Requests of the target branch are listed from the start date of the org. \`errorKind\` is \`noGitProvider\` when no git provider token is available.
- The registry is on by default. \`enableDevOrgsRegistry: false\` turns it off.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:dev-org:list --agent
\`\`\`

The command asks nothing in any mode: \`--agent\` only states it. Use \`--refresh\` to list the merged Pull Requests again, \`--target-branch\` and \`--mine\` to filter.
`;

  public static examples = [
    '$ sf hardis:project:dev-org:list',
    '$ sf hardis:project:dev-org:list --mine',
    '$ sf hardis:project:dev-org:list --refresh --target-branch integration',
    '$ sf hardis:project:dev-org:list --agent',
  ];

  public static flags: any = {
    refresh: Flags.boolean({
      default: false,
      description: 'List again the Pull Requests merged into the target branches, from the git provider, and update the dashboard',
    }),
    'target-branch': Flags.string({
      description: 'Only the orgs that target this branch',
    }),
    mine: Flags.boolean({
      default: false,
      description: 'Only the orgs whose owner or users include the git user of the checkout',
    }),
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
  };

  public static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DevOrgList);
    const currentUser = await getCurrentGitUser();
    const staleDays = await getDevOrgsStaleDays();
    if (!(await isDevOrgsRegistryEnabled())) {
      uxLog("warning", this, c.yellow(t('devOrgsRegistryDisabled')));
      const devOrgs = buildDevOrgsSummary(analyzeDevOrgComments([]), { enabled: false, dashboardUrl: null, currentUser, staleDays });
      return { status: 0, outputString: 'The dev orgs registry is disabled', devOrgs: devOrgs as any };
    }
    const registry = await DevOrgsRegistry.open();
    if (!registry) {
      uxLog("warning", this, c.yellow(t('devOrgsNoGitProvider', { docUrl: DEV_ORGS_DOC_URL })));
      return { status: 1, outputString: 'No git provider token', errorKind: 'noGitProvider' };
    }
    let warnings: string[] = [];
    if (flags.refresh) {
      uxLog("action", this, c.cyan(t('devOrgsRefreshingAll')));
      warnings = await registry.refreshBranches({ jobUrl: null, fullCleanup: true, commandThis: this });
      for (const warning of warnings) {
        uxLog("warning", this, c.yellow(warning));
      }
    }
    const devOrgs = await registry.summary({ currentUser, staleDays, warnings });
    const orgs = devOrgs.orgs.filter(
      (org) => (!flags['target-branch'] || org.targetBranch === flags['target-branch']) && (!flags.mine || org.isMine)
    );
    if (!devOrgs.dashboardUrl) {
      uxLog("action", this, c.cyan(t('devOrgsNoDashboard')));
    } else {
      uxLog("action", this, c.cyan(t('devOrgsListed', { count: orgs.length })));
    }
    await logDevOrgsSummary(this, devOrgs, orgs);
    return { status: 0, outputString: `${orgs.length} development orgs`, devOrgs: { ...devOrgs, orgs } as any };
  }
}
