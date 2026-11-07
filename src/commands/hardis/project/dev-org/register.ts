/* jscpd:ignore-start */
import c from 'chalk';
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { CONSTANTS, getConfig } from '../../../../config/index.js';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { selectTargetBranch } from '../../../../common/utils/gitUtils.js';
import {
  parseDevOrgPersonFlag,
  parseDevOrgPersonList,
  promptDevOrgOwner,
  promptDevOrgUsers,
} from '../../../../common/utils/devOrgsCommandUtils.js';
import {
  DEV_ORGS_DOC_URL,
  DevOrgsRegistry,
  getCurrentGitUser,
  getDevOrgIdentity,
  isDevOrgsRegistryEnabled,
} from '../../../../common/utils/devOrgsRegistry.js';
import { DevOrgIdentity, findDevOrg } from '../../../../common/utils/devOrgsRules.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DevOrgRegister extends SfCommand<any> {
  public static title = 'Register a development org';

  public static description = `
## Command Behavior

**Registers a developer sandbox or a scratch org in the development orgs list of the project, or changes its target branch, owner and users.**

The list lives in a "Development Orgs Dashboard" of the git provider (an issue, an Azure DevOps work item, or a dedicated Pull Request on Bitbucket). It tells the owner of each org when Pull Requests were merged into its target branch since its last [backpromote](${CONSTANTS.DOC_URL_ROOT}/salesforce-devops-backpromote/). See [hardis:project:dev-org:list](${CONSTANTS.DOC_URL_ROOT}/hardis/project/dev-org/list/).

sfdx-hardis registers an org on its own when a developer starts a User Story in it ([hardis:work:new](${CONSTANTS.DOC_URL_ROOT}/hardis/work/new/)), saves it ([hardis:work:save](${CONSTANTS.DOC_URL_ROOT}/hardis/work/save/)), runs a backpromote, or creates a sandbox with [hardis:org:create](${CONSTANTS.DOC_URL_ROOT}/hardis/org/create/). This command is for the release manager who creates a sandbox and assigns it, or who fixes an entry:

- \`--target-org\` registers an org you are connected to (the default org when omitted);
- \`--org-id\` edits a registered org without connecting to it;
- \`--target-branch\` sets the only target branch of the org;
- \`--owner\` sets the owner, \`--users\` replaces the users, \`--add-user\` and \`--remove-user\` change them one at a time. A person is written \`Name <email>\`, or a bare email.

A production org, or the org of a major branch, is never registered. A sandbox registered under a new org id with the name of a registered one is a refreshed sandbox: it replaces the old entry, as a new sandbox.

Read more in the [Development orgs](${DEV_ORGS_DOC_URL}) documentation.

<details markdown="1">
<summary>Technical explanations</summary>

- The org is identified by its org id. Its name is the sandbox name read from its instance URL, or the alias of a scratch org.
- The new comment of the org is written before the old one is deleted: a delete that fails (a comment written by another account) loses nothing, the newest comment is the one that counts.
- The dashboard is created at the first registration. Its body is rebuilt from the comments at every write.
- Requires a git provider token (\`GITHUB_TOKEN\`, \`CI_SFDX_HARDIS_GITLAB_TOKEN\`, \`SYSTEM_ACCESSTOKEN\` or \`CI_SFDX_HARDIS_BITBUCKET_TOKEN\`).
- With \`--json\`, \`devOrg\` holds the registered entry, \`created\` says whether it is new and \`dashboardUrl\` links the dashboard.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:dev-org:register --agent --target-org my-dev-sandbox --target-branch integration --owner "Jane Doe <jane.doe@example.com>"
\`\`\`

In agent mode, nothing is asked: the target branch is \`--target-branch\`, else the registered one, else \`developmentBranch\`; the owner of a new entry is \`--owner\`, else the git user of the checkout; the users only change with \`--users\`, \`--add-user\` or \`--remove-user\`.
`;

  public static examples = [
    '$ sf hardis:project:dev-org:register',
    '$ sf hardis:project:dev-org:register --target-org my-dev-sandbox --target-branch integration --owner "Jane Doe <jane.doe@example.com>"',
    '$ sf hardis:project:dev-org:register --org-id 00D000000000001AAA --add-user "John Smith <john.smith@example.com>"',
    '$ sf hardis:project:dev-org:register --agent --target-org my-dev-sandbox --target-branch integration',
  ];

  public static flags: any = {
    'org-id': Flags.string({
      description: 'Org id of a registered org to edit, without connecting to it',
    }),
    'target-branch': Flags.string({
      description: 'The major branch the org targets',
    }),
    owner: Flags.string({
      description: 'Owner of the org: "Name <email>" or an email',
    }),
    users: Flags.string({
      description: 'Users of the org, comma-separated ("Name <email>" or emails). Replaces the current users',
    }),
    'add-user': Flags.string({
      description: 'Adds one user ("Name <email>" or an email)',
    }),
    'remove-user': Flags.string({
      description: 'Removes the user with this email',
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
    'target-org': optionalOrgFlagWithDeprecations,
  };

  public static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DevOrgRegister);
    const interactive = flags.agent !== true && !isCI;
    if (!(await isDevOrgsRegistryEnabled())) {
      throw new SfError(t('devOrgsRegistryDisabled'));
    }
    const registry = await DevOrgsRegistry.open();
    if (!registry) {
      throw new SfError(t('devOrgsNoGitProvider', { docUrl: DEV_ORGS_DOC_URL }));
    }
    const loaded = await registry.load(false);
    let identity: DevOrgIdentity;
    if (flags['org-id']) {
      const registered = loaded ? findDevOrg(loaded.state, flags['org-id']) : null;
      if (!registered) {
        throw new SfError(t('devOrgNotFound', { orgId: flags['org-id'] }));
      }
      const data = registered.data;
      identity = { orgId: data.orgId, orgType: data.orgType, sandboxName: data.sandboxName, alias: data.alias, instanceUrl: data.instanceUrl, expirationDate: data.expirationDate };
    } else {
      const username = flags['target-org']?.getUsername();
      if (!username) {
        throw new SfError(t('devOrgTargetOrgMissing'));
      }
      const found = await getDevOrgIdentity(username, null);
      if (!found) {
        throw new SfError(t('devOrgRegistrationRefused', { name: username }));
      }
      identity = found;
    }
    const existing = loaded ? findDevOrg(loaded.state, identity.orgId)?.data || null : null;
    const currentUser = await getCurrentGitUser();

    // Target branch: the flag, else a question, else what is registered, else the development branch
    let targetBranch: string | null = flags['target-branch'] || null;
    if (!targetBranch && interactive) {
      targetBranch = await selectTargetBranch({ message: t('devOrgTargetBranchPrompt', { name: identity.sandboxName }) });
    }
    if (!targetBranch && !existing) {
      targetBranch = (await getConfig('branch')).developmentBranch || null;
    }
    let owner = flags.owner !== undefined ? parseDevOrgPersonFlag(flags.owner) : undefined;
    let users = flags.users !== undefined ? parseDevOrgPersonList(flags.users) : null;
    if (interactive && flags.owner === undefined) {
      owner = await promptDevOrgOwner(existing?.owner || currentUser);
    }
    if (interactive && flags.users === undefined && !flags['add-user'] && !flags['remove-user']) {
      users = await promptDevOrgUsers(existing?.users || []);
    }
    uxLog("action", this, c.cyan(t('devOrgRegistering', { name: existing?.name || identity.sandboxName })));
    const result = await registry.register(
      {
        org: identity,
        targetBranch,
        setTargetBranch: targetBranch !== null,
        currentUser,
        addCurrentUser: false,
        owner,
        users,
        addUsers: flags['add-user'] ? [parseDevOrgPersonFlag(flags['add-user'])!] : [],
        removeUsers: flags['remove-user'] ? [flags['remove-user']] : [],
        // Registering an org you are connected to is using it; editing an entry is not
        touchActivity: !flags['org-id'],
      },
      { fullCleanup: true }
    );
    if (result.changed) {
      uxLog("success", this, c.green(t('devOrgRegistered', { name: result.data.name, branch: result.data.targetBranch })));
    } else {
      uxLog("log", this, c.grey(t('devOrgUnchanged', { name: result.data.name })));
    }
    if (registry.dashboardUrl()) {
      uxLog("log", this, c.grey(t('devOrgsDashboardUrl', { url: registry.dashboardUrl() })));
    }
    return { status: 0, outputString: `Registered ${result.data.name}`, devOrg: result.data as any, created: result.isNew, dashboardUrl: registry.dashboardUrl() };
  }
}
