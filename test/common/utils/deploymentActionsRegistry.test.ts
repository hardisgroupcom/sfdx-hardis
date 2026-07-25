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
const WITH_DEPLOY = { deployExecuted: true, componentsDeployed: 42, componentsDeleted: 3 };

describe('buildDeploymentActionsAttachmentText()', () => {
  beforeEach(() => {
    resetExecutedDeploymentActions();
  });

  it('returns null when nothing was deployed and no action ran', () => {
    expect(buildDeploymentActionsAttachmentText(false, NO_DEPLOY)).to.equal(null);
  });

  it('returns a single metadata row when a deploy happened without any action', () => {
    const text = buildDeploymentActionsAttachmentText(false, WITH_DEPLOY) || '';
    expect(text).to.contain('42');
    expect(text).to.contain('3');
    expect(text).to.contain('| metadata |');
    // Header row, separator row, and exactly one data row
    expect(text.split('\n').filter((line) => line.startsWith('| ')).length).to.equal(2);
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
    expect(text.indexOf('Before')).to.be.lessThan(text.indexOf('| metadata |'));
    expect(text.indexOf('| metadata |')).to.be.lessThan(text.indexOf('After'));
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
    expect(text).to.contain('From other PR (PR 123)');
  });

  it('does not emit a markdown link in the table, which renderers would fence as literal text', () => {
    recordExecutedDeploymentActions([
      action({
        label: 'From other PR',
        result: { statusCode: 'success' },
        pullRequest: { idStr: '123', webUrl: 'https://example.com/pr/123' } as any,
      }),
    ]);
    const text = buildDeploymentActionsAttachmentText(false, NO_DEPLOY) || '';
    expect(text).to.not.contain('](');
    expect(text).to.not.contain('https://example.com/pr/123');
  });

  it('escapes pipe characters so a label cannot break the table', () => {
    recordExecutedDeploymentActions([
      action({ label: 'A | B', result: { statusCode: 'success' } }),
    ]);
    const text = buildDeploymentActionsAttachmentText(false, NO_DEPLOY) || '';
    expect(text).to.contain('A \\| B');
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
