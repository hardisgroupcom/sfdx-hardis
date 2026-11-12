import { expect } from 'chai';
import { buildWrappedCommandArgs } from '../../../src/common/utils/wrapUtils.js';

describe('buildWrappedCommandArgs()', () => {
  it('removes --agent, which sf project deploy start refuses', () => {
    expect(buildWrappedCommandArgs(['--agent', '--manifest', 'manifest/package.xml', '--dry-run'])).to.deep.equal([
      '--manifest',
      '"manifest/package.xml"',
      '--dry-run',
    ]);
  });

  it('removes the other sfdx-hardis flags, and the value of --websocket', () => {
    expect(buildWrappedCommandArgs(['--debug', '--websocket', 'localhost:2702', '--skipauth', '--checkcoverage', '-o', 'me@example.com'])).to.deep.equal([
      '-o',
      '"me@example.com"',
    ]);
  });

  it('keeps -d, the short flag of --source-dir, with its value', () => {
    expect(buildWrappedCommandArgs(['-d', 'force-app'])).to.deep.equal(['-d', '"force-app"']);
  });

  it('keeps the quotes already given', () => {
    expect(buildWrappedCommandArgs(['--tests', "'MyTest'"])).to.deep.equal(['--tests', "'MyTest'"]);
  });
});
