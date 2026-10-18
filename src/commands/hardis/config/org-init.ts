import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../common/utils/index.js';
import fs from '../../../common/utils/fsUtils.js';
import { getOrgInitConfigPayload } from '../../../common/utils/orgInitUtils.js';
import { t } from '../../../common/utils/i18n.js';
import {
  getScratchOrgDefOrgValues,
  importFeaturesFromOrgShape,
  importSettingsFromOrg,
  listActiveOrgShapes,
  resolveScratchOrgDefSourceOrg,
} from '../../../common/utils/scratchOrgDefOrgUtils.js';
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

Three options read values from an org (\`--source-org\`, else the default Dev Hub, else the default org) so a UI can fill the definition from it:

- \`--org-values\` adds \`orgValues\`: the languages and countries of its users, and its API versions with their release names (current, previous, and the next one for \`preview\`).
- \`--import-settings accountSettings,lightningExperienceSettings\` adds \`importedSettings\`: those settings read with the Metadata API, written as a scratch org definition expects them.
- \`--list-org-shapes\` adds \`orgShapes\`: the active org shapes of the connected orgs. The \`orgId\` of one of them is the value of \`scratchOrgShape\`, the org shape new scratch orgs are created from (\`SCRATCH_ORG_SHAPE\` wins over it). A definition used with an org shape needs no \`edition\`; \`--scratch-org-shape\` validates a definition with another shape than the configured one.
- \`--import-features-from-shape\` creates an [org shape](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_shape_intro.htm) of the org and adds \`importedShape\` with its features. Org Shape must be enabled in that org.

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
- Without the org options, the command is read-only and needs no org. \`--import-features-from-shape\` runs \`sf org create shape\` and waits for the \`ShapeRepresentation\` record to be active.
</details>
`;

  public static examples = [
    '$ sf hardis:config:org-init --json',
    '$ sf hardis:config:org-init --validate-scratch-def ./tmp/project-scratch-def.json --json',
    '$ sf hardis:config:org-init --org-values --json',
    '$ sf hardis:config:org-init --import-settings accountSettings,securitySettings --source-org my-org --json',
    '$ sf hardis:config:org-init --import-features-from-shape --source-org my-org --json',
    '$ sf hardis:config:org-init --list-org-shapes --json',
    '$ sf hardis:config:org-init --agent --json',
  ];

  public static flags: any = {
    'validate-scratch-def': Flags.string({
      description: 'Scratch org definition file to validate instead of config/project-scratch-def.json',
    }),
    'org-values': Flags.boolean({
      default: false,
      description: 'Add the languages, countries and releases of the source org',
    }),
    'import-settings': Flags.string({
      description: 'Comma-separated settings names of a scratch org definition (accountSettings...) to read from the source org',
    }),
    'import-features-from-shape': Flags.boolean({
      default: false,
      description: 'Create an org shape of the source org and return its features',
    }),
    'list-org-shapes': Flags.boolean({
      default: false,
      description: 'Add the active org shapes of the connected orgs',
    }),
    'scratch-org-shape': Flags.string({
      description: 'With --validate-scratch-def: org id of the org shape the definition is used with, "none" for no shape. Default: scratchOrgShape',
    }),
    'source-org': Flags.string({
      description: 'Alias or username of the org to read values from. Default: the default Dev Hub, else the default org',
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
    // Same layers as the commands that run the steps (project, branch, user)
    const config = await getConfig('user');
    // The panel validates a definition with the org shape picked on screen, saved or not
    const shapeFlag = flags['scratch-org-shape'] as string | undefined;
    if (shapeFlag !== undefined) {
      config.scratchOrgShape = shapeFlag === 'none' ? null : shapeFlag;
    }
    const payload = await getOrgInitConfigPayload(config, scratchDefFile);
    if (flags['list-org-shapes']) {
      payload.orgShapes = await listActiveOrgShapes();
    }
    const importSettings = String(flags['import-settings'] || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    if (flags['org-values'] || importSettings.length > 0 || flags['import-features-from-shape']) {
      const org = await resolveScratchOrgDefSourceOrg(flags['source-org']);
      if (flags['org-values']) {
        payload.orgValues = await getScratchOrgDefOrgValues(org);
      }
      if (importSettings.length > 0) {
        payload.importedSettings = await importSettingsFromOrg(org, importSettings);
      }
      if (flags['import-features-from-shape']) {
        payload.importedShape = await importFeaturesFromOrgShape(org);
      }
    }
    uxLog('other', this, c.grey(JSON.stringify(payload, null, 2)));
    return payload as AnyJson;
  }
}
