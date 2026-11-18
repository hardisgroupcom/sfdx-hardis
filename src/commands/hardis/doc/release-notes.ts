/* jscpd:ignore-start */
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from "@salesforce/sf-plugins-core";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { CONSTANTS } from "../../../config/index.js";
import { generateReleaseNotes } from "../../../common/utils/releaseNotesUtils.js";

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages("sfdx-hardis", "org");

/* jscpd:ignore-end */

export default class ReleaseNotes extends SfCommand<any> {
  public static title = "Release Notes";

  public static description = `Generate release notes for a Salesforce project release.

## Command Behavior

Collects data from multiple sources and generates a comprehensive release notes document:

- **Git Provider** (GitHub, GitLab, Azure DevOps, Bitbucket): merged pull requests, contributors
- **Ticket Provider** (JIRA, Azure Boards, ServiceNow, Aha!): ticket details, status, assignees
- **sfdx-git-delta**: metadata changes (created, updated, deleted)
- **Deployment Actions**: manual tasks and automated actions from PR comments
- **AI Provider** (optional): generates a structured summary of the release

Supports two modes:

- **prepare**: preview what will be included in the upcoming release (finds open PR or computes hypothetical delta). Accepts \`--source-branch\` to identify the source branch; if \`--target-branch\` is omitted, it is inferred from the source branch mergeTargets configuration. If neither source branch nor target branch can be determined, the user is prompted.
- **post**: document a completed release (uses merged PRs and tags)

Output includes a **Markdown report** (optionally converted to PDF), a **multi-tab XLSX** with detailed data, and an optional **notification** (Slack, Teams, etc.) for production releases in post mode.

In the XLSX file, the **Metadata Changes** tab lists for each metadata item the Pull Requests (number, title, author) and the commits (title, author, date) that touched it.

The command can determine the release scope from git tags (semver), branch names, commit ranges, or date ranges.

With a semver \`--release-tag\` and no \`--previous-tag\`, the previous tag follows the rules of [release versioning (Beta)](${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-release-versioning/): a plain version (\`v1.5.0\`) starts from the previous plain version, never from one of its own release candidates, and a release candidate created by a deployment (\`v1.5.0-rc.3\`) starts from the previous version of its branch, which is also its target branch.

This command is part of [sfdx-hardis Documentation](${CONSTANTS.DOC_URL_ROOT}/salesforce-project-documentation/).

<details markdown="1">
<summary>Technical explanations</summary>

The command resolves the release scope using one of several strategies:

1. **Tag-based**: uses \`git rev-list\` to find commit SHAs for semver tags, auto-detects the previous tag via \`git tag --sort=-v:refname\`
2. **Branch-based**: uses \`GitProvider.listPullRequestsInBranchSinceLastMerge()\` or \`GitProvider.findOpenPullRequest()\` (prepare mode) with the major orgs configuration
3. **Date-based**: filters PRs by \`minDate\` / max date
4. **Commit-based**: uses explicit commit SHAs

Metadata changes are computed via \`sfdx-git-delta\` (\`sf sgd:source:delta\`), which generates \`package.xml\` (additions) and \`destructiveChanges.xml\` (deletions).

Per-item Pull Request and commit attribution is computed with \`git log --name-only\` over the release commit range: each changed file is resolved to its metadata component with \`@salesforce/source-deploy-retrieve\` over a virtual file tree (so deleted files resolve too), and each commit is mapped to its Pull Request via \`git rev-list\` on the PR merge commit.

Deployment actions are loaded from PR comments (via the \`<!-- sfdx-hardis deployment-actions-state -->\` marker) or from \`scripts/actions/.sfdx-hardis.{PR_ID}.yml\` files.

Inter-major-branch PRs (e.g., integration to preprod) are excluded since they represent promotions, not user stories.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:doc:release-notes --agent --mode post --target-branch main
\`\`\`

In agent mode:

- All interactive prompts are skipped.
- \`--mode\` defaults to \`post\` when not provided.
- \`--target-branch\` defaults to the current git branch.
- When \`--mode post\` and \`--target-branch\` are provided without \`--merge-commit\`, the latest merge commit on the target branch is used automatically.
- When \`--mode prepare\` and \`--source-branch\` is provided without \`--target-branch\`, the target branch is inferred from the source branch mergeTargets configuration.

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.cloudity.com) course runs this command, click by click, on an org of your own, in these labs:

- [Lab 3.5 - Promote to UAT and write the release notes](https://sfdx-hardis-training.cloudity.com/en/level-3-release-manager/3-5-promote-to-uat-and-write-release-notes/)
- [Lab 3.10 - Promote a subset with promotion branches (Beta)](https://sfdx-hardis-training.cloudity.com/en/level-3-release-manager/3-10-promote-a-subset-with-promotion-branches/)
- [Lab 3.11 - Capstone: run a weekly release cycle](https://sfdx-hardis-training.cloudity.com/en/level-3-release-manager/3-11-capstone-run-a-weekly-release-cycle/)

<!-- training-links:end -->
`;

