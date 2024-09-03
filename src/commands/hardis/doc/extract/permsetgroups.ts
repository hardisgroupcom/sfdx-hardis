/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import * as path from 'path';
import toc from 'markdown-toc';
import { uxLog } from '../../../../common/utils/index.js';
import { parseXmlFile } from '../../../../common/utils/xmlUtils.js';
import { getReportDirectory } from '../../../../config/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ExtractPermSetGroups extends SfCommand<any> {
  public static title = 'Generate project documentation';

  public static description = `Generate markdown files with project documentation`;

  public static examples = ['$ sf hardis:doc:extract:permsetgroups'];

  public static flags: any = {
    outputfile: Flags.string({
      char: 'o',
      description: 'Force the path and name of output report file. Must end with .csv',
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

  protected outputFile;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ExtractPermSetGroups);
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;
    // Delete standard files when necessary
    uxLog(this, c.cyan(`Generating CSV and Markdown with Permission Set Groups and their related Permission Sets`));
    /* jscpd:ignore-end */

    const psgList: any[] = [];
    const globPatternPSG = process.cwd() + `/**/*.permissionsetgroup-meta.xml`;
    const psgFiles = await glob(globPatternPSG);
    uxLog(this, c.grey(`Found ${psgFiles.length} permission set groups`));
    for (const psgFile of psgFiles) {
      const psgName = (psgFile.replace(/\\/g, '/').split('/').pop() || '').replace('.permissionsetgroup-meta.xml', '');
      const psg = await parseXmlFile(psgFile);
      const psgItem = {
        name: psgName,
        label: psg.PermissionSetGroup.label,
        description: psg.PermissionSetGroup.description,
        permissionSetsNames: psg.PermissionSetGroup.permissionSets,
      };
      psgList.push(psgItem);
    }

    // Build CSV
    const csvLines: any[] = [];
    const header = ['Permission set group', 'Permission sets'];
    csvLines.push(header);
    for (const psg of psgList) {
      const psgLine = [psg.name];
      psgLine.push(`"${psg.permissionSetsNames.join(',')}"`);
      csvLines.push(psgLine);
    }

    // Build output CSV file
    if (this.outputFile == null) {
      // Default file in system temp directory if --outputfile not provided
      const reportDir = await getReportDirectory();
      this.outputFile = path.join(reportDir, 'permission-set-groups.csv');
    } else {
      // Ensure directories to provided --outputfile are existing
      await fs.ensureDir(path.dirname(this.outputFile));
    }
    try {
      const csvText = csvLines.map((e) => e.join(',')).join('\n');
      await fs.writeFile(this.outputFile, csvText, 'utf8');
      uxLog(this, c.cyan(`Permission set groups CSV file generated in ${c.bold(c.green(this.outputFile))}`));
      // Trigger command to open CSV file in VsCode extension
      WebSocketClient.requestOpenFile(this.outputFile);
    } catch (e: any) {
      uxLog(this, c.yellow('Error while generating CSV log file:\n' + (e as Error).message + '\n' + e.stack));
      this.outputFile = null;
    }

    // Build markdown file
    const mdPsg = ['# Permission set groups', '', '<!-- toc -->', '<!-- tocstop -->'];
    for (const psg of psgList) {
      mdPsg.push(...[`## ${psg.name}`, '', psg.label, '', psg.description, '']);
      for (const psName of psg.permissionSetsNames) {
        mdPsg.push(`  - ${psName} `);
      }
      mdPsg.push('');
    }
    const docFile = 'docs/permission-set-groups.md';
    await fs.ensureDir('docs');
    let mdPsgText = mdPsg.join('\n');
    mdPsgText = toc.insert(mdPsgText);
    await fs.writeFile(docFile, mdPsgText, 'utf8');
    uxLog(this, c.cyan(`Permission set groups Markdown file generated in ${c.bold(c.green(docFile))}`));
    // Trigger command to open CSV file in VsCode extension
    WebSocketClient.requestOpenFile(docFile);

    // Return an object to be displayed with --json
    return { outputString: 'Permission set groups Documentation generated' };
  }
}
