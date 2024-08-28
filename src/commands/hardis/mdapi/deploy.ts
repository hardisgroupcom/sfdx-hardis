/* jscpd:ignore-start */
import { Flags, requiredOrgFlagWithDeprecations, SfCommand } from '@salesforce/sf-plugins-core';
import c from 'chalk';
import { AnyJson } from '@salesforce/ts-types';
import { wrapSfdxCoreCommand } from '../../../common/utils/wrapUtils.js';
import { uxLog } from '../../../common/utils/index.js';

const xorFlags = ['zipfile', 'validateddeployrequestid', 'deploydir'];
export class Deploy extends SfCommand<any> {
  public static readonly description = `sfdx-hardis wrapper for sfdx force:mdapi:deploy that displays tips to solve deployment errors.

[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_mdapi.htm#cli_reference_force_mdapi_deploy)
`;
  public static readonly examples = [];
  public static readonly flagsConfig = {
    checkonly: Flags.boolean({
      char: 'c',
      description: 'checkOnly',
    }),
    deploydir: Flags.directory({
      char: 'd',
      description: 'deployDir',
      exactlyOne: xorFlags,
    }),
    wait: Flags.integer({
      char: 'w',
      description: 'wait',
      default: 120,
      min: -1,
    }),
    testlevel: Flags.string({
      char: 'l',
      description: 'testLevel',
      options: ['NoTestRun', 'RunSpecifiedTests', 'RunLocalTests', 'RunAllTestsInOrg'],
      default: 'NoTestRun',
    }),
    runtests: Flags.string({
      char: 'r',
      description: 'runTests',
      default: [],
      multiple: true,
    }),
    ignoreerrors: Flags.boolean({
      char: 'o',
      description: 'ignoreErrors',
    }),
    ignorewarnings: Flags.boolean({
      char: 'g',
      description: 'ignoreWarnings',
    }),
    validateddeployrequestid: Flags.string({
      char: 'q',
      description: 'validatedDeployRequestId',
      exactlyOne: xorFlags,
      exclusive: ['testlevel', 'runtests', 'ignoreerrors', 'ignorewarnings', 'checkonly'],
    }),
    verbose: Flags.boolean({
      description: 'verbose',
    }),
    zipfile: Flags.file({
      char: 'f',
      description: 'zipFile',
      exactlyOne: xorFlags,
    }),
    singlepackage: Flags.boolean({
      char: 's',
      description: 'singlePackage',
    }),
    soapdeploy: Flags.boolean({
      description: 'soapDeploy',
    }),
    purgeondelete: Flags.boolean({
      description: 'purgeOnDelete',
    }),
    concise: Flags.boolean({
      description: 'concise',
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
  /* jscpd:ignore-end */
  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(Deploy);
    uxLog(this, c.red('This command will be removed by Salesforce in November 2024.'));
    uxLog(this, c.red('Please migrate to command sf hardis project deploy start'));
    uxLog(
      this,
      c.red(
        'See https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_mig_deploy_retrieve.htm'
      )
    );
    return await wrapSfdxCoreCommand('sfdx force:mdapi:deploy', this.argv, this, flags.debug);
  }
}
