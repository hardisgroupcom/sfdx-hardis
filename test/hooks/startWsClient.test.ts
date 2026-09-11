/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { isBackgroundJsonCall } from '../../src/hooks/init/start-ws-client.js';

describe('isBackgroundJsonCall()', () => {
  it('keeps the read-only plan of the Backpromote (Beta) panel away from the extension WebSocket', () => {
    expect(isBackgroundJsonCall('hardis:work:backpromote', ['--plan', '--json'])).to.be.true;
    expect(isBackgroundJsonCall('hardis:work:backpromote', ['--plan'])).to.be.true;
  });

  it('still connects a backpromote run, which VS Code opens conflicting files for', () => {
    expect(isBackgroundJsonCall('hardis:work:backpromote', ['--auto', '--parentbranch', 'integration'])).to.be.false;
    expect(isBackgroundJsonCall('hardis:org:diagnose:audittrail', ['--plan', '--json'])).to.be.false;
  });
});
