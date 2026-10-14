/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import type { PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';
import {
  buildDeploymentActionsAttachmentText,
  recordExecutedDeploymentActions,
  resetExecutedDeploymentActions,
} from '../../../src/common/utils/deploymentActionsRegistry.js';
import { reinitI18n } from '../../../src/common/utils/i18n.js';

function action(overrides: Partial<PrePostCommand>): PrePostCommand {
  return {
    id: 'action-id',
    label: 'An action',
    type: 'command',
    command: 'echo hello',
    context: 'all',
    when: 'pre-deploy',
    ...overrides,
  } as PrePostCommand;
}

const NO_DEPLOY = { deployExecuted: false, componentsDeployed: 0, componentsDeleted: 0 };
// componentsDeployed is the raw Salesforce figure, deletions included: the row says "42 deployed"
const WITH_DEPLOY = { deployExecuted: true, componentsDeployed: 45, componentsDeleted: 3 };
const WITH_DEPLOY_DETAIL = {
  deployExecuted: true,
  componentsDeployed: 3027,
  componentsDeleted: 2,
  componentsChangeDetail: true,
  componentsCreated: 45,
  componentsUpdated: 83,
  componentsUnchanged: 2897,
};

describe('buildDeploymentActionsAttachmentText()', () => {
  beforeEach(() => {
    resetExecutedDeploymentActions();
  });

  it('returns null when nothing was deployed and no action ran', () => {
    expect(buildDeploymentActionsAttachmentText(false, NO_DEPLOY)).to.equal(null);
  });

  it('returns a single metadata line when a deploy happened without any action', () => {
    const text = buildDeploymentActionsAttachmentText(false, WITH_DEPLOY) || '';
    expect(text).to.contain('Metadata deployment (42 deployed, 3 deleted)');
    expect(text).to.contain('_deploy_');
    // Exactly one action line, and no pre-deploy / post-deploy heading for the empty phases
    expect(text.split('\n').filter((line) => line.startsWith('✅')).length).to.equal(1);
    expect(text).to.not.contain('_pre-deploy_');
    expect(text).to.not.contain('_post-deploy_');
  });

  it('reports what the deployment really changed when the result carried per-component detail', () => {
    const text = buildDeploymentActionsAttachmentText(false, WITH_DEPLOY_DETAIL) || '';
    expect(text).to.contain(
      'Metadata deployment (3027 deployed: 45 created, 83 updated, 2 deleted, 2897 unchanged)'
    );
  });

  it('falls back to the deployed/deleted wording when no per-component detail is available', () => {
    // "0 changed" would claim a no-op deployment, when the truth is that nothing was measured
    const text = buildDeploymentActionsAttachmentText(false, WITH_DEPLOY) || '';
    expect(text).to.contain('Metadata deployment (42 deployed, 3 deleted)');
    expect(text).to.not.contain('unchanged');
  });

  it('renders no markdown table, which chat renderers would fence as ragged monospace', () => {
    recordExecutedDeploymentActions([
      action({ label: 'Some action', result: { statusCode: 'success' } }),
    ]);
    const text = buildDeploymentActionsAttachmentText(false, WITH_DEPLOY) || '';
    expect(text).to.not.contain('|');
  });

  it('omits the status word when the icon already carries it', () => {
    recordExecutedDeploymentActions([
      action({ label: 'Ran fine', result: { statusCode: 'success' } }),
      action({ label: 'To do by hand', type: 'manual', result: { statusCode: 'manual' } }),
    ]);
    const text = buildDeploymentActionsAttachmentText(false, NO_DEPLOY) || '';
    expect(text).to.contain('✅ Ran fine (command)');
    expect(text).to.contain('👋 To do by hand (manual)');
    expect(text).to.not.contain('success');
  });

  it('omits skipped actions and actions that never ran', () => {
    recordExecutedDeploymentActions([
      action({ label: 'Skipped one', result: { statusCode: 'skipped', skippedReason: 'wrong context' } }),
      action({ label: 'Never ran' }),
      action({ label: 'Ran fine', result: { statusCode: 'success' } }),
    ]);
    const text = buildDeploymentActionsAttachmentText(false, NO_DEPLOY) || '';
    expect(text).to.contain('Ran fine');
    expect(text).to.not.contain('Skipped one');
    expect(text).to.not.contain('Never ran');
  });

  it('places the metadata row between pre-deploy and post-deploy actions', () => {
    recordExecutedDeploymentActions([
      action({ label: 'Before', when: 'pre-deploy', result: { statusCode: 'success' } }),
    ]);
    recordExecutedDeploymentActions([
      action({ label: 'After', when: 'post-deploy', result: { statusCode: 'success' } }),
    ]);
    const text = buildDeploymentActionsAttachmentText(false, WITH_DEPLOY) || '';
    expect(text.indexOf('Before')).to.be.lessThan(text.indexOf('Metadata deployment'));
    expect(text.indexOf('Metadata deployment')).to.be.lessThan(text.indexOf('After'));
    // Phase headings appear in execution order
    expect(text.indexOf('_pre-deploy_')).to.be.lessThan(text.indexOf('_deploy_'));
    expect(text.indexOf('_deploy_')).to.be.lessThan(text.indexOf('_post-deploy_'));
  });

  it('groups actions of the same phase under a single heading', () => {
    recordExecutedDeploymentActions([
      action({ label: 'First', when: 'pre-deploy', result: { statusCode: 'success' } }),
      action({ label: 'Second', when: 'pre-deploy', result: { statusCode: 'success' } }),
    ]);
    const text = buildDeploymentActionsAttachmentText(false, NO_DEPLOY) || '';
    expect(text.split('_pre-deploy_').length - 1).to.equal(1);
    expect(text).to.contain('First');
    expect(text).to.contain('Second');
  });

  it('distinguishes an allowed failure from a hard failure', () => {
    recordExecutedDeploymentActions([
      action({ label: 'Tolerated', allowFailure: true, result: { statusCode: 'failed' } }),
      action({ label: 'Blocking', allowFailure: false, result: { statusCode: 'failed' } }),
    ]);
    const text = buildDeploymentActionsAttachmentText(false, NO_DEPLOY) || '';
    expect(text).to.contain('⚠️');
    expect(text).to.contain('❌');
  });

  it('names the source Pull Request when the action came from another PR', () => {
    recordExecutedDeploymentActions([
      action({
        label: 'From other PR',
        result: { statusCode: 'success' },
        pullRequest: { idStr: '123', webUrl: 'https://example.com/pr/123' } as any,
      }),
    ]);
    const text = buildDeploymentActionsAttachmentText(false, NO_DEPLOY) || '';
    expect(text).to.contain('[PR 123](https://example.com/pr/123)');
  });

  it('falls back to a plain Pull Request id when the provider gave no URL', () => {
    recordExecutedDeploymentActions([
      action({
        label: 'From other PR',
        result: { statusCode: 'success' },
        pullRequest: { idStr: '123' } as any,
      }),
    ]);
    const text = buildDeploymentActionsAttachmentText(false, NO_DEPLOY) || '';
    expect(text).to.contain('PR 123');
    expect(text).to.not.contain('](');
  });

  it('keeps one action on exactly one line so the size guard cannot cut it in half', () => {
    recordExecutedDeploymentActions([
      action({ label: 'Multi\nline\r\nlabel', result: { statusCode: 'success' } }),
    ]);
    const text = buildDeploymentActionsAttachmentText(false, NO_DEPLOY) || '';
    expect(text).to.contain('Multi line label');
    expect(text.split('\n').filter((line) => line.startsWith('✅')).length).to.equal(1);
  });

  it('reset clears previously recorded actions', () => {
    recordExecutedDeploymentActions([action({ label: 'Gone', result: { statusCode: 'success' } })]);
    resetExecutedDeploymentActions();
    expect(buildDeploymentActionsAttachmentText(false, NO_DEPLOY)).to.equal(null);
  });

  describe('translation opt-in', () => {
    const originalLang = process.env.SFDX_HARDIS_LANG;

    beforeEach(() => {
      process.env.SFDX_HARDIS_LANG = 'fr';
      reinitI18n();
      recordExecutedDeploymentActions([action({ label: 'Some action', result: { statusCode: 'success' } })]);
    });

    after(() => {
      if (originalLang === undefined) {
        delete process.env.SFDX_HARDIS_LANG;
      } else {
        process.env.SFDX_HARDIS_LANG = originalLang;
      }
      reinitI18n();
    });

    it('stays in English by default even when the locale is not English', () => {
      const text = buildDeploymentActionsAttachmentText(false, WITH_DEPLOY) || '';
      expect(text).to.contain('Deployment Actions');
      expect(text).to.contain('Metadata deployment (42 deployed, 3 deleted)');
      expect(text).to.not.contain('Actions de déploiement');
    });

    it('follows the locale when translation is enabled', () => {
      const text = buildDeploymentActionsAttachmentText(true, WITH_DEPLOY) || '';
      expect(text).to.contain('Actions de déploiement');
      expect(text).to.contain('Déploiement de métadonnées (42 déployées, 3 supprimées)');
    });
  });
});
