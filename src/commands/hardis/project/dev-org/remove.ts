/* jscpd:ignore-start */
import c from 'chalk';
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { CONSTANTS } from '../../../../config/index.js';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { confirmDevOrgRemoval, selectRegisteredDevOrg } from '../../../../common/utils/devOrgsCommandUtils.js';
import {
  DEV_ORGS_DOC_URL,
  DevOrgsRegistry,
  getCurrentGitUser,
  getDevOrgIdentity,
  getDevOrgsStaleDays,
  isDevOrgsRegistryEnabled,
} from '../../../../common/utils/devOrgsRegistry.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DevOrgRemove extends SfCommand<any> {
  public static title = 'Remove a development org';

  public static description = `
## Command Behavior

**Removes a developer sandbox or a scratch org from the development orgs list of the project.**

The list lives in a "Development Orgs Dashboard" of the git provider: see [hardis:project:dev-org:list](${CONSTANTS.DOC_URL_ROOT}/hardis/project/dev-org/list/). Remove an org when it was deleted, or when nobody uses it anymore: sfdx-hardis only marks an org stale after \`devOrgsStaleDays\` days without activity, it never removes it on its own. An expired scratch org, or a refreshed sandbox (registered again under a new org id), leaves the list without this command.

- \`--org-id\` names the org to remove, without connecting to it;
- without it, the command lists the registered orgs and asks which one to remove, then asks for a confirmation. In agent mode and in CI, it removes the org of \`--target-org\` (the default org when omitted).

Read more in the [Development orgs](${DEV_ORGS_DOC_URL}) documentation.

<details markdown="1">
<summary>Technical explanations</summary>

- A removal is written as a comment of the dashboard, then the comments of the org are deleted when this account may delete them. The removal comment goes last, once nothing it hides is left: a comment written by another account stays hidden behind it.
- Nothing is done in the org itself.
- With \`--json\`, \`removed\` holds the entry that was removed.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:dev-org:remove --agent --org-id 00D000000000001AAA
\`\`\`

In agent mode, \`--org-id\` or \`--target-org\` is required, and no confirmation is asked.
`;

  public static examples = [
    '$ sf hardis:project:dev-org:remove',
    '$ sf hardis:project:dev-org:remove --org-id 00D000000000001AAA',
    '$ sf hardis:project:dev-org:remove --agent --org-id 00D000000000001AAA',
  ];

  public static flags: any = {
    'org-id': Flags.string({
      description: 'Org id of the registered org to remove',
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
    const { flags } = await this.parse(DevOrgRemove);
    const interactive = flags.agent !== true && !isCI;
    if (!(await isDevOrgsRegistryEnabled())) {
      throw new SfError(t('devOrgsRegistryDisabled'));
    }
    const registry = await DevOrgsRegistry.open();
    if (!registry) {
      throw new SfError(t('devOrgsNoGitProvider', { docUrl: DEV_ORGS_DOC_URL }));
    }
    const currentUser = await getCurrentGitUser();
    let orgId: string | null = flags['org-id'] || null;
    if (!orgId && !interactive) {
      const username = flags['target-org']?.getUsername();
      if (!username) {
        throw new SfError(t('devOrgRemoveTargetMissing'));
      }
      orgId = (await getDevOrgIdentity(username, null))?.orgId || null;
    }
    if (!orgId && interactive) {
      const summary = await registry.summary({ currentUser, staleDays: await getDevOrgsStaleDays() });
      const selected = await selectRegisteredDevOrg(summary.orgs);
      if (!selected) {
        uxLog("action", this, c.cyan(t('devOrgsNoneToRemove')));
        return { status: 0, outputString: 'No development org to remove', removed: null };
      }
      if (!(await confirmDevOrgRemoval(selected))) {
        uxLog("action", this, c.cyan(t('devOrgRemoveCancelled')));
        return { status: 0, outputString: 'Removal cancelled', removed: null };
      }
      orgId = selected.orgId;
    }
    if (!orgId) {
      throw new SfError(t('devOrgRemoveTargetMissing'));
    }
    uxLog("action", this, c.cyan(t('devOrgRemoving', { orgId })));
    const removed = await registry.remove(orgId, currentUser);
    if (!removed) {
      throw new SfError(t('devOrgNotFound', { orgId }));
    }
    uxLog("success", this, c.green(t('devOrgRemoved', { name: removed.name })));
    return { status: 0, outputString: `Removed ${removed.name}`, removed: removed as any, dashboardUrl: registry.dashboardUrl() };
  }
}
