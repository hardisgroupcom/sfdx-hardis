/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import { uxLogTableWithReport } from '../../../../common/utils/filesUtils.js';
import { CONSTANTS } from '../../../../config/index.js';
import { t } from '../../../../common/utils/i18n.js';
import { describeReleaseVersions } from '../../../../common/utils/releaseVersionUtils.js';
import type { CommandReport } from '../../../../common/docBuilder/commandScreenshots.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class VersionList extends SfCommand<any> {
  public static title = 'List release versions';

  public static reports: CommandReport[] = [
    {
      file: 'release-versions',
      title: 'Release versions',
      description: 'One row per version tag of the repository, newest first: version, branch, deployment date, Pull Request and org.',
    },
  ];

  public static description = `
## Command Behavior

**Lists the release versions of the project: the version deployed on each versioned major branch, the version each promotion would create, and the history of the version tags.**

With [release versioning](${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-release-versioning/), each successful deployment on a major branch whose branch config declares \`releaseVersioning: true\` creates a semver tag: release candidates (\`v1.5.0-rc.3\`) on every versioned branch but the highest one, plain versions (\`v1.5.0\`) on the highest one (usually main).

The command:

- fetches the tags of the remote repository (skip it with \`--no-fetch\`);
- gives, for each versioned branch, its role in the chain (\`first\`, \`middle\`, \`final\`) and the version last deployed in its org;
- computes, for each major branch merged into a versioned branch, the version the next promotion would create, with the same rules as a deployment job;
- lists the version tags, newest first, with the branch, the org, the deployment date, the Pull Request and the job that created them, in a report file;
- with \`--with-links\`, adds the web URL of each tag and Release. It is off by default, since building the git provider client can call its API.

Nothing is written: no tag is created, no org is called. Without \`--with-links\`, only git is called: one fetch of the tags, then local reads.

The DevOps Pipeline of the VS Code extension reads it with \`--json\` to show the versions on the branch and org nodes, the version each promotion will create, and the Releases tab.

<details markdown="1">
<summary>Technical explanations</summary>

- The tags are read with \`git for-each-ref refs/tags\`: a version tag created by a deployment is an annotated tag whose message starts with \`sfdx-hardis release version\` and holds the branch, the version, the release candidate number, the variables of the tag format, the org, the date, the Pull Request and the job URL. The version comes from that message, whatever the tag name (\`releaseVersioningTagFormat\`).
- Other tags count only when their name is a plain semver version (\`v1.3.0\`, \`v1.3.0-rc.2\`), with no branch. The others (\`v2.0\`, \`release-x\`, \`v1.3.0-pi2-rc1\` made by hand) are ignored.
- The version a promotion would create is computed from the tags reachable from \`origin/<source branch>\`, as the deployment job computes it from the deployed commit.
- With \`--json\`, the result holds \`enabled\`, \`initialVersion\`, \`minimumVersion\`, \`branches\` (\`branchName\`, \`role\`, \`current\`, \`nextOnPromotion\`) and \`history\`. Each version entry has \`tag\`, \`version\` (semver form, \`1.5.0-rc.3\`: with tag formats, two release candidates of two branches can share it), \`variables\` (values of the custom variables of the tag format), \`prerelease\`, \`branchName\`, \`commit\`, \`deployedAt\`, \`org\`, \`pullRequest\`, \`jobUrl\`, \`tagUrl\` and \`releaseUrl\`.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:version:list --agent --json
\`\`\`

In agent mode:

- No flag is required: the command never prompts.
- Use \`--json\` and read \`branches\` to know which version is in which org, and \`nextOnPromotion\` to know the version a promotion will create.
`;

  public static examples = [
    '$ sf hardis:project:version:list',
    '$ sf hardis:project:version:list --json',
    '$ sf hardis:project:version:list --no-fetch --history-limit 200',
    '$ sf hardis:project:version:list --with-links --json',
    '$ sf hardis:project:version:list --agent --json',
  ];

  public static flags: any = {
    fetch: Flags.boolean({
      default: true,
      allowNo: true,
      description: 'Fetch the tags of the remote repository first (use --no-fetch to read the local tags only)',
    }),
    'with-links': Flags.boolean({
      default: false,
      description: 'Also return the web URL of each tag and Release (builds the git provider client, which can call its API)',
    }),
    'history-limit': Flags.integer({
      default: 50,
      min: 1,
      description: 'Number of version tags returned in the history, newest first',
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
    const { flags } = await this.parse(VersionList);
    const description = await describeReleaseVersions({
      fetch: flags.fetch !== false,
      historyLimit: flags['history-limit'] || 50,
      withLinks: flags['with-links'] === true,
      commandRef: this,
    });
    if (!description.enabled) {
      uxLog("warning", this, c.yellow(t('versionListNoVersionedBranch')));
      return { ...description, outputString: 'No versioned branch' } as any;
    }
    uxLog("action", this, c.cyan(t('versionListTitle', { branches: description.branches.length, versions: description.history.length })));
    for (const branch of description.branches) {
      const next = branch.nextOnPromotion.map((promotion) => `${promotion.sourceBranch} -> ${promotion.tag}`).join(', ');
      uxLog("log", this, c.grey(t('versionListBranchLine', {
        branch: branch.branchName,
        role: branch.role,
        version: branch.current?.tag || '-',
        next: next || '-',
      })));
    }
    await uxLogTableWithReport(
      this,
      description.history.map((entry) => ({
        Version: entry.tag,
        Branch: entry.branchName || '',
        Deployed: entry.deployedAt ? entry.deployedAt.replace('T', ' ').substring(0, 16) : '',
        'Pull Request': entry.pullRequest ? `#${entry.pullRequest}` : '',
        Org: entry.org || '',
      })),
      ['Version', 'Branch', 'Deployed', 'Pull Request', 'Org'],
      { fileNamePrefix: 'release-versions', fileTitle: 'Release versions' }
    );
    return { ...description, outputString: `${description.history.length} version tag(s)` } as any;
  }
}
