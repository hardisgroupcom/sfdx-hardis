/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import c from 'chalk';
import { AnyJson } from '@salesforce/ts-types';
import { wrapSfdxCoreCommand } from '../../../common/utils/wrapUtils.js';
import { uxLog } from '../../../common/utils/index.js';

export default class Push extends SfCommand<any> {
  public static readonly description = `sfdx-hardis wrapper for sfdx force:source:push that displays tips to solve deployment errors.

[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_push)
`;
  public static readonly flags: any = {
    forceoverwrite: Flags.boolean({
      char: 'f',
      description: 'forceoverwrite',
    }),
    wait: Flags.integer({
      char: 'w',
      default: 60,
      min: 1,
      description: 'wait',
    }),
    ignorewarnings: Flags.boolean({
      char: 'g',
      description: 'ignorewarnings',
    }),
    quiet: Flags.boolean({
      description: 'quiet',
    }),
    debug: Flags.boolean({
      default: false,
      description: 'debug',
    }),
    websocket: Flags.string({
      description: 'websocket',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(Push);
    uxLog(this, c.red('This command will be removed by Salesforce in November 2024.'));
    uxLog(this, c.red('Please migrate to command sf hardis project deploy start'));
    uxLog(
      this,
      c.red(
        'See https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_mig_deploy_retrieve.htm'
      )
    );
    return await wrapSfdxCoreCommand('sfdx force:source:push', this.argv, this, flags.debug);
  }
}
/* jscpd:ignore-end */