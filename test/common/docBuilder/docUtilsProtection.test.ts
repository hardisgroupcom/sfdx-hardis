import { strict as assert } from 'assert';
import fs from '../../../src/common/utils/fsUtils.js';
import * as os from 'os';
import * as path from 'path';
import { isDocProtected, withDocProtectionHeader } from '../../../src/common/docBuilder/docUtils.js';

/**
 * Every generated page tells its reader to set DO_NOT_OVERWRITE_DOC=TRUE to keep what they wrote in
 * it. The Apex and Flow pages carried neither the lines nor the check: a sentence written there was
 * gone at the next generation.
 */
describe('documentation page protection', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-protection-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('puts the two protection lines on top of a page that has none', () => {
    const page = withDocProtectionHeader('# InstallationScheduler Class\n');
    const lines = page.split('\n');
    assert.match(lines[0], /auto-generated/);
    assert.equal(lines[1], '<!-- DO_NOT_OVERWRITE_DOC=FALSE -->');
    assert.equal(lines[3], '# InstallationScheduler Class');
  });

  it('never adds them twice', () => {
    const once = withDocProtectionHeader('# Flow\n');
    assert.equal(withDocProtectionHeader(once), once);
  });

  it('reads a page marked TRUE as protected, and a missing or FALSE page as not', () => {
    const marked = path.join(dir, 'marked.md');
    const generated = path.join(dir, 'generated.md');
    fs.writeFileSync(marked, withDocProtectionHeader('# Page\n').replace('=FALSE', '=TRUE'));
    fs.writeFileSync(generated, withDocProtectionHeader('# Page\n'));
    assert.equal(isDocProtected(marked), true);
    assert.equal(isDocProtected(generated), false);
    assert.equal(isDocProtected(path.join(dir, 'missing.md')), false);
  });
});
