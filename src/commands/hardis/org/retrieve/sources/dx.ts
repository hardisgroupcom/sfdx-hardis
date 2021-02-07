/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages, SfdxError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as child from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as util from 'util';
const exec = util.promisify(child.exec);

import { MetadataUtils } from '../../../../../common/metadata-utils';
import { checkSfdxPlugin } from '../../../../../common/utils';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DxSources extends SfdxCommand {
  public static title = 'Retrieve sfdx sources from org';

  public static description = messages.getMessage('retrieveDx');

  public static examples = [
    '$ sfdx hardis:org:retrieve:sources:dx',
    '$ sfdx hardis:org:retrieve:sources:dx --sandbox'
  ];

  protected static flagsConfig = {
    folder: flags.string({
      char: 'f',
      default: '.',
      description: messages.getMessage('folder')
    }),
    tempfolder: flags.string({
      char: 't',
      default: './tmp',
      description: messages.getMessage('tempFolder')
    }),
    filteredmetadatas: flags.string({
      char: 'm',
      description: messages.getMessage('filteredMetadatas')
    }),
    sandbox: flags.boolean({
      char: 's',
      default: false,
      description: messages.getMessage('sandboxLogin')
    }),
    instanceurl: flags.string({
      char: 'r',
      description: messages.getMessage('instanceUrl')
    }),
    debug: flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode')
    })
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const folder = path.resolve(this.flags.folder || '.');
    const tempFolder = path.resolve(this.flags.tempfolder || './tmp');
    const filteredMetadatas = this.flags.filteredmetadatas
      ? this.flags.filteredmetadatas.split(',')
      : MetadataUtils.listMetadatasNotManagedBySfdx();
    const debug = this.flags.debug || false;

    // Check required plugins
    const powerkitRes = await checkSfdxPlugin('sfpowerkit');
    this.ux.log(powerkitRes.message);
    const essentialsRes = await checkSfdxPlugin('sfdx-essentials');
    this.ux.log(essentialsRes.message);

    // Create working temp folders and define it as cwd
    const prevCwd = process.cwd();
    await fs.ensureDir(tempFolder);
    process.chdir(tempFolder);
    const metadataFolder = path.join(tempFolder, 'mdapipkg');
    await fs.ensureDir(metadataFolder);
    const sfdxFolder = path.join(tempFolder, 'sfdx-project');
    await fs.ensureDir(sfdxFolder);

    // Retrieve metadatas
    const packageXml = path.resolve(path.join(tempFolder, 'package.xml'));
    await MetadataUtils.retrieveMetadatas(
      packageXml,
      metadataFolder,
      true,
      filteredMetadatas,
      this,
      debug
    );

    // Create sfdx project
    if (fs.readdirSync(sfdxFolder).length === 0) {
      this.ux.log('[sfdx-hardis] Creating SFDX project...');
      const createProjectRes = await exec(
        'sfdx force:project:create --projectname "sfdx-project"',
        { maxBuffer: 1024 * 2000 }
      );
      if (debug) {
        this.ux.log(createProjectRes.stdout + createProjectRes.stderr);
      }
    }

    // Converting metadatas to sfdx
    this.ux.log(
      `[sfdx-hardis] Converting metadatas into SFDX sources in ${sfdxFolder}...`
    );
    process.chdir(sfdxFolder);
    try {
      const convertRes = await exec(
        `sfdx force:mdapi:convert --rootdir ${path.join(
          metadataFolder,
          'unpackaged'
        )} ${debug ? '--verbose' : ''}`,
        { maxBuffer: 10000 * 10000 }
      );
      if (debug) {
        this.ux.log(convertRes.stdout + convertRes.stderr);
      }
    } catch (e) {
      throw new SfdxError(JSON.stringify(e, null, 2));
    }

    // Move sfdx sources in main folder
    this.ux.log(
      `[sfdx-hardis] Moving temp files to main folder ${path.resolve(
        folder
      )}...`
    );
    process.chdir(prevCwd);
    await fs.copy(sfdxFolder, path.resolve(folder));
    // Remove temporary files
    await fs.rmdir(tempFolder, { recursive: true });

    // Set bac initial cwd
    const message = `[sfdx-hardis] Successfully retrieved sfdx project in ${folder}`;
    this.ux.log(message);
    return { orgId: this.org.getOrgId(), outputString: message };
  }
}
