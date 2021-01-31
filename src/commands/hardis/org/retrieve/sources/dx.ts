  /* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages, SfdxError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as child from 'child_process';
import * as extractZip from 'extract-zip';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as sfdx from 'sfdx-node';
import * as util from 'util';
const exec = util.promisify(child.exec);
import { MetadataUtils } from '../../../../../common/metadata-utils';
import { checkSfdxPlugin, filterPackageXml } from '../../../../../common/utils';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('@hardis-group/sfdx-hardis', 'org');

export default class DxSources extends SfdxCommand {

  public static title = 'Retrieve sfdx sources from org';

  public static description = messages.getMessage('retrieveDx');

  public static examples = [
  `$ bin/run hardis:org:retrieve:dx --targetusername nicolas.vuillamy@gmail.com
  `
  ];

  protected static flagsConfig = {
    folder: flags.string({char: 'f', default: '.',  description: messages.getMessage('folder')}),
    tempfolder: flags.string({char: 't', default: '/tmp',  description: messages.getMessage('tempFolder')}),
    filteredmetadatas: flags.string({char: 'm', description: messages.getMessage('filteredMetadatas')}),
    prompt: flags.boolean({char: 'z', default: true, allowNo: true,  description: messages.getMessage('prompt')}),
    sandbox: flags.boolean({ char: 's', default: false, description: messages.getMessage('sandboxLogin')}),
    instanceurl: flags.string({char: 'r', default: 'https://login.saleforce.com',  description: messages.getMessage('instanceUrl')}),
    debug: flags.boolean({char: 'd', default: false, description: messages.getMessage('debugMode')})
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
    const filteredMetadatas = (this.flags.filteredmetadatas) ?
                                  this.flags.filteredmetadatas.split(',') :
                                  MetadataUtils.listMetadatasNotManagedBySfdx();
    const debug = this.flags.debug || false ;
    const username = this.org.getUsername();

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

    // Build package.xml for all org
    const packageXml = path.join(tempFolder, 'package.xml');
    if (!fs.existsSync(packageXml)) {
      this.ux.log(`[sfdx-hardis] Generating full package.xml from ${username}...`);
      const manifestRes = await exec('sfdx sfpowerkit:org:manifest:build -o package.xml');
      if (debug) {
        this.ux.log(manifestRes.stdout + manifestRes.stderr);
      }
    }

    // Filter package XML
    const filterRes = await filterPackageXml(packageXml, packageXml, filteredMetadatas);
    this.ux.log(filterRes.message);

    // Retrieve metadatas
    if (fs.readdirSync(metadataFolder).length === 0) {
      this.ux.log(`[sfdx-hardis] Retrieving metadatas from ${username} in ${metadataFolder}...`);
      const retrieveRes = await sfdx.mdapi.retrieve({
        retrievetargetdir : metadataFolder,
        unpackaged: './package.xml',
        wait: 60,
        verbose: debug,
        _quiet: !debug,
        _rejectOnError: true
      });
      if (debug) {
        this.ux.log(retrieveRes);
      }
      // Unzip metadatas
      this.ux.log('[sfdx-hardis] Unzipping metadatas...');
      await extractZip('./mdapipkg/unpackaged.zip', { dir: metadataFolder });
      await fs.unlink('./mdapipkg/unpackaged.zip');
      await fs.unlink('./package.xml');
    }

    // Create sfdx project
    if (fs.readdirSync(sfdxFolder).length === 0) {
      this.ux.log('[sfdx-hardis] Creating SFDX project...');
      const createProjectRes = await exec('sfdx force:project:create --projectname "sfdx-project"');
      if (debug) {
        this.ux.log(createProjectRes.stdout + createProjectRes.stderr);
      }
    }

    // Converting metadatas to sfdx
    this.ux.log(`[sfdx-hardis] Converting metadatas into SFDX sources in ${sfdxFolder}...`);
    process.chdir(sfdxFolder);
    try {
      const convertRes = await exec(`sfdx force:mdapi:convert --rootdir ${metadataFolder} ${(debug) ? '--verbose' : ''}`);
      if (debug) {
        this.ux.log(convertRes.stdout + convertRes.stderr);
      }
    } catch (e) {
      throw new SfdxError(JSON.stringify(e, null, 2));
    }

    // Move sfdx sources in main folder
    this.ux.log(`[sfdx-hardis] Moving temp files to main folder ${path.resolve(folder)}...`);
    process.chdir(prevCwd);
    await fs.copy(sfdxFolder, path.resolve(folder));
    // Remove temporary files
    await fs.rmdir(tempFolder, { recursive: true });

    // Set bac initial cwd

    return { orgId: this.org.getOrgId(), outputString: '' };
  }
}
