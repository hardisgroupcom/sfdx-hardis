import { strict as assert } from 'assert';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import {
  isUntouchedGeneratedHomePage,
  removeEmptySectionIndexPages,
  stampGeneratedHomePage,
} from '../../../src/common/docBuilder/docUtils.js';

const FOOTER =
  '\n_Documentation generated from branch main with [sfdx-hardis](https://sfdx-hardis.cloudity.com)' +
  ' command [`sf hardis:doc:project2markdown`](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/)_\n';

/**
 * DO_NOT_OVERWRITE_INDEX_MD lets a project write its own home page. Setting it used to freeze the
 * page for good: a project that set the variable and never touched index.md stayed on the home
 * page of the sfdx-hardis version that generated it.
 */
describe('generated home page detection', () => {
  const homePage = '# Project Documentation\n\nWelcome.\n' + FOOTER;

  it('recognizes the page a previous run wrote', () => {
    assert.equal(isUntouchedGeneratedHomePage(stampGeneratedHomePage(homePage)), true);
  });

  it('hands the page over to the project as soon as it is edited', () => {
    const edited = stampGeneratedHomePage(homePage).replace('Welcome.', 'Welcome to the ACME org.');
    assert.equal(isUntouchedGeneratedHomePage(edited), false);
  });

  it('ignores the line endings git checked the page out with', () => {
    const stamped = stampGeneratedHomePage(homePage).replace(/\n/g, '\r\n');
    assert.equal(isUntouchedGeneratedHomePage(stamped), true);
  });

  it('ignores a blank line an editor left at the end', () => {
    assert.equal(isUntouchedGeneratedHomePage(stampGeneratedHomePage(homePage) + '\n\n'), true);
  });

  it('refreshes a page written before the stamp existed', () => {
    assert.equal(isUntouchedGeneratedHomePage(homePage), true);
  });

  it('keeps a home page the project wrote itself', () => {
    assert.equal(isUntouchedGeneratedHomePage('# ACME\n\nStart here: [Objects](objects/index.md)\n'), false);
  });

  it('does not take another page stamp for its own', () => {
    const otherPage = stampGeneratedHomePage('# Objects\n\n| [Account](Account.md) |' + FOOTER);
    const swapped = stampGeneratedHomePage(homePage).replace(
      /<!-- sfdx-hardis-home-page: [0-9a-f]{64} -->/,
      /<!-- sfdx-hardis-home-page: [0-9a-f]{64} -->/.exec(otherPage)?.[0] as string
    );
    assert.equal(isUntouchedGeneratedHomePage(swapped), false);
  });
});

/**
 * A section that documents nothing used to keep an index page listing nothing: absent from the
 * navigation and from the home page, but still built into the site and reachable from a search
 * engine. A section whose metadata is gone since the last run left the same page behind.
 */
describe('empty section index pages', () => {
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

  it('removes the index of a section that lists nothing, and its folder with it', async () => {
    await writePage('lwc/index.md', '# Lightning Web Components\n' + FOOTER);

    assert.deepEqual(await removeEmptySectionIndexPages(docsRoot), ['lwc']);
    assert.equal(fs.existsSync(path.join(docsRoot, 'lwc')), false);
  });

  it('keeps the index of a section that lists a page', async () => {
    await writePage('objects/index.md', '# Objects\n\n| [Account](Account.md) |' + FOOTER);
    await writePage('objects/Account.md', '# Account\n');

    assert.deepEqual(await removeEmptySectionIndexPages(docsRoot), []);
    assert.equal(fs.existsSync(path.join(docsRoot, 'objects', 'index.md')), true);
  });

  it('keeps the folder when the section still holds pages of its own', async () => {
    await writePage('flows/index.md', '# Flows\n' + FOOTER);
    await writePage('flows/Account_AfterUpdate.md', '# Account_AfterUpdate\n');

    assert.deepEqual(await removeEmptySectionIndexPages(docsRoot), ['flows']);
    assert.equal(fs.existsSync(path.join(docsRoot, 'flows', 'index.md')), false);
    assert.equal(fs.existsSync(path.join(docsRoot, 'flows', 'Account_AfterUpdate.md')), true);
  });

  it('leaves the home page and the pages someone added by hand alone', async () => {
    await writePage('index.md', '# Project Documentation\n' + FOOTER);
    await writePage('hello-trailblazers/index.md', '# Hello Trailblazers\n');

    assert.deepEqual(await removeEmptySectionIndexPages(docsRoot), []);
    assert.equal(fs.existsSync(path.join(docsRoot, 'index.md')), true);
    assert.equal(fs.existsSync(path.join(docsRoot, 'hello-trailblazers', 'index.md')), true);
  });

  it('removes the folder a section created before it found nothing to document', async () => {
    await fs.ensureDir(path.join(docsRoot, 'lwc'));

    assert.deepEqual(await removeEmptySectionIndexPages(docsRoot), []);
    assert.equal(fs.existsSync(path.join(docsRoot, 'lwc')), false);
  });

  it('does not fail on a documentation folder that has no section yet', async () => {
    assert.deepEqual(await removeEmptySectionIndexPages(docsRoot), []);
  });
});
