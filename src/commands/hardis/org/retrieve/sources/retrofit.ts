/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../../../common/utils/index.js';
import { t } from '../../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class Retrofit extends SfCommand<any> {
  public static DEFAULT_SOURCES_TO_RETROFIT = [
    'CompactLayout',
    'CustomApplication',
    'CustomField',
    'CustomLabel',
    'CustomLabels',
    'CustomMetadata',
    'CustomObject',
    'CustomObjectTranslation',
    'CustomTab',
    'DuplicateRule',
    'EmailTemplate',
    'FlexiPage',
    'GlobalValueSet',
    'Layout',
    'ListView',
    'MatchingRules',
    'PermissionSet',
    'RecordType',
    'StandardValueSet',
    'Translations',
    'ValidationRule',
  ];

  public static title = 'Retrofit changes from an org';

  public static description = `
## DEPRECATED

**This command is deprecated and must not be used.** Changing a major org by hand is not a supported way of working.

When a change was made directly in an org, recover it as an ordinary User Story: start a branch under the lowest major branch (usually \`integration\`), retrieve exactly what changed with the Metadata Retriever of the VS Code SFDX Hardis extension, then review and merge it like any other work. See [Retrofit](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-retrofit/).

Retrieve changes from org link to a ref branch not present in sources

  This command need to be triggered from a branch that is connected to a SF org. It will then retrieve all changes not present in that branch sources, commit them and create a merge request against the default branch. If a merge request already exists, it will simply add a new commit.

  Define the following properties in **.sfdx-hardis.yml**

  - **productionBranch** : Name of the git branch that is corresponding to production org
  - **retrofitBranch** : Name of the git branch that will be used as merge request target

  List of metadata to retrieve can be set in three way, in order of priority :

  - \`CI_SOURCES_TO_RETROFIT\`: env variable (can be defined in CI context)
  - \`sourcesToRetrofit\` property in \`.sfdx-hardis.yml\`
  - Default list:\n\n    - ${Retrofit.DEFAULT_SOURCES_TO_RETROFIT.join('\n    - ')}

  You can also ignore some files even if they have been updated in production. To do that, define property **retrofitIgnoredFiles** in .sfdx-hardis.yml

  Example of full retrofit configuration:

  \`\`\`yaml
  productionBranch: master
  retrofitBranch: preprod
  retrofitIgnoredFiles:
  - force-app/main/default/applications/MyApp.app-meta.xml
  - force-app/main/default/applications/MyOtherApp.app-meta.xml
  - force-app/main/default/flexipages/MyFlexipageContainingDashboards.flexipage-meta.xml
  \`\`\`

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:retrieve:sources:retrofit --agent
\`\`\`

In agent mode, all interactive prompts are skipped and default values are used.
  `;

  public static examples = [
    '$ sf hardis:org:retrieve:sources:retrofit',
    '$ sf hardis:org:retrieve:sources:retrofit --agent',
    'sf hardis:org:retrieve:sources:retrofit --productionbranch master --commit --commitmode updated',
    'sf hardis:org:retrieve:sources:retrofit --productionbranch master  --retrofitbranch preprod --commit --commitmode updated --push --pushmode mergerequest',
  ];

  public static flags: any = {
    commit: Flags.boolean({
      default: false,
      description: 'If true, a commit will be performed after the retrofit',
    }),
    commitmode: Flags.string({
      default: 'updated',
      options: ['updated', 'all'],
      description: 'Defines if we commit all retrieved updates, or all updates including creations',
    }),
    push: Flags.boolean({
      default: false,
      description: 'If true, a push will be performed after the retrofit',
    }),
    pushmode: Flags.string({
      default: 'default',
      options: ['default', 'mergerequest'],
      description: 'Defines if we send merge request options to git push arguments',
    }),
    productionbranch: Flags.string({
      description:
        'Name of the git branch corresponding to the org we want to perform the retrofit on.\nCan be defined in productionBranch property in .sfdx-hardis.yml',
    }),
    retrofittargetbranch: Flags.string({
      description:
        'Name of branch the merge request will have as target\nCan be defined in retrofitBranch property in .sfdx-hardis.yml',
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
    'target-org': requiredOrgFlagWithDeprecations,
  }; // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected configInfo: any = {};
  protected debugMode = false;

  protected commit = false;
  protected commitMode: string | boolean = 'updated';
  protected push = false;
  protected pushMode = 'default';
  protected productionBranch: string | null;
  protected retrofitTargetBranch: string | null;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    uxLog("error", this, c.red(t('retrofitOrgDeprecatedUseUserStory')));
    process.exitCode = 1;
    return { outputString: 'This command is deprecated. Recover the change as a User Story: see https://sfdx-hardis.cloudity.com/salesforce-ci-cd-retrofit/' };
  }

}
