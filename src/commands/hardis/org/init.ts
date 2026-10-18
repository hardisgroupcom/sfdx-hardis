import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../common/utils/index.js';
import {
  detectOrgInitOrgType,
  getOrgInitSteps,
  readProjectScratchDef,
  runOrgInitSteps,
  selectOrgInitSteps,
} from '../../../common/utils/orgInitUtils.js';
import { prompts } from '../../../common/utils/prompts.js';
import { t } from '../../../common/utils/i18n.js';
import { getConfig } from '../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgInit extends SfCommand<any> {
  public static title = 'Initialize a scratch org or a sandbox';

  public static description = `Runs the initialization steps of the project on an existing scratch org or sandbox.

## Command Behavior

**Brings an org to the state a new scratch org or sandbox gets when it is created: packages, project sources, permission sets, Apex scripts, data and custom commands, in the order the project defines.**

- **Same steps as creation:** the steps are the ones [hardis:scratch:create](${'https://sfdx-hardis.cloudity.com/hardis/scratch/create/'}) and [hardis:org:create](${'https://sfdx-hardis.cloudity.com/hardis/org/create/'}) run, read from \`orgInitSteps\` in \`config/.sfdx-hardis.yml\`. Without that key, the list is built from the older keys (\`installedPackages\`, \`initPermissionSets\`, \`scratchOrgInitApexScripts\`, \`sandboxOrgInitApexScripts\`, \`dataPackages\`, \`scripts/data/ScratchInit\`, \`scripts/data/SandboxInit\`).
- **Org type:** the command reads whether the org is a scratch org or a sandbox, and only runs the steps that apply to it. It refuses production orgs.
- **Step selection:** the user picks the steps to run (all are selected), or passes their ids with \`--steps\`.
- **Failures:** a failed step stops the run unless it allows failure. A summary table lists the outcome of every step.

Configure the steps from the Org Initialization panel of the VS Code extension, or in \`orgInitSteps\` (see [sfdx-hardis configuration](${'https://sfdx-hardis.cloudity.com/schema/sfdx-hardis-json-schema-parameters.html'})). [hardis:config:org-init](${'https://sfdx-hardis.cloudity.com/hardis/config/org-init/'}) lists them with their ids.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:init --agent --target-org my-scratch@example.com
sf hardis:org:init --agent --target-org my-sandbox@example.com --steps assign-permsets,load-accounts
\`\`\`

In agent mode:

- The step selection prompt is skipped: every step that applies to the org runs, or only the ones of \`--steps\`.

<details markdown="1">
<summary>Technical explanations</summary>

- The org type comes from \`IsSandbox\` and \`TrialExpirationDate\` of the \`Organization\` record.
- Steps run through \`runOrgInitSteps()\` (\`src/common/utils/orgInitUtils.ts\`), with the deployment actions providers plus three org initialization types: \`install-packages\`, \`deploy-sources\` (scratch orgs only) and \`assign-permission-sets\`.
- While the steps run, \`SF_TARGET_ORG\`, \`SFDX_HARDIS_ORG_USERNAME\` and \`SFDX_HARDIS_ORG_TYPE\` point to the org, so a \`command\` step that runs an sf command targets it without \`--target-org\`.
</details>
`;

  public static examples = [
    '$ sf hardis:org:init',
    '$ sf hardis:org:init --target-org my-scratch@example.com --steps legacy-permission-sets,legacy-data-scratchinit',
    '$ sf hardis:org:init --agent',
  ];

  public static flags: any = {
    steps: Flags.string({
      description: 'Comma-separated ids of the steps to run. Default: every step that applies to the org',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    /* jscpd:ignore-start */
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
    'target-org': requiredOrgFlagWithDeprecations,
    /* jscpd:ignore-end */
  };

  public static requiresProject = true;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ['sfdmu'];

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgInit);
    const agentMode = flags.agent === true;
    const debugMode = flags.debug === true;
    const conn = flags['target-org'].getConnection();
    const orgUsername: string = flags['target-org'].getUsername();
    const orgType = await detectOrgInitOrgType(conn);
    if (orgType === 'production') {
      throw new SfError(t('orgInitRefuseProduction', { orgUsername }));
    }
    const config = await getConfig('user');
    let stepIds: string[] | undefined = flags.steps
      ? String(flags.steps).split(',').map((stepId) => stepId.trim()).filter(Boolean)
      : undefined;
    if (!stepIds && !isCI && !agentMode) {
      const applicableSteps = selectOrgInitSteps(getOrgInitSteps(config).steps, { orgType, phase: 'all' });
      if (applicableSteps.length > 1) {
        const stepsRes = await prompts({
          type: 'multiselect',
          name: 'value',
          message: t('orgInitSelectSteps'),
          description: t('orgInitSelectStepsDescription'),
          choices: applicableSteps.map((step) => ({
            title: step.label,
            value: step.id,
            description: String(step.type),
            selected: true,
          })),
        });
        stepIds = stepsRes.value || [];
        if ((stepIds || []).length === 0) {
          uxLog('action', this, c.cyan(t('orgInitNoStepSelected')));
          return { status: 0, orgUsername, orgType, steps: [], outputString: 'No step selected' };
        }
      }
    }
    const results = await runOrgInitSteps({
      orgUsername,
      orgAlias: orgUsername,
      orgType,
      phase: 'all',
      stepIds,
      projectScratchDef: orgType === 'scratch' ? readProjectScratchDef()?.content || {} : {},
      debugMode,
      config,
    });
    return {
      status: 0,
      orgUsername,
      orgType,
      source: getOrgInitSteps(config).source,
      steps: results,
      outputString: `Initialized ${orgUsername}`,
    } as unknown as AnyJson;
  }
}
