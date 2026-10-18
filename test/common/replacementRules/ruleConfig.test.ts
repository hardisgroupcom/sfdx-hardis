import { expect } from 'chai';
import {
  cleanRuleForStorage,
  mergeReplacementRules,
  normalizeRuleList,
  upsertRuleInList,
  validateReplacementRule,
} from '../../../src/common/replacementRules/ruleConfig.js';
import { builtInRuleAppliesToApiVersion, BUILT_IN_REPLACEMENT_RULES } from '../../../src/common/replacementRules/builtInReplacementRules.js';
import { resolveRuleValue } from '../../../src/common/replacementRules/ruleEngine.js';
import { applyRuleFields, buildRuleFieldsFromFlags } from '../../../src/common/replacementRules/ruleFlags.js';
import { validateXmlPath } from '../../../src/common/replacementRules/xmlPath.js';
import { ReplacementRule } from '../../../src/common/replacementRules/types.js';

const endpointRule: ReplacementRule = {
  id: 'payment-api-endpoint',
  type: 'xml-value',
  files: '**/*.namedCredential-meta.xml',
  xmlPath: 'NamedCredential/endpoint',
  values: { uat: 'https://uat.example.com', default: 'https://sandbox.example.com' },
};

describe('replacement rules - layers', () => {
  it('merges the layers by id, values org by org', () => {
    const { rules, warnings } = mergeReplacementRules(
      [
        { origin: 'project', rules: [endpointRule] },
        { origin: 'branch', branch: 'uat', rules: [{ id: 'payment-api-endpoint', values: { uat: 'https://uat2.example.com' } }] },
        { origin: 'issue', rules: [{ id: 'payment-api-endpoint', description: 'From the issue' }] },
      ],
      []
    );
    expect(warnings).to.have.length(0);
    expect(rules).to.have.length(1);
    expect(rules[0].values).to.deep.equal({ uat: 'https://uat2.example.com', default: 'https://sandbox.example.com' });
    expect(rules[0].description).to.equal('From the issue');
    expect(rules[0].origins).to.deep.equal(['project', 'branch', 'issue']);
    expect(rules[0].enabled).to.equal(true);
  });

  it('switches the value source of a rule from a higher place', () => {
    const single: ReplacementRule = { id: 'x', type: 'xml-value', files: 'a', xmlPath: 'A/b', value: 'A' };
    // values over a single value: the single value becomes the default of the other orgs
    const branch = mergeReplacementRules([{ origin: 'project', rules: [single] }, { origin: 'branch', branch: 'uat', rules: [{ id: 'x', values: { uat: 'B' } }] }], []).rules[0];
    expect(branch.value).to.equal(undefined);
    expect(branch.values).to.deep.equal({ default: 'A', uat: 'B' });
    expect(validateReplacementRule(branch)).to.equal(null);
    // secret over values: the values go away
    const secret = mergeReplacementRules([{ origin: 'project', rules: [endpointRule] }, { origin: 'branch', branch: 'uat', rules: [{ id: 'payment-api-endpoint', secret: 'MY_ENDPOINT' }] }], []).rules[0];
    expect(secret.values).to.equal(undefined);
    expect(secret.secret).to.equal('MY_ENDPOINT');
    expect(validateReplacementRule(secret)).to.equal(null);
    // value over a secret: the secret goes away
    const value = mergeReplacementRules([{ origin: 'project', rules: [{ ...single, value: undefined, secret: 'S' }] }, { origin: 'branch', branch: 'uat', rules: [{ id: 'x', value: 'C' }] }], []).rules[0];
    expect(value.secret).to.equal(undefined);
    expect(value.value).to.equal('C');
  });

  it('never takes a secret from the issue', () => {
    const { rules, warnings } = mergeReplacementRules(
      [
        { origin: 'project', rules: [endpointRule] },
        { origin: 'issue', rules: [{ id: 'payment-api-endpoint', secret: 'SFDX_CLIENT_KEY' }, { id: 'steal', type: 'text', files: '**/*', find: 'x', secret: 'SFDX_CLIENT_KEY' }] },
      ],
      []
    );
    expect(rules).to.have.length(1);
    expect(rules[0].secret).to.equal(undefined);
    expect(rules[0].values).to.deep.equal(endpointRule.values);
    expect(warnings.map((warning) => warning.ruleId)).to.deep.equal(['payment-api-endpoint', 'steal']);
  });

  it('turns built-in rules on or off, and only that', () => {
    const builtIn = BUILT_IN_REPLACEMENT_RULES.find((rule) => rule.id === 'builtin-flow-ends')!;
    const { rules } = mergeReplacementRules([{ origin: 'issue', rules: [{ id: 'builtin-flow-ends', enabled: false, files: 'x' }] }], [builtIn]);
    expect(rules[0].enabled).to.equal(false);
    expect(rules[0].files).to.deep.equal(builtIn.files);
    expect(rules[0].origins).to.deep.equal(['builtin', 'issue']);
  });

  it('reports an override of an unknown rule', () => {
    const { rules, warnings } = mergeReplacementRules([{ origin: 'issue', rules: [{ id: 'nope', enabled: false }] }], []);
    expect(rules).to.have.length(0);
    expect(warnings[0].kind).to.equal('unknown-override');
  });

  it('validates rules', () => {
    expect(validateReplacementRule(endpointRule)).to.equal(null);
    expect(validateReplacementRule({ ...endpointRule, id: 'Bad Id' })).to.include('id');
    expect(validateReplacementRule({ ...endpointRule, xmlPath: undefined })).to.include('xmlPath');
    expect(validateReplacementRule({ ...endpointRule, value: 'x' })).to.include('exactly one');
    expect(validateReplacementRule({ ...endpointRule, values: undefined })).to.include('exactly one');
    expect(validateReplacementRule({ id: 'remove', type: 'xml-remove', files: 'x', xmlPath: 'A/b', value: 'x' })).to.include('no value');
    expect(validateReplacementRule({ id: 't', type: 'text', files: 'x', find: '([', regex: true, value: 'y' })).to.include('regular expression');
    expect(validateReplacementRule({ id: 's', type: 'text', files: 'x', find: 'a', secret: 'NOT A NAME' })).to.include('CI/CD variable');
    expect(validateReplacementRule({ ...endpointRule, includeTargetBranches: ['uat'], excludeTargetBranches: ['main'] })).to.include('both');
  });

  it('normalizes YAML values to text and cleans rules for storage', () => {
    const [rule] = normalizeRuleList([{ id: 'n', type: 'text', files: ['a'], find: 'x', values: { uat: 12, main: true } }]);
    expect(rule.values).to.deep.equal({ uat: '12', main: 'true' });
    expect(cleanRuleForStorage({ ...rule, includeTargetBranches: [] })).to.deep.equal({ id: 'n', type: 'text', files: 'a', find: 'x', values: { uat: '12', main: 'true' } });
  });

  it('replaces or merges a rule in a list', () => {
    const merged = upsertRuleInList([endpointRule], { id: 'payment-api-endpoint', values: { main: 'https://example.com' } }, 'merge');
    expect(merged[0].values).to.deep.equal({ ...endpointRule.values, main: 'https://example.com' });
    const replaced = upsertRuleInList([endpointRule], { id: 'payment-api-endpoint', enabled: false }, 'replace');
    expect(replaced[0]).to.deep.equal({ id: 'payment-api-endpoint', enabled: false });
    expect(upsertRuleInList([endpointRule], { id: 'other', enabled: false }, 'merge')).to.have.length(2);
  });
});

