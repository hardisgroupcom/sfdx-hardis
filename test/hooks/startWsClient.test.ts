/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { isBackgroundJsonCall } from '../../src/hooks/init/start-ws-client.js';

describe('isBackgroundJsonCall()', () => {
  it('keeps the read-only calls of the Backpromote (Beta) panel away from the extension WebSocket', () => {
    expect(isBackgroundJsonCall('hardis:work:backpromote', ['--plan', '--json'])).to.be.true;
    expect(isBackgroundJsonCall('hardis:work:backpromote', ['--plan'])).to.be.true;
    expect(isBackgroundJsonCall('hardis:work:backpromote', ['--prepare-merge', 'Flow:X', '--json'])).to.be.true;
  });

  it('still connects a backpromote run, and a merge prepared from a terminal that VS Code opens files for', () => {
    expect(isBackgroundJsonCall('hardis:work:backpromote', ['--pull-requests', '1,3'])).to.be.false;
    expect(isBackgroundJsonCall('hardis:work:backpromote', ['--prepare-merge', 'Flow:X'])).to.be.false;
    expect(isBackgroundJsonCall('hardis:org:diagnose:audittrail', ['--plan', '--json'])).to.be.false;
  });
});
