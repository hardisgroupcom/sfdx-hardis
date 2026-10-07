import { expect } from 'chai';
import { findJsonInString } from '../../../src/common/utils/index.js';

describe('findJsonInString()', () => {
  it('reads the JSON result of a command', () => {
    expect(findJsonInString('Deploying...\n{"status":1,"result":{"success":false}}\n')).to.deep.equal({ status: 1, result: { success: false } });
  });

  // The Salesforce CLI can write warnings with braces on stderr, which the deployment error handler
  // appends to stdout: the result must still be read, or the Pull Request comment shows no error
  it('reads the JSON result followed by a warning holding braces', () => {
    const stdout = JSON.stringify({ status: 1, result: { details: { componentFailures: [{ problem: 'Variable does not exist: taxx {x}' }] } } }, null, 2);
    const stderr = "(node:25348) Error Plugin: @salesforce/cli: could not find package.json with {\n  name: '@oclif/plugin-command-snapshot',\n  type: 'dev'\n}\nmodule: @oclif/core@5.0.0";
    const json = findJsonInString(stdout + stderr);
    expect(json?.result?.details?.componentFailures?.[0]?.problem).to.equal('Variable does not exist: taxx {x}');
  });

  it('returns null when there is no JSON', () => {
    expect(findJsonInString('no json here')).to.be.null;
    expect(findJsonInString('a warning with { name: x }')).to.be.null;
  });
});
