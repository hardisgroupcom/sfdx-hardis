/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';

import { execCommand, uxLog } from '../../../../../common/utils/index.js';
import { promptOrg } from '../../../../../common/utils/orgUtils.js';
import { prompts } from '../../../../../common/utils/prompts.js';
import { PACKAGE_ROOT_DIR } from '../../../../../settings.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DxSources2 extends SfCommand<any> {
  public static title = 'Retrieve sfdx sources from org (2)';

  public static description = messages.getMessage('retrieveDx');

  public static examples = ['$ sf hardis:org:retrieve:sources:dx2'];

  public static flags = {
    packagexml: Flags.string({
      char: 'x',
      description: 'Path to package.xml file',
    }),
    template: Flags.string({
      char: 't',
      description: 'sfdx-hardis package.xml Template name. ex: wave',
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
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DxSources2);
    let packageXml = flags.packagexml || null;
    let targetUsername = flags['target-org'] || null;
    const template = flags.template || null;
    this.debugMode = flags.debug || false;

    // Prompt for organization if not sent
    if (targetUsername == null) {
      const org = await promptOrg(this, { setDefault: false });
      targetUsername = org.username;
    }

    // Use package.xml template provided by sfdx-hardis
    if (template) {
      packageXml = path.join(PACKAGE_ROOT_DIR, `ref`, `${template}-package.xml`);
    }

    // Prompt for package.xml if not sent
    if (packageXml === null) {
      const packageXmlRes = await prompts({
        message: c.cyanBright('Please input the path to the package.xml file to use force sf project retrieve start'),
        type: 'text',
        name: 'value',
      });
      packageXml = packageXmlRes.value;
    }

    // Check package.xml file exists
    if (!fs.existsSync(packageXml || '')) {
      throw new SfError(c.red('Package.xml file not found at ' + packageXml));
    }
    // Copy package.xml in /tmp if provided value is not within project
    if (!path.resolve(packageXml || '').includes(path.resolve(process.cwd()))) {
      const packageXmlTmp = path.join(process.cwd(), 'tmp', 'retrievePackage.xml');
      await fs.ensureDir(path.dirname(packageXmlTmp));
      await fs.copy(packageXml || '', packageXmlTmp);
      uxLog(this, c.grey(`Copied ${packageXml} to ${packageXmlTmp}`));
      packageXml = path.relative(process.cwd(), packageXmlTmp);
    }

    // Retrieve sources
    const retrieveCommand = 'sf project retrieve start' + ` -x "${packageXml}"` + ` -o ${targetUsername}`;
    await execCommand(retrieveCommand, this, { fail: false, debug: this.debugMode, output: true });

    // Set bac initial cwd
    const message = `[sfdx-hardis] Successfully retrieved sfdx sources from ${c.bold(targetUsername)} using ${c.bold(
      packageXml
    )}`;
    uxLog(this, c.green(message));
    return { outputString: message };
  }
}
