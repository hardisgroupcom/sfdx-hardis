import { expect } from 'chai';
import { buildOrgSlugFromInstanceUrl } from '../../../src/common/utils/index.js';

describe('buildOrgSlugFromInstanceUrl()', () => {
  it('builds the slug of a production or Developer Edition org', () => {
    expect(buildOrgSlugFromInstanceUrl('https://orgfarm-46e8f3e0ad-dev-ed.develop.my.salesforce.com')).to.equal(
      'orgfarm_46e8f3e0ad_dev_ed_develop'
    );
  });

  it('builds the slug of a sandbox', () => {
    expect(buildOrgSlugFromInstanceUrl('https://mycompany--uat.sandbox.my.salesforce.com')).to.equal('mycompany__uat_sandbox');
  });

  // Some logins store the instance URL with a trailing slash, and the monitoring branch
  // monitoring_<slug>/ was then refused by git (sfdx-hardis-training issue #248)
  it('ignores a trailing slash', () => {
    expect(buildOrgSlugFromInstanceUrl('https://orgfarm-46e8f3e0ad-dev-ed.develop.my.salesforce.com/')).to.equal(
      'orgfarm_46e8f3e0ad_dev_ed_develop'
    );
  });

  it('ignores a path, a query and surrounding spaces', () => {
    expect(buildOrgSlugFromInstanceUrl(' https://mycompany.my.salesforce.com/lightning/setup?x=1 ')).to.equal('mycompany');
  });

  it('keeps the case of the host, so existing branch names do not change', () => {
    expect(buildOrgSlugFromInstanceUrl('https://MyCompany.my.salesforce.com')).to.equal('MyCompany');
  });

  it('returns an empty slug without an instance URL', () => {
    expect(buildOrgSlugFromInstanceUrl(undefined as unknown as string)).to.equal('');
  });
});
