import { expect } from 'chai';
import { decideOrgAlias, isGenericLoginUrl, shortenInstanceUrl } from '../../../src/common/utils/authUtils.js';

describe('shortenInstanceUrl', () => {
  it('builds a short name from the instance URL of the org', () => {
    expect(shortenInstanceUrl('https://acme-dev-dev-ed.develop.my.salesforce.com')).to.equal('acme-dev');
    expect(shortenInstanceUrl('https://acme-integration.my.salesforce.com')).to.equal('acme-integration');
    expect(shortenInstanceUrl('https://acme--uat.sandbox.my.salesforce.com/')).to.equal('acme--uat');
  });

  it('falls back to a neutral name when the URL says nothing about the org', () => {
    expect(shortenInstanceUrl('https://login.salesforce.com')).to.equal('my-org');
    expect(shortenInstanceUrl('https://test.salesforce.com')).to.equal('my-org');
    expect(shortenInstanceUrl('')).to.equal('my-org');
  });
});

describe('isGenericLoginUrl', () => {
  it('recognizes the login URLs shared by every org', () => {
    expect(isGenericLoginUrl('https://login.salesforce.com')).to.equal(true);
    expect(isGenericLoginUrl('https://test.salesforce.com/')).to.equal(true);
    expect(isGenericLoginUrl('TEST.salesforce.com')).to.equal(true);
    expect(isGenericLoginUrl('')).to.equal(true);
    expect(isGenericLoginUrl(null)).to.equal(true);
  });

  it('does not match the URL of an org', () => {
    expect(isGenericLoginUrl('https://acme--uat.sandbox.my.salesforce.com')).to.equal(false);
    expect(isGenericLoginUrl('https://acme.my.salesforce.com')).to.equal(false);
  });
});

describe('decideOrgAlias', () => {
  const orgUrl = 'https://acme--uat.sandbox.my.salesforce.com';

  it('uses the alias the login already carries, without asking', () => {
    expect(
      decideOrgAlias({ carriedAlias: 'DevHub', existingAlias: 'other', instanceUrl: orgUrl, interactive: true })
    ).to.deep.equal({ alias: 'DevHub', ask: 'never' });
  });

  it('keeps the alias the username already has, without asking', () => {
    expect(decideOrgAlias({ existingAlias: 'acme-uat', instanceUrl: orgUrl, interactive: true })).to.deep.equal({
      alias: 'acme-uat',
      ask: 'never',
    });
    expect(
      decideOrgAlias({ existingAlias: 'acme-uat', instanceUrl: 'https://test.salesforce.com', interactive: false })
    ).to.deep.equal({ alias: 'acme-uat', ask: 'never' });
  });

  it('asks before the login when the instance URL is the one of the org', () => {
    expect(decideOrgAlias({ instanceUrl: orgUrl, interactive: true })).to.deep.equal({ alias: null, ask: 'before' });
  });

  it('asks after the login with login.salesforce.com and test.salesforce.com', () => {
    expect(decideOrgAlias({ instanceUrl: 'https://login.salesforce.com', interactive: true })).to.deep.equal({
      alias: null,
      ask: 'after',
    });
    expect(decideOrgAlias({ instanceUrl: 'https://test.salesforce.com', interactive: true })).to.deep.equal({
      alias: null,
      ask: 'after',
    });
  });

  it('never asks in CI or agent mode', () => {
    expect(decideOrgAlias({ instanceUrl: orgUrl, interactive: false })).to.deep.equal({ alias: null, ask: 'never' });
    expect(decideOrgAlias({ instanceUrl: 'https://login.salesforce.com', interactive: false })).to.deep.equal({
      alias: null,
      ask: 'never',
    });
  });
});
