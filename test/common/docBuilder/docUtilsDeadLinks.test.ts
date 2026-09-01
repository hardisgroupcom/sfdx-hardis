import { strict as assert } from 'assert';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { removeDeadDocumentationLinks } from '../../../src/common/docBuilder/docUtils.js';
import { DocBuilderApex } from '../../../src/common/docBuilder/docBuilderApex.js';

/**
 * Generated pages link to pages that were never generated: a permission set the org owns but
 * the project does not, an Apex class ApexDocGen skipped, a component absent from the
 * repository. Zensical reports every one of them as "page does not exist".
 */
describe('dead documentation links', () => {
  let docsRoot: string;

  beforeEach(async () => {
    docsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sfdx-hardis-docs-'));
  });

  afterEach(async () => {
    await fs.remove(docsRoot);
  });

  async function writePage(relativePath: string, content: string) {
    const pageFile = path.join(docsRoot, relativePath);
    await fs.ensureDir(path.dirname(pageFile));
    await fs.writeFile(pageFile, content);
  }

  async function readPage(relativePath: string): Promise<string> {
    return fs.readFile(path.join(docsRoot, relativePath), 'utf8');
  }

  it('removes the link to a page that does not exist, and keeps its label', async () => {
    await writePage('permissionsetgroups/force__SalesUsers.md', '| [force__MacrosManager](../permissionsets/force__MacrosManager.md) |\n');
    assert.equal(await removeDeadDocumentationLinks(docsRoot), 1);
    assert.equal(await readPage('permissionsetgroups/force__SalesUsers.md'), '| force__MacrosManager |\n');
  });

  it('keeps a link whose page exists', async () => {
    await writePage('permissionsets/Admin.md', '# Admin\n');
    await writePage('permissionsetgroups/PSG.md', '| [Admin](../permissionsets/Admin.md) |\n');
    assert.equal(await removeDeadDocumentationLinks(docsRoot), 0);
    assert.equal(await readPage('permissionsetgroups/PSG.md'), '| [Admin](../permissionsets/Admin.md) |\n');
  });

  it('repairs a link whose page exists under another case', async () => {
    // A Visualforce page declares standardController="account", the object page is Account.md
    await writePage('objects/Account.md', '# Account\n');
    await writePage('visualforce/AccountHierarchyPage.md', '|Standard Controller|[account](../objects/account.md)|\n');
    assert.equal(await removeDeadDocumentationLinks(docsRoot), 1);
    assert.equal(
      await readPage('visualforce/AccountHierarchyPage.md'),
      '|Standard Controller|[account](../objects/Account.md)|\n'
    );
  });

  it('keeps the anchor of a link it repairs', async () => {
    await writePage('objects/Account.md', '# Account\n');
    await writePage('flows/MyFlow.md', '[account](../objects/account.md#fields)\n');
    assert.equal(await removeDeadDocumentationLinks(docsRoot), 1);
    assert.equal(await readPage('flows/MyFlow.md'), '[account](../objects/Account.md#fields)\n');
  });

  it('drops an icon-only link instead of leaving the icon alone', async () => {
    await writePage('flows/index.md', '| [MyFlow](MyFlow.md) [🕒](MyFlow-history.md) |\n');
    await writePage('flows/MyFlow.md', '# MyFlow\n');
    assert.equal(await removeDeadDocumentationLinks(docsRoot), 1);
    assert.equal(await readPage('flows/index.md'), '| [MyFlow](MyFlow.md)  |\n');
  });

  it('keeps a link to a page whose name holds a space, written percent-encoded', async () => {
    // Profiles are linked as ../profiles/Chatter%20Free%20User.md
    await writePage('profiles/Chatter Free User.md', '# Chatter Free User\n');
    const content = '| [Chatter Free User](../profiles/Chatter%20Free%20User.md) |\n';
    await writePage('objects/Case.md', content);
    assert.equal(await removeDeadDocumentationLinks(docsRoot), 0);
    assert.equal(await readPage('objects/Case.md'), content);
  });

  it('percent-encodes the spaces of a link it repairs', async () => {
    await writePage('profiles/Chatter Free User.md', '# Chatter Free User\n');
    await writePage('objects/Case.md', '| [Chatter Free User](../profiles/chatter%20free%20user.md) |\n');
    assert.equal(await removeDeadDocumentationLinks(docsRoot), 1);
    assert.equal(
      await readPage('objects/Case.md'),
      '| [Chatter Free User](../profiles/Chatter%20Free%20User.md) |\n'
    );
  });

  it('leaves external links alone', async () => {
    const content = '[Changelog](https://sfdx-hardis.cloudity.com/CHANGELOG.md)\n';
    await writePage('objects/Account.md', content);
    assert.equal(await removeDeadDocumentationLinks(docsRoot), 0);
    assert.equal(await readPage('objects/Account.md'), content);
  });

  it('never rewrites a page a user added outside of the generated folders', async () => {
    const content = '[Quick summary](my-other-notes.md)\n';
    await writePage('script-altares-mass-duns.md', content);
    assert.equal(await removeDeadDocumentationLinks(docsRoot), 0);
    assert.equal(await readPage('script-altares-mass-duns.md'), content);
  });
});

/**
 * ApexDocGen writes one folder per @group ApexDoc tag, and project2markdown flattens all of
 * them into the single apex folder of the documentation.
 */
describe('apexdocs link flattening', () => {
  it('rewrites a link to another group as a link in the same folder', () => {
    assert.equal(
      DocBuilderApex.flattenApexDocLinks('#### Type\n[Alpha](../plumcloud-labs/Alpha.md)\n'),
      '#### Type\n[Alpha](Alpha.md)\n'
    );
  });

  it('rewrites the backslash paths ApexDocGen writes on Windows', () => {
    assert.equal(
      DocBuilderApex.flattenApexDocLinks('[Beta](..\\miscellaneous\\Beta.md)\n'),
      '[Beta](Beta.md)\n'
    );
  });

  it('sends SObject links to the objects folder of the documentation', () => {
    assert.equal(
      DocBuilderApex.flattenApexDocLinks('[User](../custom-objects/User.md) [Case](..\\custom-objects\\Case.md)\n'),
      '[User](../objects/User.md) [Case](../objects/Case.md)\n'
    );
  });

  it('leaves a link that already points at the objects folder alone', () => {
    assert.equal(
      DocBuilderApex.flattenApexDocLinks('[User](../objects/User.md)\n'),
      '[User](../objects/User.md)\n'
    );
  });
});
