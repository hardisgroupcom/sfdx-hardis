/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from "chalk";
import * as Diff from "diff";
import fs from "fs-extra";
import * as path from "path";
import {
  ensureGitRepository,
  git,
  isCI,
  uxLog,
} from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import moment from 'moment';
import { getReportDirectory } from '../../../../config/index.js';
import { generateMarkdownFileWithMermaid, getMermaidExtraClasses } from '../../../../common/utils/mermaidUtils.js';
import { MetadataUtils } from '../../../../common/metadata-utils/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { parseFlow } from '../../../../common/utils/flowVisualiser/flowParser.js';

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
    const commitSelectRes = await prompts([
      {
        type: 'select',
        name: 'before',
        message: 'Please select BEFORE UPDATE commit',
        choices: fileHistory.all.map(log => {
          return {
            value: log.hash,
            title: `${moment(log.date).format("ll")}: ${log.message}`,
            description: `By ${log.author_name}(${log.author_email}) in ${log.refs}`
          }
        })
      },
      {
        type: 'select',
        name: 'after',
        message: 'Please select AFTER UPDATE commit',
        choices: fileHistory.all.map(log => {
          return {
            value: log.hash,
            title: `${moment(log.date).format("ll")}: ${log.message}`,
            description: `By ${log.author_name}(${log.author_email}) in ${log.refs}`
          }
        })
      }
    ])

    const commitAfter = commitSelectRes.after;
    const commitBefore = commitSelectRes.before;

    const mermaidMdBefore = await this.buildMermaidMarkdown(commitBefore);
    const mermaidMdAfter = await this.buildMermaidMarkdown(commitAfter);

    if (this.debugMode) {
      uxLog(this, c.grey("FLOW DOC BEFORE:\n" + mermaidMdBefore) + "\n");
      uxLog(this, c.grey("FLOW DOC AFTER:\n" + mermaidMdAfter) + "\n");
    }

    const flowDiffs = Diff.diffLines(mermaidMdBefore, mermaidMdAfter);
    uxLog(this, JSON.stringify(flowDiffs, null, 2));

    const mixedLines: any[] = [];
    for (const line of flowDiffs) {
      if (line.added) {
        mixedLines.push(...line.value.split(/\r?\n/).map(lineSplit => { return ["added", lineSplit] }));
      }
      else if (line.removed) {
        mixedLines.push(...line.value.split(/\r?\n/).map(lineSplit => { return ["removed", lineSplit] }));
      }
      else {
        mixedLines.push(...line.value.split(/\r?\n/).map(lineSplit => { return ["unchanged", lineSplit] }));
      }
    }
    // uxLog(this, JSON.stringify(mixedLines, null, 2));
    const compareMdLines: string[] = [];
    this.buildFinalCompareMarkdown(mixedLines, compareMdLines, false);

    // Write markdown with diff in a file
    const reportDir = await getReportDirectory();
    await fs.ensureDir(path.join(reportDir, "flow-diff"));
    const diffMdFile = path.join(reportDir, 'flow-diff', `${this.flowLabel}_${moment().format("YYYYMMDD-hhmmss")}.md`);
    await fs.writeFile(diffMdFile, compareMdLines.join("\n"));
    if (this.debugMode) {
      await fs.copyFile(diffMdFile, diffMdFile + ".mermaid.md");
    }

    // Generate final markdown with mermaid SVG
    const finalRes = await generateMarkdownFileWithMermaid(diffMdFile);
    if (finalRes) {
      uxLog(this, c.green(`Successfull generated visual git diff for flow: ${diffMdFile}`));
    }

    // Open file in a new VsCode tab if available
    WebSocketClient.requestOpenFile(path.relative(process.cwd(), diffMdFile));

    // Return an object to be displayed with --json
    return {
      diffMdFile: diffMdFile
    };
  }

  private buildFinalCompareMarkdown(mixedLines: any[], compareMdLines, isMermaid) {
    if (mixedLines.length === 0) {
      return;
    }
    // Take line to process
    const [status, currentLine] = mixedLines.shift();
    // Update mermaid state
    if (isMermaid === false && currentLine.includes("```mermaid")) {
      isMermaid = true;
    } else if (isMermaid === true && currentLine.includes("```")) {
      compareMdLines.push(...getMermaidExtraClasses().split("\n"));
      isMermaid = false;
    }
    let styledLine = currentLine;
    // Remove next diff line if not relevant
    if (styledLine.startsWith("|") && mixedLines.length > 1 && mixedLines[0][1] === '' && mixedLines[1][1].startsWith("|")) {
      mixedLines.shift();
    }

    // Tables lines
    if (!isMermaid && status === "removed" && styledLine.startsWith("|")) {
      styledLine = "|" + styledLine.split("|").filter(e => e !== "").map((col: string) => `<span style="background-color: red;">${col}</span>`).join("|") + "|";
    }
    else if (!isMermaid && status === "added" && styledLine.startsWith("|")) {
      styledLine = "|" + styledLine.split("|").filter(e => e !== "").map((col: string) => `<span style="background-color: green;">${col}</span>`).join("|") + "|";
    }
    // Normal lines
    else if (!isMermaid && status === "removed" && styledLine !== "") {
      styledLine = `<span style="background-color: red;">${styledLine}</span>`;
    }
    else if (!isMermaid && status === "added" && styledLine !== "") {
      styledLine = `<span style="background-color: green;">${styledLine}</span>`;
    }
    // Boxes lines
    else if (isMermaid === true && status === "removed" && currentLine.split(":::").length === 2) {
      styledLine = styledLine + "Removed"
    }
    else if (isMermaid === true && status === "added" && currentLine.split(":::").length === 2) {
      styledLine = styledLine + "Added"
    }
    else if (isMermaid === true && currentLine.includes(":::")) {
      // Detect if link line does not change, but its content did
      const splits = currentLine.split(/[[({]/);
      if (splits.length > 1) {
        const boxName = splits[0];
        const changed = mixedLines.filter(([lineStatus, line]) => { return line.startsWith(`click ${boxName}`) && ["added", "changed"].includes(lineStatus) }).length;
        if (changed > 0) {
          styledLine = styledLine + "Changed"
        }
      }
    }
    // Link lines
    else if (isMermaid === true && status === "removed" && currentLine.includes('-->')) {
      styledLine = styledLine.replace("-->", "-.->") + ":::removedLink"
    }
    else if (isMermaid === true && status === "added" && currentLine.includes('-->')) {
      styledLine = styledLine.replace("-->", "==>") + ":::addedLink"
    }
    compareMdLines.push(styledLine);
    // Continue processing next lines
    this.buildFinalCompareMarkdown(mixedLines, compareMdLines, isMermaid)
  }

  private async buildMermaidMarkdown(commit) {
    const flowXml = await git().show([`${commit}:${this.flowFile}`]);
    try {
      const flowDocGenResult = await parseFlow(flowXml, 'mermaid', { outputAsMarkdown: true });
      return flowDocGenResult.uml;
    } catch (err: any) {
      throw new SfError(`Unable to build Graph for flow ${this.flowFile}: ${err.message}`)
    }
  }

}
