/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AGENTS_MD_END_MARKER,
  AGENTS_MD_START_MARKER,
  buildDeploymentRepositoryStatus,
  buildMonitoringAgentsMdBlock,
  mergeAgentsMdBlock,
  writeMonitoringAgentsMd,
} from '../../../src/common/monitoring/monitoringAgentsMd.js';
import { detectGitServer } from '../../../src/common/monitoring/monitoringDeploymentRepository.js';

const block = `${AGENTS_MD_START_MARKER}\nsfdx-hardis content v2\n${AGENTS_MD_END_MARKER}\n`;

describe('monitoringAgentsMd', () => {
  describe('mergeAgentsMdBlock', () => {
    it('returns the block when there is no file', () => {
      expect(mergeAgentsMdBlock(null, block)).to.equal(block);
      expect(mergeAgentsMdBlock('  \n', block)).to.equal(block);
    });

    it('replaces the block and keeps what the user wrote around it', () => {
      const existing = `Intro\n${AGENTS_MD_START_MARKER}\nsfdx-hardis content v1\n${AGENTS_MD_END_MARKER}\n\n## Our notes\n\nKeep me\n`;
      expect(mergeAgentsMdBlock(existing, block)).to.equal(`Intro\n${block}\n## Our notes\n\nKeep me\n`);
    });

    it('is stable when run twice', () => {
      const once = mergeAgentsMdBlock(`${block}\nNotes\n`, block);
      expect(mergeAgentsMdBlock(once, block)).to.equal(once);
    });

    it('appends the block to a file written by hand', () => {
      expect(mergeAgentsMdBlock('# Our own AGENTS.md\r\n\r\n', block)).to.equal(`# Our own AGENTS.md\n\n${block}`);
    });
  });

  describe('buildMonitoringAgentsMdBlock', () => {
    it('lists the checks with the frequencies of the configuration', async () => {
      const content = await buildMonitoringAgentsMdBlock({
        monitoringCommands: [
          { key: 'LICENSES', frequency: 'monthly', frequencyDayOfMonth: 1 },
          { key: 'MY_CUSTOM', title: 'My custom check', command: 'sf my:custom', frequency: 'weekly', frequencyDay: 'monday' },
        ],
        monitoringDisable: ['ORG_LIMITS'],
      });
      expect(content.startsWith(AGENTS_MD_START_MARKER)).to.be.true;
      expect(content.trimEnd().endsWith(AGENTS_MD_END_MARKER)).to.be.true;
      expect(content).to.not.include('{{monitoringCommandsTable}}');
      expect(content).to.include('| `LICENSES` |');
      expect(content).to.include('| monthly (day 1) |');
      expect(content).to.include('| `MY_CUSTOM` | My custom check | `sf my:custom` | weekly (monday) |');
      expect(content).to.match(/\| `ORG_LIMITS` \|.*\| disabled \(monitoringDisable\) \|/);
    });
  });

  describe('deployment repository', () => {
    it('detects the git server from the repository address', () => {
      expect(detectGitServer('https://github.com/my-company/my-project')).to.equal('GitHub');
      expect(detectGitServer('git@github.com:my-company/my-project.git')).to.equal('GitHub');
      expect(detectGitServer('https://gitlab.my-company.com/group/sub/project.git')).to.equal('GitLab');
      expect(detectGitServer('https://my-org@dev.azure.com/my-org/My%20Project/_git/my-project')).to.equal('Azure DevOps');
      expect(detectGitServer('https://my-org.visualstudio.com/project/_git/repo')).to.equal('Azure DevOps');
      expect(detectGitServer('https://bitbucket.org/workspace/repo.git')).to.equal('Bitbucket');
      expect(detectGitServer('https://git.my-company.com/repo.git')).to.be.null;
      expect(detectGitServer('')).to.be.null;
    });

    it('tells the agent to ask for the setting when there is none', () => {
      expect(buildDeploymentRepositoryStatus({})).to.include('No deployment repository is configured');
      expect(buildDeploymentRepositoryStatus({ deploymentRepository: '  ' })).to.include('No deployment repository is configured');
    });

    it('names the repository, its git server and the branch when set', () => {
      const withoutBranch = buildDeploymentRepositoryStatus({ deploymentRepository: 'https://gitlab.com/group/project' });
      expect(withoutBranch).to.include('`https://gitlab.com/group/project` (GitLab)');
      expect(withoutBranch).to.include('as explained below');
      const withBranch = buildDeploymentRepositoryStatus({ deploymentRepository: 'https://github.com/a/b', deploymentBranch: 'main' });
      expect(withBranch).to.include('Its branch `main` deploys to this org');
    });

    it('fills the status in the rendered block', async () => {
      const content = await buildMonitoringAgentsMdBlock({ deploymentRepository: 'https://github.com/a/b' });
      expect(content).to.not.include('{{deploymentRepositoryStatus}}');
      expect(content).to.include('The deployment repository of this org is `https://github.com/a/b` (GitHub)');
    });
  });

  describe('writeMonitoringAgentsMd', () => {
    let tmpDir: string;
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-md-'));
    });
    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates AGENTS.md and CLAUDE.md, then changes nothing on the next run', async () => {
      expect(await writeMonitoringAgentsMd({}, tmpDir)).to.deep.equal(['AGENTS.md', 'CLAUDE.md']);
      expect(fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8')).to.equal('@AGENTS.md\n');
      expect(await writeMonitoringAgentsMd({}, tmpDir)).to.deep.equal([]);
    });

    it('never overwrites an existing CLAUDE.md', async () => {
      fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'Our rules\n');
      expect(await writeMonitoringAgentsMd({}, tmpDir)).to.deep.equal(['AGENTS.md']);
      expect(fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8')).to.equal('Our rules\n');
    });
  });
});
