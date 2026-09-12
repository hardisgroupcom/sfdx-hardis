/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { isBackgroundJsonCall } from '../../src/hooks/init/start-ws-client.js';

describe('isBackgroundJsonCall()', () => {
  it('keeps the background calls of the Backpromote (Beta) panel away from the extension WebSocket', () => {
    expect(isBackgroundJsonCall('hardis:work:backpromote', ['--plan', '--json'])).to.be.true;
    expect(isBackgroundJsonCall('hardis:work:backpromote', ['--plan'])).to.be.true;
    expect(isBackgroundJsonCall('hardis:work:backpromote', ['--auto', '--run-id', '7f3a', '--json'])).to.be.true;
    expect(isBackgroundJsonCall('hardis:work:backpromote', ['--prepare', '--json'])).to.be.true;
  });

  it('still connects a backpromote run launched in a terminal, and every other command', () => {
    expect(isBackgroundJsonCall('hardis:work:backpromote', ['--auto', '--parent-branch', 'integration'])).to.be.false;
    expect(isBackgroundJsonCall('hardis:org:diagnose:audittrail', ['--plan', '--json'])).to.be.false;
  });
});
