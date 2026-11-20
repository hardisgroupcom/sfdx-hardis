/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { getDeploymentBannerKey, resolvePrCommentStatus } from '../../../src/common/gitProvider/index.js';
import { getDeploymentCommentOutcome } from '../../../src/common/gitProvider/utils/utilsPrCommentLayout.js';

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
      expect(getDeploymentBannerKey(true, 'success')).to.equal('validation-success');
      expect(getDeploymentBannerKey(true, 'failure')).to.equal('validation-failure');
      expect(getDeploymentBannerKey(true, 'waiting-manual-actions')).to.equal('validation-waiting');
    });

    it('returns the deployment banners for a deployment job', () => {
      expect(getDeploymentBannerKey(false, 'success')).to.equal('deployment-success');
      expect(getDeploymentBannerKey(false, 'failure')).to.equal('deployment-failure');
      expect(getDeploymentBannerKey(false, 'deployed-action-failed')).to.equal('deployment-action-failed');
    });

    // A comment posted before the result is known displays its plain title instead
    it('returns no banner while the result is not known', () => {
      expect(getDeploymentBannerKey(true, 'pending')).to.be.undefined;
      expect(getDeploymentBannerKey(false, 'pending')).to.be.undefined;
    });
  });

  describe('getDeploymentCommentOutcome', () => {
    const manual = { commands: [{ id: 'm1', label: 'Do it', type: 'manual', result: { statusCode: 'manual' } }], orgBranch: 'uat' } as any;
    const failedPost = { commands: [{ id: 'p1', label: 'Load', type: 'command', result: { statusCode: 'failed' } }], orgBranch: 'uat' } as any;

    it('reads success and pending from the status', () => {
      expect(getDeploymentCommentOutcome({ status: 'valid' }, true)).to.equal('success');
      expect(getDeploymentCommentOutcome({ deployStatus: 'valid' }, false)).to.equal('success');
      expect(getDeploymentCommentOutcome({}, false)).to.equal('pending');
    });

    // The gate stopped the validation before any simulation: nothing to fix in the code
    it('says a validation stopped only by manual actions is waiting, not failed', () => {
      expect(getDeploymentCommentOutcome({ status: 'invalid', preDeployActions: manual }, true)).to.equal('waiting-manual-actions');
      expect(getDeploymentCommentOutcome({ status: 'invalid', errorCount: 2, preDeployActions: manual }, true)).to.equal('failure');
      expect(getDeploymentCommentOutcome({ status: 'invalid', preDeployActions: manual, postDeployActions: failedPost }, true)).to.equal('failure');
    });

    // Salesforce accepted the metadata: the org has it, what failed came after
    it('says a deployment whose post-deployment action failed is deployed with a failed action', () => {
      expect(getDeploymentCommentOutcome({ status: 'invalid', metadataOutcome: 'deployed', postDeployActions: failedPost }, false)).to.equal('deployed-action-failed');
      expect(getDeploymentCommentOutcome({ status: 'invalid', postDeployActions: failedPost }, false)).to.equal('failure');
      // The coverage is a property of the code: a failure to fix, even after the deployment
      expect(getDeploymentCommentOutcome({ status: 'invalid', metadataOutcome: 'deployed', coverage: { value: 60, target: 75, status: 'invalid' } }, false)).to.equal('failure');
    });
  });
});
