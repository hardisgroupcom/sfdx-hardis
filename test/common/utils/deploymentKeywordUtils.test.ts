// cspell:ignore xnodelta nodeltas
import { expect } from 'chai';
import {
  commitContainsDeploymentKeyword,
  containsDeploymentKeyword,
  stripMarkdownCommentsAndFences,
} from '../../../src/common/utils/deploymentKeywordUtils.js';

function inDescription(description: string, keyword: Parameters<typeof containsDeploymentKeyword>[1]): boolean {
  return containsDeploymentKeyword(stripMarkdownCommentsAndFences(description), keyword);
}

describe('deploymentKeywordUtils', () => {
  describe('containsDeploymentKeyword', () => {
    it('matches NO_DELTA and nosmart in any case and spelling', () => {
      for (const text of ['NO_DELTA', 'no_delta', 'NoDelta', 'nodelta', 'NODELTA', 'no-delta', 'No Delta', 'no delta', 'no\tdelta']) {
        expect(containsDeploymentKeyword(text, 'noDelta'), text).to.be.true;
      }
      for (const text of ['NOSMART', 'no smart', 'no-smart', 'No_Smart']) {
        expect(containsDeploymentKeyword(text, 'noSmart'), text).to.be.true;
      }
    });

    it('matches the destructive keywords in any case, with underscores only', () => {
      expect(containsDeploymentKeyword('PURGE_FLOW_VERSIONS', 'purgeFlowVersions')).to.be.true;
      expect(containsDeploymentKeyword('purge_flow_versions', 'purgeFlowVersions')).to.be.true;
      expect(containsDeploymentKeyword('destructive_changes_after_deployment', 'destructiveChangesAfterDeployment')).to.be.true;
      expect(containsDeploymentKeyword('This PR does not purge flow versions', 'purgeFlowVersions')).to.be.false;
      expect(containsDeploymentKeyword('Purge-Flow-Versions', 'purgeFlowVersions')).to.be.false;
      expect(containsDeploymentKeyword('destructive changes after deployment are manual', 'destructiveChangesAfterDeployment')).to.be.false;
    });

    it('keeps the forms that matched before', () => {
      for (const text of ['NO_DELTA_UAT', 'NO_DELTA=true', '(NO_DELTA)', '`NO_DELTA`', 'Please NO_DELTA this time', 'fix: x nodelta', 'Use NO_DELTA.', '- NO_DELTA', 'NO_DELTA - full deploy']) {
        expect(containsDeploymentKeyword(text, 'noDelta'), text).to.be.true;
      }
    });

    it('does not match inside a longer word, a path or a branch name', () => {
      for (const text of [
        'xnodelta',
        'nodeltas',
        'piano delta',
        'no\ndelta',
        'node delta',
        'no  delta',
        '',
        'delta',
        "Merge branch 'fix/no-delta-detection' into integration",
        'Merge pull request #12 from org/feature/no-delta',
        'feature-no-delta',
        'MY_NO_DELTA',
        'no-delta-fix',
      ]) {
        expect(containsDeploymentKeyword(text, 'noDelta'), JSON.stringify(text)).to.be.false;
      }
      expect(containsDeploymentKeyword('Merge pull request #12 from org/feature/no-smart-tests', 'noSmart')).to.be.false;
      expect(containsDeploymentKeyword('force-app/main/default/flows/Purge_Flow_Versions.flow-meta.xml', 'purgeFlowVersions')).to.be.false;
      expect(containsDeploymentKeyword('Purge_Flow_Versions.flow-meta.xml', 'purgeFlowVersions')).to.be.false;
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

    it('ignores a Pull Request template copied into the merge commit', () => {
      expect(
        commitContainsDeploymentKeyword({ message: 'Merged PR 12: my change', body: '<!-- Keywords: NO_DELTA -->\nMy change' }, 'noDelta')
      ).to.be.false;
    });
  });

  describe('stripMarkdownCommentsAndFences', () => {
    it('keeps a keyword in the text, a list, an indented line or inline code', () => {
      expect(inDescription('Deploy all please\n\nno_delta', 'noDelta')).to.be.true;
      expect(inDescription('- item\n    - NO_DELTA', 'noDelta')).to.be.true;
      expect(inDescription('1. Deployment options:\n    NO_DELTA', 'noDelta')).to.be.true;
      expect(inDescription('Use `NO_DELTA` here', 'noDelta')).to.be.true;
      expect(inDescription('```\nexample\n```\nNO_DELTA', 'noDelta')).to.be.true;
      // A stray inline ``` does not open a fence
      expect(inDescription('Wrap code in ``` blocks\n\nNO_DELTA', 'noDelta')).to.be.true;
    });

    it('ignores HTML comments and fenced code blocks', () => {
      expect(inDescription('<!-- Keywords: NO_DELTA, PURGE_FLOW_VERSIONS -->\nMy change', 'noDelta')).to.be.false;
      expect(inDescription('<!-- PR template:\nPURGE_FLOW_VERSIONS\n-->', 'purgeFlowVersions')).to.be.false;
      expect(inDescription('Example:\n```\nNO_DELTA\n```', 'noDelta')).to.be.false;
      expect(inDescription('Example:\n~~~\nNO_DELTA\n~~~', 'noDelta')).to.be.false;
      // An unclosed fence or comment hides everything after it
      expect(inDescription('```\nNO_DELTA', 'noDelta')).to.be.false;
      expect(inDescription('<!--\nNO_DELTA', 'noDelta')).to.be.false;
    });

    it('closes a 4-backtick fence only on a fence at least as long', () => {
      const body = 'Prompt:\n````markdown\nSolve this:\n```xml\n<a/>\n```\nPURGE_FLOW_VERSIONS\n````\nDone.';
      expect(inDescription(body, 'purgeFlowVersions')).to.be.false;
      expect(inDescription(body + '\nPURGE_FLOW_VERSIONS', 'purgeFlowVersions')).to.be.true;
    });
  });
});
