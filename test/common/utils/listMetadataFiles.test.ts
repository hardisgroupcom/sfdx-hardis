/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import { listApexFiles, listPageFiles } from '../../../src/common/utils/projectUtils.js';

/**
 * These listings are scoped to a package directory, so they use PACKAGE_DIRECTORY_DOC_GLOB_IGNORE_PATTERNS
 * rather than the repository root ignore list: the root folders it names never sit inside a package
 * directory, and glob tests every ignore pattern against every walked path. The two folders that do show
 * up inside a package directory, node_modules and staticresources, must still be left out.
 */

const FIXTURE_FILES = [
  'main/default/classes/ListingSample.cls',
  'main/default/classes/ListingSample.cls-meta.xml',
  'main/default/triggers/ListingTrigger.trigger',
  'main/extra/classes/ListingNested.cls',
  'main/default/flexipages/Listing_Page.flexipage-meta.xml',
  // Left out: managed metadata is recognised by the namespace separator in the name
  'main/default/classes/mypkg__Managed.cls',
  // Left out: folders that do sit inside a package directory but hold no source to document
  'main/default/staticresources/bundle/vendor.cls',
  'main/default/staticresources/bundle/Bundled.flexipage-meta.xml',
  'node_modules/some-package/classes/Decoy.cls',
];

describe('package directory metadata listings', () => {
  const tmpRoot = path.join(process.cwd(), 'tmp');
  let packageDir = '';

  beforeEach(async () => {
    // No underscore in the folder name: listApexFiles drops any path holding a namespace separator
    packageDir = path.join(tmpRoot, `hardis-listing-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    for (const fixtureFile of FIXTURE_FILES) {
      const filePath = path.join(packageDir, fixtureFile);
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, 'x');
    }
  });

  afterEach(async () => {
    await fs.remove(packageDir);
  });

  function relative(files: string[]): string[] {
    return files.map((file) => path.relative(packageDir, file).split(path.sep).join('/')).sort();
  }

  it('lists the Apex sources of the package directory, skipping node_modules and staticresources', async () => {
    const apexFiles = await listApexFiles([{ path: packageDir, fullPath: packageDir }]);
    expect(relative(apexFiles)).to.deep.equal([
      'main/default/classes/ListingSample.cls',
      'main/default/triggers/ListingTrigger.trigger',
      'main/extra/classes/ListingNested.cls',
    ]);
  });

  it('lists the Lightning pages of the package directory, skipping staticresources', async () => {
    const pageFiles = await listPageFiles([{ path: packageDir, fullPath: packageDir }]);
    expect(relative(pageFiles)).to.deep.equal(['main/default/flexipages/Listing_Page.flexipage-meta.xml']);
  });

  it('returns nothing when there is no package directory', async () => {
    expect(await listApexFiles([])).to.deep.equal([]);
    expect(await listPageFiles([])).to.deep.equal([]);
  });
});
