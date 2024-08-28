import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { GitProvider } from '../../../common/gitProvider/index.js';
import {
  checkDeploymentOrgCoverage,
  executePrePostCommands,
  extractOrgCoverageFromLog,
} from '../../../common/utils/deployUtils.js';
import { wrapSfdxCoreCommand } from '../../../common/utils/wrapUtils.js';
import { uxLog } from '../../../common/utils/index.js';

// Wrapper for sfdx force:source:deploy
export class Deploy extends SfCommand<any> {
  public static readonly description = `sfdx-hardis wrapper for sfdx force:source:deploy that displays tips to solve deployment errors.

Additional to the base command wrapper: If using **--checkonly**, add options **--checkcoverage** and **--coverageformatters json-summary** to check that org coverage is > 75% (or value defined in .sfdx-hardis.yml property **apexTestsMinCoverageOrgWide**)

### Deployment results

You can also have deployment results as pull request comments, on:

- GitHub (see [GitHub Pull Requests comments config](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-github/))
- Gitlab (see [Gitlab integration configuration](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-gitlab/))
- Azure DevOps (see [Azure integration configuration](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-azure/))


[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

### Deployment pre or post commands

You can define command lines to run before or after a deployment

If the commands are not the same depending on the target org, you can define them into **config/branches/.sfdx-hardis-BRANCHNAME.yml** instead of root **config/.sfdx-hardis.yml**

Example:

\`\`\`yaml
commandsPreDeploy:
  - id: knowledgeUnassign
    label: Remove KnowledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: knowledgeAssign
    label: Assign Knowledge user to the deployment user
    command: sf data update record --sobject User --where "Username='deploy.github@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json
commandsPostDeploy:
  - id: knowledgeUnassign
    label: Remove KnowledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: knowledgeAssign
    label: Assign Knowledge user to desired username
    command: sf data update record --sobject User --where "Username='admin-yser@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json
\`\`\`

Notes:

- You can disable coloring of errors in red by defining env variable SFDX_HARDIS_DEPLOY_ERR_COLORS=false

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_deploy)
`;
  public static readonly examples = [
    '$ sf hardis:source:deploy -x manifest/package.xml --wait 60 --ignorewarnings --testlevel RunLocalTests --postdestructivechanges ./manifest/destructiveChanges.xml --targetusername nicolas.vuillamy@cloudity.com.sfdxhardis --checkonly --checkcoverage --verbose --coverageformatters json-summary',
  ];
  public static readonly requiresProject = true;
  public static readonly flags = {
    checkonly: Flags.boolean({
      char: 'c',
      description: 'checkonly',
    }),
    soapdeploy: Flags.boolean({
      default: false,
      description: 'soapDeploy',
    }),
    wait: Flags.integer({
      char: 'w',
      default: 60,
      min: 0, // wait=0 means deploy is asynchronous
      description: 'wait',
    }),
    testlevel: Flags.string({
      char: 'l',
      description: 'testlevel',
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
      description: 'validateDeployRequestId',
      exclusive: [
        'manifest',
        'metadata',
        'sourcepath',
        'checkonly',
        'testlevel',
        'runtests',
        'ignoreerrors',
        'ignorewarnings',
      ],
    }),
    verbose: Flags.boolean({
      description: 'verbose',
    }),
    metadata: Flags.string({
      char: 'm',
      description: 'metadata',
      exclusive: ['manifest', 'sourcepath'],
      multiple: true,
    }),
    sourcepath: Flags.string({
      char: 'p',
      description: 'sourcePath',
      exclusive: ['manifest', 'metadata'],
      multiple: true,
    }),
    manifest: Flags.file({
      char: 'x',
      description: 'flagsLong.manifest',
      exclusive: ['metadata', 'sourcepath'],
    }),
    predestructivechanges: Flags.file({
      description: 'predestructivechanges',
      dependsOn: ['manifest'],
    }),
    postdestructivechanges: Flags.file({
      description: 'postdestructivechanges',
      dependsOn: ['manifest'],
    }),
    tracksource: Flags.boolean({
      char: 't',
      description: 'tracksource',
      exclusive: ['checkonly', 'validateddeployrequestid'],
    }),
    forceoverwrite: Flags.boolean({
      char: 'f',
      description: 'forceoverwrite',
      dependsOn: ['tracksource'],
    }),
    resultsdir: Flags.directory({
      description: 'resultsdir',
    }),
    coverageformatters: Flags.string({
      description: 'coverageformatters',
      multiple: true,
    }),
    junit: Flags.boolean({ description: 'junit' }),
    checkcoverage: Flags.boolean({ description: 'Check Apex org coverage' }),
    debug: Flags.boolean({
      default: false,
      description: 'debug',
    }),
    websocket: Flags.string({
      description: 'websocket',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };
  protected xorFlags = ['manifest', 'metadata', 'sourcepath', 'validateddeployrequestid'];

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
    // Run pre deployment commands if defined
    await executePrePostCommands('commandsPreDeploy', true);
    const result = await wrapSfdxCoreCommand('sfdx force:source:deploy', this.argv, this, flags.debug);
    // Check org coverage if requested
    if (flags.checkcoverage && result.stdout) {
      const orgCoveragePercent = await extractOrgCoverageFromLog(result.stdout + result.stderr || '');
      const checkOnly = flags.checkonly || false;
      if (orgCoveragePercent) {
        try {
          await checkDeploymentOrgCoverage(Number(orgCoveragePercent), { check: checkOnly });
        } catch (errCoverage) {
          await GitProvider.managePostPullRequestComment();
          throw errCoverage;
        }
      }
    }
    // Run post deployment commands if defined
    await executePrePostCommands('commandsPostDeploy', process.exitCode === 0);
    await GitProvider.managePostPullRequestComment();
    return result;
  }
}
