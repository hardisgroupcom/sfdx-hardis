import { expect } from 'chai';
import { commandNeedsCertKeepAlive } from '../../../src/common/actionsProvider/commandAction.js';

describe('commandNeedsCertKeepAlive', () => {
  it('matches a simple sf agent command', () => {
    expect(commandNeedsCertKeepAlive('sf agent publish authoring-bundle --api-name Referral_Assistant')).to.equal(true);
  });

  it('matches chained sf agent commands', () => {
    expect(
      commandNeedsCertKeepAlive('sf agent publish authoring-bundle --api-name X && sf agent activate --api-name X')
    ).to.equal(true);
  });

  it('matches when sf agent appears mid-string', () => {
    expect(commandNeedsCertKeepAlive('echo start && sf agent activate --api-name X')).to.equal(true);
  });

  it('does not match unrelated commands', () => {
    expect(commandNeedsCertKeepAlive('sf project deploy start')).to.equal(false);
  });

  it('does not match an empty command', () => {
    expect(commandNeedsCertKeepAlive('')).to.equal(false);
  });
});
