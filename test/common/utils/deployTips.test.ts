import { expect } from 'chai';
import { analyzeDeployErrorLogs } from '../../../src/common/utils/deployTips.js';
// import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import { TestContext } from '@salesforce/core/testSetup';

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
 MatchingRule       Lead.Regle_correspondance_Regle_duplication_Pistes_OXXO  Before you change a matching rule, you must deactivate it. (3:20)  3:20        
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

});