  public static examples = [
    "$ sf hardis:doc:release-notes",
    "$ sf hardis:doc:release-notes --mode post --release-tag v1.2.0",
    "$ sf hardis:doc:release-notes --mode prepare --target-branch main",
    "$ sf hardis:doc:release-notes --mode prepare --source-branch integration",
    "$ sf hardis:doc:release-notes --mode post --target-branch main",
    "$ sf hardis:doc:release-notes --mode post --target-branch main --no-pdf",
    "$ sf hardis:doc:release-notes --mode post --from-date 2026-01-01 --to-date 2026-03-31",
    "$ sf hardis:doc:release-notes --agent --mode post --target-branch main",
  ];

  public static flags: any = {
    mode: Flags.string({
      char: "m",
      options: ["prepare", "post"],
      description: messages.getMessage("releaseNotesMode"),
    }),
    "release-tag": Flags.string({
      description: messages.getMessage("releaseNotesReleaseTag"),
    }),
    "previous-tag": Flags.string({
      description: messages.getMessage("releaseNotesPreviousTag"),
    }),
    "target-branch": Flags.string({
      char: "t",
      description: messages.getMessage("releaseNotesTargetBranch"),
    }),
    "source-branch": Flags.string({
      description: messages.getMessage("releaseNotesSourceBranch"),
    }),
    "merge-commit": Flags.string({
      description: messages.getMessage("releaseNotesMergeCommit"),
    }),
    "source-commit": Flags.string({
      description: messages.getMessage("releaseNotesSourceCommit"),
    }),
    "from-date": Flags.string({
      description: messages.getMessage("releaseNotesFromDate"),
    }),
    "to-date": Flags.string({
      description: messages.getMessage("releaseNotesToDate"),
    }),
    outputfile: Flags.string({
      char: "f",
      description: messages.getMessage("outputFile"),
    }),
    "include-promotions": Flags.boolean({
      default: false,
      description: "Also list the Pull Requests that move other Pull Requests: merges between two major branches, and promotion branches when they are enabled. Left out by default, since what the release delivers are the User Stories they carry",
    }),
    pdf: Flags.boolean({
      default: true,
      allowNo: true,
      description: "Generate the documentation in PDF format (enabled by default, use --no-pdf to skip)",
    }),
    portrait: Flags.boolean({
      default: false,
      description: "Generate the PDF in portrait orientation (default is landscape, which fits the wide Pull Request and ticket tables better)",
    }),
    /* jscpd:ignore-start */
    debug: Flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: Flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: Flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
    agent: Flags.boolean({
      default: false,
      description: "Run in non-interactive mode for agents and automation",
    }),
    "target-org": optionalOrgFlagWithDeprecations,
    /* jscpd:ignore-end */
  };

  public static requiresProject = false;

  protected static triggerNotification = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ReleaseNotes);
    return (await generateReleaseNotes(flags, this)) as AnyJson;
  }
}
