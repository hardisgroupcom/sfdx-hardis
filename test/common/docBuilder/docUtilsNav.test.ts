import { strict as assert } from 'assert';
import { normalizeMkDocsNav, normalizeMkDocsNavTarget, sortMkDocsNavItems } from '../../../src/common/docBuilder/docUtils.js';

/**
 * MkDocs documents a nav sub-section as a list of single-key mappings, and merely
 * tolerated the flat mapping this command used to write. Zensical does not: it
 * raises "Unknown nav item value type: <class 'dict'>" and the site never builds.
 */
describe('mkdocs nav normalization', () => {
  it('expands a legacy flat sub-menu into the list MkDocs documents', () => {
    const nav = [
      { Home: 'index.md' },
      { Objects: { 'All objects': 'objects/index.md', Account: 'objects/Account.md' } },
    ];
    assert.deepEqual(normalizeMkDocsNav(nav), [
      { Home: 'index.md' },
      { Objects: [{ 'All objects': 'objects/index.md' }, { Account: 'objects/Account.md' }] },
    ]);
  });

  it('leaves an already normalized nav untouched', () => {
    const nav = [
      { Home: 'index.md' },
      { Objects: [{ Account: 'objects/Account.md' }] },
    ];
    assert.deepEqual(normalizeMkDocsNav(nav), nav);
  });

  it('keeps sub-menus a user added by hand, with their labels, targets and order', () => {
    const nav = [
      { Home: 'index.md' },
      { Objects: { Account: 'objects/Account.md' } },
      // Added by the user after the documentation was generated
      { 'Contributor Guide': { Setup: 'guide/setup.md', Release: 'guide/release.md' } },
      { Scripts: 'scripts.md' },
    ];
    assert.deepEqual(normalizeMkDocsNav(nav), [
      { Home: 'index.md' },
      { Objects: [{ Account: 'objects/Account.md' }] },
      { 'Contributor Guide': [{ Setup: 'guide/setup.md' }, { Release: 'guide/release.md' }] },
      { Scripts: 'scripts.md' },
    ]);
  });

  it('normalizes nested sub-menus at any depth', () => {
    const nav = [{ Code: { Apex: { Triggers: { AccountTrigger: 'apex/AccountTrigger.md' } } } }];
    assert.deepEqual(normalizeMkDocsNav(nav), [
      { Code: [{ Apex: [{ Triggers: [{ AccountTrigger: 'apex/AccountTrigger.md' }] }] }] },
    ]);
  });

  it('loses no page when a whole generated menu is converted', () => {
    const objectsForMenu: any = {};
    for (let i = 0; i < 500; i++) {
      objectsForMenu[`Object${i}__c`] = `objects/Object${i}__c.md`;
    }
    const normalized = normalizeMkDocsNavTarget(objectsForMenu) as any[];
    assert.equal(normalized.length, 500);
    assert.deepEqual(normalized[0], { Object0__c: 'objects/Object0__c.md' });
    assert.deepEqual(normalized[499], { Object499__c: 'objects/Object499__c.md' });
  });

  it('treats a missing nav as an empty list, not an empty mapping', () => {
    // nav used to default to {}, which yaml.dump wrote as "nav: {}"
    assert.deepEqual(normalizeMkDocsNav(undefined), []);
    assert.deepEqual(normalizeMkDocsNav(null), []);
  });
});

/**
 * Menu entries are collected while metadata files are walked, so they arrive in file system
 * order: packages and Lightning Web Components came out reversed in generated mkdocs.yml.
 */
describe('mkdocs nav sorting', () => {
  it('sorts a sub-menu by label, whatever order the entries were collected in', () => {
    const menu = normalizeMkDocsNavTarget({
      'utilsPrivate': 'lwc/utilsPrivate.md',
      'utils': 'lwc/utils.md',
      'sampleApp': 'lwc/sampleApp.md',
      'radioGroup': 'lwc/radioGroup.md',
    });
    assert.deepEqual(sortMkDocsNavItems(menu), [
      { radioGroup: 'lwc/radioGroup.md' },
      { sampleApp: 'lwc/sampleApp.md' },
      { utils: 'lwc/utils.md' },
      { utilsPrivate: 'lwc/utilsPrivate.md' },
    ]);
  });

  it('keeps the "All <type>" index page at the top of its menu', () => {
    const menu = normalizeMkDocsNavTarget({
      'zeta': 'lwc/zeta.md',
      'All Lightning Web Components': 'lwc/index.md',
      'alpha': 'lwc/alpha.md',
    });
    assert.deepEqual(sortMkDocsNavItems(menu), [
      { 'All Lightning Web Components': 'lwc/index.md' },
      { alpha: 'lwc/alpha.md' },
      { zeta: 'lwc/zeta.md' },
    ]);
  });

  it('ignores case, so ATPCheck and AccountCases are not separated', () => {
    const menu = normalizeMkDocsNavTarget({
      'ATPCheck': 'apex/ATPCheck.md',
      'AccountCases': 'apex/AccountCases.md',
      'AP01_Account': 'apex/AP01_Account.md',
    });
    assert.deepEqual(sortMkDocsNavItems(menu).map((item: any) => Object.keys(item)[0]), [
      'AccountCases',
      'AP01_Account',
      'ATPCheck',
    ]);
  });

  it('sorts nested sub-menus too', () => {
    const nav = normalizeMkDocsNav([{ Code: { Apex: { Zeta: 'apex/Zeta.md', Alpha: 'apex/Alpha.md' } } }]);
    assert.deepEqual(sortMkDocsNavItems(nav), [
      { Code: [{ Apex: [{ Alpha: 'apex/Alpha.md' }, { Zeta: 'apex/Zeta.md' }] }] },
    ]);
  });

  it('leaves a page path untouched', () => {
    assert.equal(sortMkDocsNavItems('sfdx-hardis-params.md'), 'sfdx-hardis-params.md');
  });

  it('loses no page when a whole generated menu is sorted', () => {
    const objectsForMenu: any = {};
    for (let i = 0; i < 500; i++) {
      objectsForMenu[`Object${i}__c`] = `objects/Object${i}__c.md`;
    }
    const sorted = sortMkDocsNavItems(normalizeMkDocsNavTarget(objectsForMenu)) as any[];
    assert.equal(sorted.length, 500);
    assert.deepEqual(sorted[0], { Object0__c: 'objects/Object0__c.md' });
    assert.deepEqual(sorted[1], { Object1__c: 'objects/Object1__c.md' });
  });
});
