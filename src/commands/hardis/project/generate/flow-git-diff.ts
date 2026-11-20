/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from "chalk";
import * as path from "path";
import {
  ensureGitRepository,
  git,
  isCI,
  uxLog,
} from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { dateHelper } from '../../../../common/utils/dateHelper.js';
import { generateFlowVisualGitDiff, generateHistoryDiffMarkdown } from '../../../../common/utils/mermaidUtils.js';
import { MetadataUtils } from '../../../../common/metadata-utils/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

// Branch names from git branch -a, as git show accepts them: remotes/origin/main becomes origin/main, HEAD pointers are skipped
export function getBranchRefs(branchNames: string[]): string[] {
  const refs = branchNames
    .map((branchName) => branchName.replace(/^remotes\//, ''))
    .filter((branchName) => branchName !== '' && branchName !== 'HEAD' && !branchName.endsWith('/HEAD') && !branchName.startsWith('('));
  return [...new Set(refs)];
}

export default class GenerateFlowGitDiff extends SfCommand<any> {
  public static title = 'Generate Flow Visual Gif Diff';

  public static description = `Generate Flow Visual Git Diff markdown between 2 commits, or between 2 branches

\`--commit-before\` and \`--commit-after\` accept a commit hash or a branch name (ex: \`origin/main\`), and the interactive prompts list the branches after the commits of the Flow.

Note: This command might requires @mermaid-js/mermaid-cli to be installed.

Run \`npm install @mermaid-js/mermaid-cli --global\`

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:generate:flow-git-diff --agent --flow "force-app/main/default/flows/MyFlow.flow-meta.xml" --commit-before abc123 --commit-after def456
\`\`\`

In agent mode:

- All interactive prompts for flow selection, commit-before, and commit-after are skipped.
- \`--flow\`, \`--commit-before\`, and \`--commit-after\` flags must be provided.
  `;

  public static examples = [
    '$ sf hardis:project:generate:flow-git-diff',
    '$ sf hardis:project:generate:flow-git-diff --flow "force-app/main/default/flows/Opportunity_AfterUpdate_Cloudity.flow-meta.xml" --commit-before 8bd290e914c9dbdde859dad7e3c399776160d704 --commit-after e0835251bef6e400fb91e42f3a31022f37840f65',
    '$ sf hardis:project:generate:flow-git-diff --agent --flow "force-app/main/default/flows/MyFlow.flow-meta.xml" --commit-before abc123 --commit-after def456',
    '$ sf hardis:project:generate:flow-git-diff --flow "force-app/main/default/flows/MyFlow.flow-meta.xml" --commit-before origin/main --commit-after origin/integration',
  ];

  public static flags: any = {
    flow: Flags.string({
      description: 'Path to flow file (will be prompted if not set)',
    }),
    "commit-before": Flags.string({
      description: 'Commit hash or branch name (ex: origin/main) of the previous flow state, or "allStates" (will be prompted if not set)',
      default: ""
    }),
    "commit-after": Flags.string({
      description: 'Commit hash or branch name (ex: origin/integration) of the new flow state (will be prompted if not set)',
      default: "",
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
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected flowFile: string;
  protected flowLabel: string;
  commitBefore: string = "";
  commitAfter: string = "";
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(GenerateFlowGitDiff);
    const agentMode = flags.agent === true;
    this.flowFile = flags.flow || "";
    this.commitBefore = flags["commit-before"] || "";
    this.commitAfter = flags["commit-after"] || "";
    this.debugMode = flags.debug || false;
    // Check git repo
    await ensureGitRepository();

    // Prompt flow file if not send as input param
    if (this.flowFile == "") {
      if (isCI || agentMode) {
        throw new SfError('In agent/CI mode, --flow flag is required.');
      }
      this.flowFile = await MetadataUtils.promptFlow();
    }
    this.flowLabel = path.basename(this.flowFile, ".flow-meta.xml");

    // List states of flow file using git
    const fileHistory = await git().log({ file: this.flowFile });
    const promptNeeded = (this.commitBefore === "" || this.commitAfter === "") && !isCI && !agentMode;
    const branchChoices = promptNeeded ? await this.listBranchChoices() : [];
    // A Flow with one commit on the current branch can still differ in another branch
    if (fileHistory.all.length === 1 && branchChoices.length === 0 && (this.commitBefore === "" || this.commitAfter === "")) {
      uxLog("action", this, c.cyan(t('thereIsOnlyOneStateForFlow', { flowFile: this.flowFile })));
      return {};
    }

    // Build prompt choices
    let allChoices: any[] = [];
    if (promptNeeded) {
      allChoices = fileHistory.all.map(log => {
        return {
          value: log.hash,
          title: `${dateHelper(log.date).format("ll")}: ${log.message}`,
          description: `By ${log.author_name}(${log.author_email}) in ${log.refs}`
        }
      });
      allChoices.push(...branchChoices);
    }

    // Prompt commits if not sent as input parameter
    if (this.commitBefore === "" && (isCI || agentMode)) {
      throw new SfError('In agent/CI mode, --commit-before flag is required (use "allStates" to generate all states).');
    }
    if (this.commitBefore === "" && !isCI && !agentMode) {
      const commitBeforeSelectRes = await prompts({
        type: 'select',
        name: 'before',
        message: t('pleaseSelectBeforeUpdateCommit'),
        description: t('chooseCommitBeforeYourChanges'),
        placeholder: t('selectACommit'),
        choices: [...allChoices, ...[
          {
            title: t('calculateForAllFlowStates'),
            value: "allStates",
            description: t('requiresMkdocsMaterialForAllStates')
          }
        ]]
      });
      this.commitBefore = commitBeforeSelectRes.before;
    }
    let diffMdFile;

    if (this.commitBefore === "allStates") {
      diffMdFile = await generateHistoryDiffMarkdown(this.flowFile, this.debugMode);
    }
    else {
      if (this.commitAfter === "" && !isCI && !agentMode) {
        // Compute between 2 commits: prompt for the second one      
        const commitAfterSelectRes = await prompts({
          type: 'select',
          name: 'after',
          message: t('pleaseSelectAfterUpdateCommit'),
          description: t('chooseCommitAfterYourChanges'),
          placeholder: t('selectACommit'),
          choices: allChoices
        })
        this.commitAfter = commitAfterSelectRes.after;
      }
      await this.checkGitRef(this.commitBefore);
      await this.checkGitRef(this.commitAfter);
      // Generate diff
      const { outputDiffMdFile, isFlowDeletedOrAdded } = await generateFlowVisualGitDiff(this.flowFile, this.commitBefore, this.commitAfter, { svgMd: true, pngMd: false, mermaidMd: this.debugMode, debug: this.debugMode })
      // Ex: a Flow created in a feature branch does not exist in origin/main
      if (isFlowDeletedOrAdded) {
        uxLog("warning", this, c.yellow(t('flowDiffFlowMissingInOneState', { flowFile: this.flowFile, before: this.commitBefore, after: this.commitAfter })));
        return {};
      }
      diffMdFile = outputDiffMdFile;
    }

    // Open file in a new VS Code tab if available
    WebSocketClient.requestOpenFile(path.relative(process.cwd(), diffMdFile));
    WebSocketClient.sendReportFileMessage(diffMdFile, t('fileDocumentation', { name: path.basename(diffMdFile).replace(".md", "") }), 'report');

    uxLog("action", this, c.green(t('markdownFlowDiffDocumentationGeneratedFor', { path: path.basename(diffMdFile).replace(".md", "") })));
    if (this.commitBefore === "allStates") {
      uxLog("warning", this, c.yellow(t('recommendedToUseMkdocsMaterialToRead')));
    }

    // Return an object to be displayed with --json
    return {
      diffMdFile: diffMdFile
    };
  }

  // Local and remote branches, listed after the commits of the Flow in the prompts
  private async listBranchChoices(): Promise<any[]> {
    const branchSummary = await git().branch(['-a']);
    return getBranchRefs(branchSummary.all).map((branchRef) => {
      return {
        value: branchRef,
        title: t('flowDiffBranchChoice', { branch: branchRef }),
        description: t('flowDiffBranchChoiceDescription'),
      };
    });
  }

  // Fails early with a readable error when a commit or branch does not exist, instead of an empty diff
  private async checkGitRef(gitRef: string) {
    try {
      await git().raw(['rev-parse', '--verify', `${gitRef}^{commit}`]);
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    catch (err: any) {
      throw new SfError(t('flowDiffUnknownGitRef', { gitRef }));
    }
  }
}
