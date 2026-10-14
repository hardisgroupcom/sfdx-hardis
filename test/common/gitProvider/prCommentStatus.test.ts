/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { getDeploymentBannerKey, resolvePrCommentStatus } from '../../../src/common/gitProvider/index.js';

describe('Pull Request comment status and banner', () => {
  describe('resolvePrCommentStatus', () => {
    it('keeps the status when it is set', () => {
      expect(resolvePrCommentStatus({ status: 'invalid', deployStatus: 'valid' })).to.equal('invalid');
      expect(resolvePrCommentStatus({ status: 'valid' })).to.equal('valid');
    });

    // Most success paths (code coverage check, project without Apex) only set deployStatus:
    // without the fallback, a successful deployment comment would carry no banner at all
    it('falls back on deployStatus when the status is not set', () => {
      expect(resolvePrCommentStatus({ deployStatus: 'valid' })).to.equal('valid');
      expect(resolvePrCommentStatus({ deployStatus: 'invalid' })).to.equal('invalid');
    });

    it('returns tovalidate when neither status nor a decisive deployStatus is known', () => {
      expect(resolvePrCommentStatus({})).to.equal('tovalidate');
      expect(resolvePrCommentStatus({ deployStatus: 'unknown' })).to.equal('tovalidate');
    });
  });

  describe('getDeploymentBannerKey', () => {
    it('returns the validation banners for a check job', () => {
      expect(getDeploymentBannerKey(true, 'valid')).to.equal('validation-success');
      expect(getDeploymentBannerKey(true, 'invalid')).to.equal('validation-failure');
    });

    it('returns the deployment banners for a deployment job', () => {
      expect(getDeploymentBannerKey(false, 'valid')).to.equal('deployment-success');
      expect(getDeploymentBannerKey(false, 'invalid')).to.equal('deployment-failure');
    });

    // Validation and deployment banners only exist as success or failure: a comment posted before
    // the result is known displays its plain title instead
    it('returns no banner while the result is not known', () => {
      expect(getDeploymentBannerKey(true, 'tovalidate')).to.be.undefined;
      expect(getDeploymentBannerKey(false, 'tovalidate')).to.be.undefined;
    });
  });
});
