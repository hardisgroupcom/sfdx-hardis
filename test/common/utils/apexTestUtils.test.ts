import { expect } from 'chai';
import { isNoApexError, isTransientNetworkError } from '../../../src/common/utils/apexTestUtils.js';

describe('apexTestUtils', () => {
  describe('isTransientNetworkError', () => {
    it('detects Node fetch and socket errors', () => {
      expect(isTransientNetworkError('Error (TypeError): fetch failed')).to.equal(true);
      expect(isTransientNetworkError('read ECONNRESET')).to.equal(true);
      expect(isTransientNetworkError('connect ETIMEDOUT 1.2.3.4:443')).to.equal(true);
      expect(isTransientNetworkError('getaddrinfo EAI_AGAIN nti.my.salesforce.com')).to.equal(true);
      expect(isTransientNetworkError('Socket hang up')).to.equal(true);
    });

    it('ignores other errors', () => {
      expect(isTransientNetworkError('INVALID_SESSION_ID: Session expired or invalid')).to.equal(false);
      expect(isTransientNetworkError('')).to.equal(false);
    });
  });

  describe('isNoApexError', () => {
    it('detects no Apex messages in human and JSON output', () => {
      expect(isNoApexError('No tests found for category Apex')).to.equal(true);
      expect(isNoApexError('Error (INVALID_INPUT): something')).to.equal(true);
      expect(isNoApexError('{ "name": "INVALID_INPUT", "message": "..." }')).to.equal(true);
    });

    it('ignores other errors', () => {
      expect(isNoApexError('fetch failed')).to.equal(false);
    });
  });
});
