import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../common/utils/index.js';
import fs from '../../../common/utils/fsUtils.js';
import { getOrgInitConfigPayload } from '../../../common/utils/orgInitUtils.js';
import { t } from '../../../common/utils/i18n.js';
import { getConfig } from '../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ConfigOrgInit extends SfCommand<any> {
  public static title = 'Get org initialization configuration';

  public static description = `Returns how the project initializes its scratch orgs and sandboxes, without connecting to any org.

## Command Behavior

**Gives configuration UIs (e.g. the Org Initialization panel of the [VS Code sfdx-hardis extension](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)) everything they need to show and edit the org initialization steps, so they never rebuild the list themselves.**

The payload contains:

- \`steps[]\`: the initialization steps in their run order, with their defaults filled (\`enabled\`, \`orgTypes\`, \`allowFailure\`, \`runAtPoolFill\`).
- \`source\`: \`orgInitSteps\` when the project defines the key, \`legacy\` when the list is built from the older keys (\`initPermissionSets\`, \`scratchOrgInitApexScripts\`, \`sandboxOrgInitApexScripts\`, \`installedPackages\`, \`dataPackages\` with \`importInSandboxOrgs\`, and the \`scripts/data/ScratchInit\` and \`scripts/data/SandboxInit\` folders).
- \`legacyKeys[]\`: the older keys still present in \`.sfdx-hardis.yml\`.
- \`definitionErrors[]\`: what prevents a step from running (unknown type, missing parameter, sources deployed to a sandbox...).
- \`stepTypes[]\`: the step types an org initialization accepts, with the org types each one can run on.
- \`scratchDef\`: the content of \`config/project-scratch-def.json\` and its validation issues.
- \`scratchOrgDuration\` and \`scratchDefHints\` (editions, features and settings names known by Salesforce CLI).

With \`--validate-scratch-def\`, the scratch org definition is read from that file instead, so a UI can validate a definition before writing it.

Run [hardis:org:init](${'https://sfdx-hardis.cloudity.com/hardis/org/init/'}) to run the steps on an org.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:config:org-init --agent --json
\`\`\`

The command has no prompt: agent mode behaves the same.

<details markdown="1">
<summary>Technical explanations</summary>

- The steps come from \`getOrgInitSteps()\` (\`src/common/utils/orgInitUtils.ts\`), the same function \`hardis:scratch:create\`, \`hardis:org:create\` and \`hardis:org:init\` use.
- The scratch org definition is validated with \`ScratchOrgDefSchema\` from \`@salesforce/core\`, then each \`settings\` entry is checked against the settings names of the Salesforce CLI JSON schema.
- The command is read-only and needs no org.
</details>
`;

  public static examples = [
    '$ sf hardis:config:org-init --json',
    '$ sf hardis:config:org-init --validate-scratch-def ./tmp/project-scratch-def.json --json',
    '$ sf hardis:config:org-init --agent --json',
  ];

  public static flags: any = {
    'validate-scratch-def': Flags.string({
      description: 'Scratch org definition file to validate instead of config/project-scratch-def.json',
    }),
    /* jscpd:ignore-start */
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
    /* jscpd:ignore-end */
  };

  public static requiresProject = true;
  public static disableWebsocket = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ConfigOrgInit);
    const scratchDefFile = flags['validate-scratch-def'] as string | undefined;
    if (scratchDefFile && !fs.existsSync(scratchDefFile)) {
      throw new SfError(t('fileNotFound', { filePath: scratchDefFile }));
    }
    const config = await getConfig('project');
    const payload = await getOrgInitConfigPayload(config, scratchDefFile);
    uxLog('other', this, c.grey(JSON.stringify(payload, null, 2)));
    return payload as AnyJson;
  }
}
