import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyReplacementRules } from '../../../src/common/replacementRules/ruleEngine.js';
import { restoreLeftoverReplacementFiles } from '../../../src/common/replacementRules/fileBackup.js';
import { buildReplacementRulesMarkdown } from '../../../src/common/replacementRules/replacementReport.js';
import { clearListMajorOrgsCache } from '../../../src/common/utils/orgConfigUtils.js';
import { clearRegisteredSecrets, redactSecrets } from '../../../src/common/utils/secretMaskingUtils.js';

const NAMED_CREDENTIAL = `<?xml version="1.0" encoding="UTF-8"?>
<NamedCredential xmlns="http://soap.sforce.com/2006/04/metadata">
    <endpoint>https://dev.example.com</endpoint>
    <label>Payment API</label>
    <password>from-git</password>
</NamedCredential>
`;
const FLOW = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <areMetricsLoggedToDataCloud>false</areMetricsLoggedToDataCloud>
    <ends>
        <name>The_End</name>
    </ends>
    <recordLookups>
        <name>Get_Cases</name>
        <limit>5</limit>
        <connector>
            <targetReference>The_End</targetReference>
        </connector>
    </recordLookups>
</Flow>
`;
const APEX = `public class PaymentService {
    static final String HOST = 'https://pay-dev.example.com';
    static final String OTHER = 'https://pay-dev.example.com/v2';
}
`;
const LAYOUT = `<?xml version="1.0" encoding="UTF-8"?>
<Layout xmlns="http://soap.sforce.com/2006/04/metadata">
    <platformActionList>
        <actionListContext>Record</actionListContext>
    </platformActionList>
</Layout>
`;

const PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
    <custom>true</custom>
    <userPermissions>
        <enabled>true</enabled>
        <name>ApiEnabled</name>
    </userPermissions>
    <userPermissions>
        <enabled>true</enabled>
        <name>NotInThisOrg</name>
    </userPermissions>
    <userPermissions>
        <enabled>true</enabled>
        <name>ViewSetup</name>
    </userPermissions>
</Profile>
`;

