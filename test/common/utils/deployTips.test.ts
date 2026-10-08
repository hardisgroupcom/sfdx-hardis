import { expect } from 'chai';
import { analyzeDeployErrorLogs } from '../../../src/common/utils/deployTips.js';
// import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import { TestContext } from '@salesforce/core/testSetup';
import { getPullRequestData } from '../../../src/common/utils/gitUtils.js';
import { t } from '../../../src/common/utils/i18n.js';

describe('Deployment Tips', () => {

   const $$ = new TestContext();
   // eslint-disable-next-line @typescript-eslint/no-unused-vars
   //let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;

   beforeEach(() => {
      //  sfCommandStubs = stubSfCommandUx($$.SANDBOX);
   });

   afterEach(() => {
      $$.restore();
   });

   it('Finds a single issue in deployment output log', async () => {
      const sampleOutput = `
───── Deploying Metadata (dry-run) ─────
Stages:
1. Preparing
2. Waiting for the org to respond
3. Deploying Metadata
4. Running Tests
5. Updating Source Tracking
6. Done
▶ Preparing…
   Deploying (dry-run) v59.0 metadata to mathieu.rodrigues@oxxo.com.integ using the v62.0 SOAP API.
   Deploy ID: xxxx
   Target Org: mathieu.rodrigues@oxxo.com.integ
   Deploy URL: https://xxx-xxx-5344--integ.sandbox.my.salesforce.com/lightning/setup/DeployStatus/page?address=%2Fchangemgmt%2FmonitorDeploymentsDetails.apexp%3FasyncId%3D0AfKJ0000062A1M0AU%26retURL%3D%252Fchangemgmt%252FmonitorDeployment.apexp
   Size: 55.67 KB of ~39 MB limit
   Files: 34 of 10,000 limit
✔ Preparing (68ms)
◯ Waiting for the org to respond - Skipped
▶ Deploying Metadata…
   Components: 2/43 (5%)
   Components: 21/43 (49%)
   Components: 41/43 (95%)
✘ Deploying Metadata (11.83s)
   Components: 41/42 (98%)
Deploying (dry-run) v59.0 metadata to mathieu.rodrigues@oxxo.com.integ using the v62.0 SOAP API.
Status: Failed
Deploy ID: 0AfKJ0000062A1M0AU
Target Org: mathieu.rodrigues@xxx.com.integ
Deploy URL: https://xxx-xxx-5344--integ.sandbox.my.salesforce.com/lightning/setup/DeployStatus/page?address=%2Fchangemgmt%2FmonitorDeploymentsDetails.apexp%3FasyncId%3D0AfKJ0000062A1M0AU%26retURL%3D%252Fchangemgmt%252FmonitorDeployment.apexp
Size: 55.67 KB of ~39 MB limit
Files: 34 of 10,000 limit
Elapsed time: 11.90s
Component Failures [1]
 Type   Name          Problem                                                 Line:Column 
------------------------------------------------------------------------------------------
 Error  Sales_Leader  FormFactors must be Large for Salesforce Classic apps.              
Test Results Summary
Passing: 0
Failing: 0
Total: 0
Code Coverage formats, [json-summary], written to coverage/coverage/
Dry-run complete.
Warning: GlobalValueSet, SousFamille__gvs, returned from org, but not found in the local project
Warning: GlobalValueSet, Fonction__gvs, returned from org, but not found in the local project    
    `;
      const { errorsAndTips } = await analyzeDeployErrorLogs(sampleOutput, true, { check: true });
      expect(errorsAndTips).to.be.length.greaterThanOrEqual(1);
   });

   it('Add default issue in case of problem parsing error output', async () => {
      const sampleOutput = `───── Deploying Metadata (dry-run) ─────
Stages:
1. Preparing
2. Waiting for the org to respond
3. Deploying Metadata
4. Running Tests
5. Updating Source Tracking
6. Done
▶ Preparing…
   Deploying (dry-run) v59.0 metadata to mathieu.rodrigues@oxxo.com.integ using the v62.0 SOAP API.
   Deploy ID: 0AfKJ0000063Eq60AE
   Target Org: mathieu.rodrigues@xxx.com.integ
   Deploy URL: https://xxx-xxx-5344--integ.sandbox.my.salesforce.com/lightning/setup/DeployStatus/page?address=%2Fchangemgmt%2FmonitorDeploymentsDetails.apexp%3FasyncId%3D0AfKJ0000063Eq60AE%26retURL%3D%252Fchangemgmt%252FmonitorDeployment.apexp
   Size: 55.67 KB of ~39 MB limit
   Files: 34 of 10,000 limit
✔ Preparing (65ms)
▶ Waiting for the org to respond…
✔ Waiting for the org to respond (3.03s)
▶ Deploying Metadata…
   Components: 6/43 (14%)
   Components: 21/43 (49%)
   Components: 40/43 (93%)
✘ Deploying Metadata (11.29s)
   Components: 40/42 (95%)
Deploying (dry-run) v59.0 metadata to mathieu.rodrigues@oxxo.com.integ using the v62.0 SOAP API.
Status: Failed
Deploy ID: 0AfKJ0000063Eq60AE
Target Org: mathieu.rodrigues@xxx.com.integ
Deploy URL: https://xxx-xxx-5344--integ.sandbox.my.salesforce.com/lightning/setup/DeployStatus/page?address=%2Fchangemgmt%2FmonitorDeploymentsDetails.apexp%3FasyncId%3D0AfKJ0000063Eq60AE%26retURL%3D%252Fchangemgmt%252FmonitorDeployment.apexp
Size: 55.67 KB of ~39 MB limit
Files: 34 of 10,000 limit
Elapsed time: 14.39s
Component Failures [2]
 Type               Name                                                     Problem                                                            Line:Column 
------------------------------------------------------------------------------------------------------------------------------------------------------------
 MatchingRule       Lead.Rule_correspondance_Rule_duplication_Pistes_Sample  Before you change a matching rule, you must deactivate it. (3:20)  3:20        
 CustomApplication  Sales_Leader                                             FormFactors must be Large for Salesforce Classic apps.                         
Test Results Summary
Passing: 0
Failing: 0
Total: 0
Code Coverage formats, [json-summary], written to coverage/coverage/
Dry-run complete.`;
      const { errorsAndTips } = await analyzeDeployErrorLogs(sampleOutput, true, { check: true });
      expect(errorsAndTips).to.be.length.greaterThanOrEqual(1);
   });

   // Output of sf project deploy start --json when Salesforce could not be reached: no result block
   const networkFailureJson = {
      name: 'TypeError',
      message: 'fetch failed',
      exitCode: 10,
      context: 'DeployMetadata',
      stack: 'TypeError: fetch failed\n    at SfCommandError.from (file:///usr/lib/node_modules/@salesforce/cli/node_modules/@salesforce/sf-plugins-core/lib/SfCommandError.js:48:16)\n    at DeployMetadata.catch (file:///usr/lib/node_modules/@salesforce/cli/node_modules/@salesforce/sf-plugins-core/lib/sfCommand.js:333:47)',
      cause: [
         'TypeError: fetch failed',
         '    at Object.processResponse (/usr/lib/node_modules/@salesforce/cli/node_modules/@jsforce/jsforce-node/node_modules/undici/lib/web/fetch/index.js:271:16)',
         '    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)',
         '    at async fetchWithRetries (/usr/lib/node_modules/@salesforce/cli/node_modules/@jsforce/jsforce-node/lib/request.js:111:25)',
         '    at async startFetchRequest (/usr/lib/node_modules/@salesforce/cli/node_modules/@jsforce/jsforce-node/lib/request.js:159:15) {',
         '  [cause]: ConnectTimeoutError: Connect Timeout Error (attempted address: orgfarm-xxx.my.salesforce.com:443, timeout: 10000ms)',
         '      at onConnectTimeout (/usr/lib/node_modules/@salesforce/cli/node_modules/@jsforce/jsforce-node/node_modules/undici/lib/core/util.js:924:19)',
         '      at process.processImmediate (node:internal/timers:504:21) {',
         "    code: 'UND_ERR_CONNECT_TIMEOUT'",
         '  }',
         '}',
      ].join('\n'),
      warnings: [],
      code: '10',
      status: 10,
      commandName: 'DeployMetadata',
   };

   it('Reports a lost connection to Salesforce as a network error, not as a parsing issue', async () => {
      const log = `[sfdx-hardis] Sadly there has been Deployment error(s)\n${JSON.stringify(networkFailureJson, null, 2)}\n`;
      const { errorsAndTips, errLog } = await analyzeDeployErrorLogs(log, true, { check: true });
      expect(errorsAndTips).to.have.length(1);
      expect(errorsAndTips[0].tip.label).to.equal('NetworkError');
      expect(errorsAndTips[0].error.message).to.equal(
         'Connection to Salesforce lost: Connect Timeout Error (attempted address: orgfarm-xxx.my.salesforce.com:443, timeout: 10000ms) [UND_ERR_CONNECT_TIMEOUT]'
      );
      expect(errorsAndTips[0].tip.message).to.contain('run the job again');
      expect(errorsAndTips[0].error.message).to.not.contain(' at ');
      expect(errLog).to.contain('Connection to Salesforce lost');
      expect(errLog).to.not.contain('There has been an issue parsing errors');
      const prData = getPullRequestData();
      expect(prData.networkErrorsCount).to.equal(1);
      expect(prData.errorCount).to.equal(1);
      expect(prData.deployErrorsMarkdownBody).to.contain('⛔ Connection to Salesforce lost: Connect Timeout Error (attempted address');
      expect(prData.deployErrorsMarkdownBody).to.contain('✏️ NetworkError');
   });

   it('Reports a top-level message that is not a network failure as an unknown error', async () => {
      const json = { name: 'SfError', message: 'The org is locked by another deployment', exitCode: 1, status: 1, warnings: [] };
      const { errorsAndTips, errLog } = await analyzeDeployErrorLogs(JSON.stringify(json, null, 2), true, { check: true });
      expect(errorsAndTips).to.have.length(1);
      expect(errorsAndTips[0].error.message).to.equal('The org is locked by another deployment');
      expect(errorsAndTips[0].tip.label).to.equal('SfError');
      expect(errorsAndTips[0].tip.message).to.equal(t('pleaseFixUnknownErrors'));
      expect(errLog).to.contain('Unknown issue: The org is locked by another deployment');
      expect(getPullRequestData().networkErrorsCount).to.equal(0);
   });

   it('Keeps the result.errorMessage fallback and the parsing issue fallback', async () => {
      const withResult = { status: 1, result: { status: 'Failed', errorMessage: 'INVALID_CROSS_REFERENCE_KEY', errorStatusCode: 'INVALID_CROSS_REFERENCE_KEY' } };
      const fromResult = await analyzeDeployErrorLogs(JSON.stringify(withResult), true, { check: true });
      expect(fromResult.errorsAndTips).to.have.length(1);
      expect(fromResult.errorsAndTips[0].tip.label).to.equal('INVALID_CROSS_REFERENCE_KEY');
      expect(fromResult.errorsAndTips[0].error.message).to.equal('INVALID_CROSS_REFERENCE_KEY');
      // A JSON with nothing to read at all
      const unknown = await analyzeDeployErrorLogs(JSON.stringify({ status: 1, warnings: [] }), true, { check: true });
      expect(unknown.errorsAndTips).to.have.length(1);
      expect(unknown.errorsAndTips[0].tip.label).to.equal('SfdxHardisInternalError');
   });

   it('Reports a lost connection in an output without JSON as a network error', async () => {
      const log = 'Deploying v62.0 metadata to user@example.com using the v62.0 SOAP API.\nError (TypeError): fetch failed\n';
      const { errorsAndTips } = await analyzeDeployErrorLogs(log, true, { check: true });
      expect(errorsAndTips).to.have.length(1);
      expect(errorsAndTips[0].tip.label).to.equal('NetworkError');
      expect(errorsAndTips[0].error.message).to.equal('Connection to Salesforce lost: fetch failed');
   });

});