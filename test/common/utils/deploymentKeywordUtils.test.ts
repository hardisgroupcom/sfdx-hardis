import { expect } from 'chai';
import {
  commitContainsDeploymentKeyword,
  containsDeploymentKeyword,
  descriptionContainsDeploymentKeyword,
} from '../../../src/common/utils/deploymentKeywordUtils.js';

describe('deploymentKeywordUtils', () => {
  describe('containsDeploymentKeyword', () => {
    it('matches NO_DELTA in any case and spelling', () => {
      for (const text of ['NO_DELTA', 'no_delta', 'NoDelta', 'nodelta', 'NODELTA', 'no-delta', 'No Delta', 'no delta', 'no\tdelta']) {
        expect(containsDeploymentKeyword(text, 'noDelta'), text).to.be.true;
      }
    });

    it('matches the other keywords in any case and spelling', () => {
      expect(containsDeploymentKeyword('purge flow versions', 'purgeFlowVersions')).to.be.true;
      expect(containsDeploymentKeyword('Purge-Flow-Versions', 'purgeFlowVersions')).to.be.true;
      expect(containsDeploymentKeyword('PURGE_FLOW_VERSIONS', 'purgeFlowVersions')).to.be.true;
      expect(containsDeploymentKeyword('destructive_changes_after_deployment', 'destructiveChangesAfterDeployment')).to.be.true;
      expect(containsDeploymentKeyword('NOSMART', 'noSmart')).to.be.true;
      expect(containsDeploymentKeyword('no smart', 'noSmart')).to.be.true;
      expect(containsDeploymentKeyword('no-smart', 'noSmart')).to.be.true;
    });

    it('keeps the forms that matched before', () => {
      for (const text of ['NO_DELTA_UAT', 'NO_DELTA=true', '(NO_DELTA)', '`NO_DELTA`', 'Please NO_DELTA this time', 'fix: x nodelta']) {
        expect(containsDeploymentKeyword(text, 'noDelta'), text).to.be.true;
      }
    });

    it('does not match inside a longer word or across lines', () => {
      for (const text of ['xnodelta', 'nodeltas', 'piano delta', 'no\ndelta', 'node delta', 'no  delta', '', 'delta']) {
        expect(containsDeploymentKeyword(text, 'noDelta'), JSON.stringify(text)).to.be.false;
      }
      expect(containsDeploymentKeyword(null, 'noDelta')).to.be.false;
      expect(containsDeploymentKeyword(undefined, 'noDelta')).to.be.false;
    });
  });

  describe('commitContainsDeploymentKeyword', () => {
    it('matches the subject or the body', () => {
      expect(commitContainsDeploymentKeyword({ message: 'feat: NO_DELTA', body: '' }, 'noDelta')).to.be.true;
      expect(commitContainsDeploymentKeyword({ message: 'feat: something', body: 'no-delta please' }, 'noDelta')).to.be.true;
      expect(commitContainsDeploymentKeyword({ message: 'feat: something', body: 'nothing' }, 'noDelta')).to.be.false;
      expect(commitContainsDeploymentKeyword(null, 'noDelta')).to.be.false;
    });
  });

  describe('descriptionContainsDeploymentKeyword', () => {
    it('matches a keyword in the text, a list or inline code', () => {
      expect(descriptionContainsDeploymentKeyword('Deploy all please\n\nno_delta', 'noDelta')).to.be.true;
      expect(descriptionContainsDeploymentKeyword('- item\n    - NO_DELTA', 'noDelta')).to.be.true;
      expect(descriptionContainsDeploymentKeyword('Use `NO_DELTA` here', 'noDelta')).to.be.true;
      expect(descriptionContainsDeploymentKeyword('```\nexample\n```\nNO_DELTA', 'noDelta')).to.be.true;
    });

    it('ignores HTML comments and code blocks', () => {
      expect(descriptionContainsDeploymentKeyword('<!-- Keywords: NO_DELTA, PURGE_FLOW_VERSIONS -->\nMy change', 'noDelta')).to.be.false;
      expect(descriptionContainsDeploymentKeyword('<!-- PR template:\nPURGE_FLOW_VERSIONS\n-->', 'purgeFlowVersions')).to.be.false;
      expect(descriptionContainsDeploymentKeyword('Example:\n```\nNO_DELTA\n```', 'noDelta')).to.be.false;
      expect(descriptionContainsDeploymentKeyword('Example:\n~~~\nNO_DELTA\n~~~', 'noDelta')).to.be.false;
      expect(descriptionContainsDeploymentKeyword('Example:\n\n    NO_DELTA\n\nEnd.', 'noDelta')).to.be.false;
      expect(descriptionContainsDeploymentKeyword('Example:\n\n\tNO_DELTA', 'noDelta')).to.be.false;
      // An unclosed fence or comment hides everything after it
      expect(descriptionContainsDeploymentKeyword('```\nNO_DELTA', 'noDelta')).to.be.false;
      expect(descriptionContainsDeploymentKeyword('<!--\nNO_DELTA', 'noDelta')).to.be.false;
    });
  });
});