describe('replacement rules - engine', () => {
  let previousCwd: string;
  let projectDir: string;
  const files = {
    namedCredential: 'force-app/main/default/namedCredentials/Payment_API.namedCredential-meta.xml',
    flow: 'force-app/main/default/flows/Get_Cases.flow-meta.xml',
    apex: 'force-app/main/default/classes/PaymentService.cls',
    layout: 'force-app/main/default/layouts/Case-Case Layout.layout-meta.xml',
  };
  const read = (file: string) => fs.readFileSync(path.join(projectDir, file), 'utf8');
  const writeConfig = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(projectDir, file)), { recursive: true });
    fs.writeFileSync(path.join(projectDir, file), content);
  };

  beforeEach(() => {
    previousCwd = process.cwd();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdx-hardis-rr-'));
    writeConfig('sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '68.0' }));
    writeConfig(files.namedCredential, NAMED_CREDENTIAL);
    writeConfig(files.flow, FLOW);
    writeConfig(files.apex, APEX);
    writeConfig(files.layout, LAYOUT);
    writeConfig('config/branches/.sfdx-hardis.uat.yml', `targetUsername: uat@example.com
replacementRules:
  - id: uat-hide-case-actions
    type: xml-remove
    files: "**/layouts/Case-*.layout-meta.xml"
    xmlPath: Layout/platformActionList
`);
    writeConfig('config/branches/.sfdx-hardis.main.yml', 'targetUsername: prod@example.com\n');
    writeConfig('config/.sfdx-hardis.yml', `projectName: test
replacementRules:
  - id: payment-api-endpoint
    type: xml-value
    files: "**/namedCredentials/Payment_API.namedCredential-meta.xml"
    xmlPath: NamedCredential/endpoint
    values:
      uat: https://uat.example.com
      main: https://prod.example.com
      default: https://sandbox.example.com
    required: true
  - id: payment-api-password
    type: xml-value
    files: "**/namedCredentials/Payment_API.namedCredential-meta.xml"
    xmlPath: NamedCredential/password
    secret: RR_TEST_PASSWORD
  - id: apex-payment-host
    type: text
    files: "**/classes/PaymentService.cls"
    find: 'https://pay-[a-z]+\\.example\\.com'
    regex: true
    values:
      main: https://pay.example.com
  - id: missing-element
    type: xml-value
    files: "**/namedCredentials/*.namedCredential-meta.xml"
    xmlPath: NamedCredential/certificate
    value: x
    required: true
`);
    process.chdir(projectDir);
    clearListMajorOrgsCache();
    clearRegisteredSecrets();
    delete process.env.RR_TEST_PASSWORD;
    delete process.env.RR_TEST_PASSWORD_UAT;
  });

  afterEach(() => {
    process.chdir(previousCwd);
    clearListMajorOrgsCache();
    clearRegisteredSecrets();
    delete process.env.RR_TEST_PASSWORD;
    delete process.env.RR_TEST_PASSWORD_UAT;
    delete process.env.SFDX_HARDIS_SKIP_REPLACEMENT_RULES;
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('applies the values of a major branch, then restores the files', async () => {
    process.env.RR_TEST_PASSWORD_UAT = 'p@ss$word-uat';
    const session = await applyReplacementRules({ targetBranch: 'uat', apiVersion: 68, write: true, readIssue: false });
    expect(read(files.namedCredential)).to.include('<endpoint>https://uat.example.com</endpoint>');
    expect(read(files.namedCredential)).to.include('<password>p@ss$word-uat</password>');
    expect(read(files.namedCredential)).to.match(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(read(files.layout)).to.not.include('platformActionList');
    // No value for uat and no default: the Apex class is left as in git
    expect(read(files.apex)).to.equal(APEX);
    // API 68: the built-in rules do not apply
    expect(read(files.flow)).to.equal(FLOW);
    const report = session.report;
    expect(report.target.targetBranch).to.equal('uat');
    expect(report.appliedRules.map((rule) => rule.id).sort()).to.deep.equal(['payment-api-endpoint', 'payment-api-password', 'uat-hide-case-actions']);
    expect(report.warnings.map((warning) => warning.kind)).to.deep.equal(['required-no-match']);
    // The secret is masked everywhere
    expect(redactSecrets('value p@ss$word-uat here')).to.equal('value *** here');
    expect(JSON.stringify(report)).to.not.include('p@ss$word-uat');
    expect(buildReplacementRulesMarkdown(report)).to.not.include('p@ss$word-uat');

    expect(session.restore()).to.equal(2);
    expect(read(files.namedCredential)).to.equal(NAMED_CREDENTIAL);
    expect(read(files.layout)).to.equal(LAYOUT);
  });

  it('uses the default values for a dev sandbox and warns about a missing secret', async () => {
    const session = await applyReplacementRules({ targetBranch: 'feature/my-story', apiVersion: 68, write: true, readIssue: false });
    expect(session.report.target.targetBranch).to.equal(null);
    expect(read(files.namedCredential)).to.include('<endpoint>https://sandbox.example.com</endpoint>');
    expect(read(files.namedCredential)).to.include('<password>from-git</password>');
    expect(read(files.layout)).to.equal(LAYOUT);
    const secretWarning = session.report.warnings.find((warning) => warning.kind === 'secret-missing');
    expect(secretWarning?.message).to.include('RR_TEST_PASSWORD');
    const markdown = buildReplacementRulesMarkdown(session.report);
    expect(markdown).to.include('<details open>');
    expect(markdown).to.include('RR_TEST_PASSWORD');
    session.restore();
    expect(read(files.namedCredential)).to.equal(NAMED_CREDENTIAL);
  });

  it('applies text rules and built-in rules for an older production org', async () => {
    process.env.RR_TEST_PASSWORD = 'generic-secret';
    const session = await applyReplacementRules({ targetBranch: 'main', apiVersion: 62, write: true, readIssue: false });
    expect(read(files.apex)).to.include("'https://pay.example.com'");
    expect(read(files.apex)).to.include("'https://pay.example.com/v2'");
    const flow = read(files.flow);
    expect(flow).to.not.include('<ends>');
    expect(flow).to.not.include('The_End');
    expect(flow).to.not.include('areMetricsLoggedToDataCloud');
    // Disabled by default: kept, with a warning that the deployment will fail
    expect(flow).to.include('<limit>5</limit>');
    const risky = session.report.warnings.find((warning) => warning.kind === 'risky-element');
    expect(risky?.ruleId).to.equal('builtin-flow-get-records-limit');
    expect(session.report.appliedRules.map((rule) => rule.id)).to.include.members(['builtin-flow-ends', 'builtin-flow-metrics-data-cloud', 'apex-payment-host']);
    session.restore();
    expect(read(files.flow)).to.equal(FLOW);
    expect(read(files.apex)).to.equal(APEX);
  });

  it('turns a built-in rule off from the project config', async () => {
    writeConfig('config/.sfdx-hardis.yml', `replacementRules:
  - id: builtin-flow-ends
    enabled: false
`);
    const session = await applyReplacementRules({ targetBranch: 'main', apiVersion: 67, write: true, readIssue: false });
    expect(read(files.flow)).to.include('<ends>');
    session.restore();
  });

  it('previews without writing anything', async () => {
    const session = await applyReplacementRules({ targetBranch: 'main', apiVersion: 67, write: false, readIssue: false });
    expect(read(files.namedCredential)).to.equal(NAMED_CREDENTIAL);
    expect(read(files.flow)).to.equal(FLOW);
    const changed = session.report.results.filter((result) => result.status === 'changed').map((result) => result.ruleId);
    expect(changed).to.include.members(['payment-api-endpoint', 'builtin-flow-ends', 'apex-payment-host']);
    expect(session.restore()).to.equal(0);
  });

  it('only processes the files of the package.xml when given', async () => {
    writeConfig('package.xml', `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types><members>Get_Cases</members><name>Flow</name></types>
    <version>62.0</version>
</Package>
`);
    const session = await applyReplacementRules({ targetBranch: 'main', apiVersion: 67, write: true, readIssue: false, packageXmlFiles: ['package.xml'] });
    expect(read(files.namedCredential)).to.equal(NAMED_CREDENTIAL);
    expect(read(files.flow)).to.not.include('<ends>');
    session.restore();
  });

  it('restores the files left changed by a killed run', async () => {
    await applyReplacementRules({ targetBranch: 'uat', apiVersion: 68, write: true, readIssue: false });
    expect(read(files.layout)).to.not.include('platformActionList');
    // The process "died" without restoring: the next run repairs the folder first
    expect(restoreLeftoverReplacementFiles()).to.equal(2);
    expect(read(files.layout)).to.equal(LAYOUT);
  });

  it('reads the metadata with the lowest of the org, project and package.xml versions', async () => {
    writeConfig('sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '64.0' }));
    writeConfig('package.xml', `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types><members>Get_Cases</members><name>Flow</name></types>
    <version>62.0</version>
</Package>
`);
    const session = await applyReplacementRules({ targetBranch: 'main', write: false, readIssue: false, packageXmlFiles: ['package.xml'] });
    expect(session.report.target.apiVersion).to.equal(62);
    expect(session.report.results.some((result) => result.ruleId === 'builtin-flow-metrics-data-cloud' && result.status === 'changed')).to.equal(true);
  });

  it('never restores the files of another run during a preview', async () => {
    await applyReplacementRules({ targetBranch: 'uat', apiVersion: 68, write: true, readIssue: false });
    expect(read(files.layout)).to.not.include('platformActionList');
    await applyReplacementRules({ targetBranch: 'uat', apiVersion: 68, write: false, readIssue: false });
    // The preview left the files of the running deployment alone
    expect(read(files.layout)).to.not.include('platformActionList');
    expect(restoreLeftoverReplacementFiles()).to.equal(2);
  });

  it('removes the user permissions the target org does not have, read from its PermissionSet describe', async () => {
    writeConfig('force-app/main/default/profiles/Sales.profile-meta.xml', PROFILE);
    const conn: any = {
      retrieveMaxApiVersion: async () => '68.0',
      sobject: () => ({ describe: async () => ({ fields: [{ name: 'Id' }, { name: 'PermissionsApiEnabled' }, { name: 'PermissionsViewSetup' }] }) }),
    };
    const session = await applyReplacementRules({ targetBranch: 'main', conn, write: true, readIssue: false });
    const profile = read('force-app/main/default/profiles/Sales.profile-meta.xml');
    expect(profile).to.include('<name>ApiEnabled</name>');
    expect(profile).to.include('<name>ViewSetup</name>');
    expect(profile).to.not.include('NotInThisOrg');
    expect(session.report.appliedRules.map((rule) => rule.id)).to.include('builtin-unknown-user-permissions');
    session.restore();
  });

  it('removes the user permissions unknown to the API version when the org cannot be described', async () => {
    writeConfig('force-app/main/default/profiles/Sales.profile-meta.xml', PROFILE.replace('NotInThisOrg', 'AutomatedDealTracking'));
    // AutomatedDealTracking was removed in API 65
    const session = await applyReplacementRules({ targetBranch: 'main', apiVersion: 66, write: false, readIssue: false });
    const result = session.report.results.find((item) => item.ruleId === 'builtin-unknown-user-permissions');
    expect(result?.status).to.equal('changed');
    expect(result?.count).to.equal(1);
  });

  it('skips everything with SFDX_HARDIS_SKIP_REPLACEMENT_RULES=true', async () => {
    process.env.SFDX_HARDIS_SKIP_REPLACEMENT_RULES = 'true';
    const session = await applyReplacementRules({ targetBranch: 'main', apiVersion: 60, write: true, readIssue: false });
    expect(session.report.skipped).to.equal('env');
    expect(read(files.flow)).to.equal(FLOW);
    expect(buildReplacementRulesMarkdown(session.report)).to.include('skipped');
  });
});
