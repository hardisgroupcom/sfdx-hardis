import { expect } from 'chai';
import { buildIssueBody, parseIssueRules } from '../../../src/common/replacementRules/issueRulesStore.js';
import { CiVariablesSecretsProvider } from '../../../src/common/secretsProvider/ciVariablesSecretsProvider.js';
import { clearRegisteredSecrets, redactSecrets, redactSecretsDeep, registerSecretValue } from '../../../src/common/utils/secretMaskingUtils.js';
import { ReplacementRule } from '../../../src/common/replacementRules/types.js';

const rules: ReplacementRule[] = [
  { id: 'partner-site-admin', type: 'xml-value', files: '**/sites/*.site-meta.xml', xmlPath: 'CustomSite/siteAdmin', values: { main: 'admin@example.com', default: 'admin@example.com.sandbox' } },
  { id: 'builtin-flow-ends', enabled: false },
];

describe('replacement rules - issue body', () => {
  it('round-trips the rules through a Markdown body', () => {
    const body = buildIssueBody(rules, 'markdown');
    expect(body).to.include('```yaml');
    expect(parseIssueRules(body, 'markdown')).to.deep.equal(rules);
  });

  it('round-trips the rules through an Azure DevOps HTML body', () => {
    const body = buildIssueBody(rules, 'html');
    expect(body).to.include('<pre><code>');
    expect(parseIssueRules(body, 'html')).to.deep.equal(rules);
  });

  it('reads YAML damaged into lines by a rich text editor', () => {
    const body = '<div><pre>replacementRules:<br>  - id: x<br>    enabled: false<br></pre></div>';
    expect(parseIssueRules(body, 'html')).to.deep.equal([{ id: 'x', enabled: false }]);
  });

  it('returns no rule without a YAML block, and fails on invalid YAML', () => {
    expect(parseIssueRules('Just a text', 'markdown')).to.deep.equal([]);
    expect(() => parseIssueRules('```yaml\nreplacementRules: [\n```', 'markdown')).to.throw();
  });
});

describe('replacement rules - secrets', () => {
  afterEach(() => {
    clearRegisteredSecrets();
    delete process.env.MY_SECRET;
    delete process.env.MY_SECRET_UAT;
    delete process.env.MY_SECRET_RELEASE__UAT;
  });

  it('looks up NAME_<BRANCH> then NAME', async () => {
    const provider = new CiVariablesSecretsProvider();
    expect(provider.describeLookup('MY_SECRET', 'uat')).to.deep.equal(['MY_SECRET_uat', 'MY_SECRET_UAT', 'MY_SECRET']);
    expect(provider.describeLookup('MY_SECRET', 'release/uat')).to.deep.equal(['MY_SECRET_release__uat', 'MY_SECRET_RELEASE__UAT', 'MY_SECRET']);
    expect(provider.describeLookup('MY_SECRET', 'hot-fix')).to.deep.equal(['MY_SECRET_hot-fix', 'MY_SECRET_HOT-FIX', 'MY_SECRET_HOT_FIX', 'MY_SECRET']);
    expect(provider.describeLookup('MY_SECRET', null)).to.deep.equal(['MY_SECRET']);
    process.env.MY_SECRET = 'generic';
    process.env.MY_SECRET_UAT = 'uat-value';
    expect((await provider.getSecret('MY_SECRET', 'uat')).value).to.equal('uat-value');
    // Windows environment variable names ignore case: MY_SECRET_uat finds MY_SECRET_UAT there
    expect(String((await provider.getSecret('MY_SECRET', 'uat')).source).toUpperCase()).to.equal('MY_SECRET_UAT');
    expect((await provider.getSecret('MY_SECRET', 'main')).value).to.equal('generic');
    delete process.env.MY_SECRET;
    expect((await provider.getSecret('MY_SECRET', 'main')).value).to.equal(null);
  });

  it('redacts registered secrets, longest first, line by line', () => {
    registerSecretValue('abc');
    registerSecretValue('abcdef');
    registerSecretValue('line-one\nline-two');
    expect(redactSecrets('x abcdef y abc z')).to.equal('x *** y *** z');
    expect(redactSecrets('line-two alone')).to.equal('*** alone');
    expect(redactSecretsDeep({ a: ['abc'], b: { c: 'abcdef' }, n: 1 })).to.deep.equal({ a: ['***'], b: { c: '***' }, n: 1 });
  });

  it('does not redact values too short to be meaningful', () => {
    registerSecretValue('ab');
    expect(redactSecrets('ab cd')).to.equal('ab cd');
  });
});
