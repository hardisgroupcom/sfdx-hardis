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
import { listFlowFiles } from '../../../../common/utils/projectUtils.js';
import moment from 'moment';
import { parseFlow } from 'salesforce-flow-visualiser';
import { getReportDirectory } from '../../../../config/index.js';
import { generateMarkdownFileWithMermaid, getMermaidExtraClasses } from '../../../../common/utils/mermaidUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class GenerateFlowDiff extends SfCommand<any> {
  public static title = 'Generate Flow Diff';

  public static description = `Generate Flow Diff markdown between 2 commits

This command requires @mermaid-js/mermaid-cli to be installed.

Run \`npm install @mermaid-js/mermaid-cli --global\`
  `;

  public static examples = ['$ sf hardis:project:generate:flow-diff'];

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
    const { flags } = await this.parse(GenerateFlowDiff);
    this.flowFile = flags.flow || "";
    this.debugMode = flags.debug || false;
    // Check git repo
    await ensureGitRepository();

    // Prompt flow file if not send as input param
    if (this.flowFile == "" && !isCI) {
      const flowFiles = await listFlowFiles(this.project?.getPackageDirectories() || [])
      const flowSelectRes = await prompts({
        type: 'select',
        message: 'Please select the Flow you want to visually compare',
        choices: flowFiles.map(flowFile => {
          return { value: flowFile, title: flowFile }
        })
      });
      this.flowFile = flowSelectRes.value.replace(/\\/g, "/");
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
    const diffMdFile = path.join(reportDir, `flow_diff_${this.flowLabel}_${commitBefore}_${commitAfter}.md`);
    await fs.writeFile(diffMdFile, compareMdLines.join("\n"));
    if (this.debugMode) {
      await fs.copyFile(diffMdFile, diffMdFile + ".mermaid.md");
    }

    // Generate final markdown with mermaid SVG
    const finalRes = await generateMarkdownFileWithMermaid(diffMdFile);
    if (finalRes) {
      uxLog(this, c.green(`Successfull generated visual diff for flow: ${diffMdFile}`));
    }

    // Return an object to be displayed with --json
    return {
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
    if (!isMermaid && status === "removed") {
      styledLine = styledLine.split("|").map((col: string) => `<span style="color: red;">${col}</span>`).join("|");
    }
    else if (!isMermaid && status === "added") {
      styledLine = styledLine.split("|").map((col: string) => `<span style="color: green;">${col}</span>`).join("|");
    }
    else if (isMermaid === true && status === "removed" && currentLine.split(":::").length === 2) {
      styledLine = styledLine + "Removed"
    }
    else if (isMermaid === true && status === "added" && currentLine.split(":::").length === 2) {
      styledLine = styledLine + "Added"
    }
    else if (isMermaid === true && status === "removed" && currentLine.includes('-->')) {
      styledLine = styledLine.replace("-->", "-.->") + ":::removedLink"
    }
    else if (isMermaid === true && status === "added" && currentLine.includes('-->')) {
      styledLine = styledLine.replace("-->", "==>") + ":::addedLink"
    }
    // Skip lines in error
    if (!styledLine.includes("Unknown (no targetReference")) {
      compareMdLines.push(styledLine);
    }

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
