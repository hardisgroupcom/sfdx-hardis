/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { MetadataUtils } from '../../../../common/metadata-utils/index.js';
import { uxLog } from '../../../../common/utils/index.js';
import { managePackageConfig, promptOrg } from '../../../../common/utils/orgUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class RetrievePackageConfig extends SfCommand<any> {
  public static title = 'Retrieve package configuration from an org';

  public static description = 'Retrieve package configuration from an org';

  public static examples = ['$ sf hardis:org:retrieve:packageconfig', 'sf hardis:org:retrieve:packageconfig -u myOrg'];

  public static flags: any = {
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
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(RetrievePackageConfig);
    let targetUsername = flags['target-org'].getUsername() || null;

    // Prompt for organization if not sent
    if (targetUsername == null) {
      const org = await promptOrg(this, { setDefault: false });
      targetUsername = org.username;
    }

    // Retrieve list of installed packages
    const installedPackages = await MetadataUtils.listInstalledPackages(targetUsername || '', this);

    // Store list in config
    const updateConfigRes = await prompts({
      type: 'confirm',
      name: 'value',
      message: c.cyanBright('Do you want to update your project configuration with this list of packages ?'),
    });
    if (updateConfigRes.value === true) {
      await managePackageConfig(installedPackages, installedPackages, true);
    }

    const message = `[sfdx-hardis] Successfully retrieved package config`;
    uxLog(this, c.green(message));
    return { orgId: flags['target-org'].getOrgId(), outputString: message };
  }
}
