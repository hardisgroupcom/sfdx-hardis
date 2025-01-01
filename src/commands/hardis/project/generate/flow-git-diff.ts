/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
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
import moment from 'moment';
import { generateFlowVisualGitDiff, generateHistoryDiffMarkdown } from '../../../../common/utils/mermaidUtils.js';
import { MetadataUtils } from '../../../../common/metadata-utils/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class GenerateFlowGitDiff extends SfCommand<any> {
  public static title = 'Generate Flow Visual Gif Diff';

  public static description = `Generate Flow Visual Git Diff markdown between 2 commits

This command requires @mermaid-js/mermaid-cli to be installed.

Run \`npm install @mermaid-js/mermaid-cli --global\`
  `;

  public static examples = ['$ sf hardis:project:generate:flow-git-diff'];

  public static flags: any = {
    flow: Flags.string({
      description: 'Path to flow file (will be prompted if not set)',
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

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected flowFile: string;
  protected flowLabel: string;
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(GenerateFlowGitDiff);
    this.flowFile = flags.flow || "";
    this.debugMode = flags.debug || false;
    // Check git repo
    await ensureGitRepository();

    // Prompt flow file if not send as input param
    if (this.flowFile == "" && !isCI) {
      this.flowFile = await MetadataUtils.promptFlow();
    }
    this.flowLabel = path.basename(this.flowFile, ".flow-meta.xml");

    // List states of flow file using git
    const fileHistory = await git().log({ file: this.flowFile });
    if (fileHistory.all.length === 1) {
      uxLog(this, c.green(`There is only one state for Flow ${this.flowFile}`));
      return {};
    }

    // Prompt commits
    const allChoices = fileHistory.all.map(log => {
      return {
        value: log.hash,
        title: `${moment(log.date).format("ll")}: ${log.message}`,
        description: `By ${log.author_name}(${log.author_email}) in ${log.refs}`
      }
    });
    const commitBeforeSelectRes = await prompts({
      type: 'select',
      name: 'before',
      message: 'Please select BEFORE UPDATE commit',
      choices: [...allChoices, ...[
        {
          title: "Calculate for all Flow states",
          value: "allStates",
          description: "Requires mkdocs-material to be read correctly. If you do not have it, we advise to select 2 commits for comparison."
        }
      ]]
    });
    const commitBefore = commitBeforeSelectRes.before;
    let diffMdFile;

    if (commitBefore === "allStates") {
      diffMdFile = await generateHistoryDiffMarkdown(this.flowFile, this.debugMode);
      uxLog(this, c.yellow(`It is recommended to use mkdocs-material to read it correctly (see https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/#doc-html-pages)`));
    }
    else {
      // Compute between 2 commits: prompt for the second one      
      const commitAfterSelectRes = await prompts({
        type: 'select',
        name: 'after',
        message: 'Please select AFTER UPDATE commit',
        choices: allChoices
      })
      const commitAfter = commitAfterSelectRes.after;
      const { outputDiffMdFile } = await generateFlowVisualGitDiff(this.flowFile, commitBefore, commitAfter, { svgMd: true, pngMd: false, mermaidMd: this.debugMode, debug: this.debugMode })

      // Open file in a new VsCode tab if available
      WebSocketClient.requestOpenFile(path.relative(process.cwd(), outputDiffMdFile));
    }

    // Return an object to be displayed with --json
    return {
      diffMdFile: diffMdFile
    };
  }

}
