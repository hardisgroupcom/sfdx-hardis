/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from "chalk";
import * as Diff from "diff";
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

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class GenerateFlowDiff extends SfCommand<any> {
  public static title = 'Generate Flow Diff';

  public static description = 'Generate Flow Diff markdown between 2 commits';

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

    uxLog(this, JSON.stringify(mixedLines, null, 2));

    // Return an object to be displayed with --json
    return {
    };
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