describe('replacement rules - values', () => {
  it('resolves the value of a target', () => {
    expect(resolveRuleValue(endpointRule, 'uat')).to.equal('https://uat.example.com');
    expect(resolveRuleValue(endpointRule, 'UAT')).to.equal('https://uat.example.com');
    expect(resolveRuleValue(endpointRule, 'main')).to.equal('https://sandbox.example.com');
    expect(resolveRuleValue(endpointRule, null)).to.equal('https://sandbox.example.com');
    expect(resolveRuleValue({ values: { 'release/uat': 'a' } }, 'release__uat')).to.equal('a');
    expect(resolveRuleValue({ values: { main: 'a' } }, 'uat')).to.equal(null);
    expect(resolveRuleValue({ value: 'same' }, 'uat')).to.equal('same');
  });
});

describe('replacement rules - flags', () => {
  it('builds fields from flags and clears the other value sources', () => {
    const { fields, removedValueKeys, hasFields } = buildRuleFieldsFromFlags({ 'value-for': ['uat=https://a', 'main='], enabled: 'false', 'include-branches': 'uat, preprod' });
    expect(hasFields).to.equal(true);
    expect(fields).to.deep.equal({ values: { uat: 'https://a' }, enabled: false, includeTargetBranches: ['uat', 'preprod'] });
    expect(removedValueKeys).to.deep.equal(['main']);
    const updated = applyRuleFields({ ...endpointRule, values: { main: 'x', default: 'y' } }, fields, removedValueKeys, ['required']);
    expect(updated.values).to.deep.equal({ default: 'y', uat: 'https://a' });
    expect(updated.enabled).to.equal(false);
    const secret = applyRuleFields(updated, { secret: 'MY_SECRET' }, []);
    expect(secret.values).to.equal(undefined);
    expect(secret.secret).to.equal('MY_SECRET');
  });

  it('refuses a bad --value-for and an unknown --unset', () => {
    expect(() => buildRuleFieldsFromFlags({ 'value-for': ['missing-equal-sign'] })).to.throw();
    expect(() => applyRuleFields(endpointRule, {}, [], ['nope'])).to.throw();
  });
});

describe('replacement rules - built-in list', () => {
  it('has valid, unique entries', () => {
    const ids = BUILT_IN_REPLACEMENT_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).to.equal(ids.length);
    for (const rule of BUILT_IN_REPLACEMENT_RULES) {
      expect(rule.id.startsWith('builtin-'), rule.id).to.equal(true);
      expect(rule.introducedIn != null || rule.removedIn != null || rule.anyApiVersion === true, rule.id).to.equal(true);
      expect(rule.files.length, rule.id).to.be.greaterThan(0);
      for (const xmlPath of rule.xmlPaths) {
        expect(validateXmlPath(xmlPath), `${rule.id} ${xmlPath}`).to.equal(null);
      }
      if (!rule.defaultEnabled) {
        expect(rule.warnWhenDisabled, rule.id).to.equal(true);
      }
    }
  });

  it('applies by deployment API version', () => {
    const introduced = { id: 'a', description: '', files: ['x'], xmlPaths: ['A'], introducedIn: 68, defaultEnabled: true, source: '' };
    const removed = { ...introduced, introducedIn: undefined, removedIn: 65 };
    expect(builtInRuleAppliesToApiVersion(introduced, 67)).to.equal(true);
    expect(builtInRuleAppliesToApiVersion(introduced, 68)).to.equal(false);
    expect(builtInRuleAppliesToApiVersion(removed, 64)).to.equal(false);
    expect(builtInRuleAppliesToApiVersion(removed, 65)).to.equal(true);
    expect(builtInRuleAppliesToApiVersion(introduced, null)).to.equal(false);
  });
});
