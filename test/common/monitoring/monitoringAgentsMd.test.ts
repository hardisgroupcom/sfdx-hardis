/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AGENTS_MD_END_MARKER,
  AGENTS_MD_START_MARKER,
  buildDeploymentRepositoryStatus,
  buildGrafanaStatus,
  buildMonitoringAgentsMdBlock,
  mergeAgentsMdBlock,
  writeMonitoringAgentsMd,
} from '../../../src/common/monitoring/monitoringAgentsMd.js';
import { isRepositoryUrl } from '../../../src/common/monitoring/monitoringDeploymentRepository.js';
import { GitProvider } from '../../../src/common/gitProvider/index.js';
import { getMonitoringDisable } from '../../../src/common/notifProvider/notificationConfig.js';
import { removeFromConfigFile, setInConfigFile } from '../../../src/config/index.js';

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
      const once = mergeAgentsMdBlock(`${block}\nNotes\n`, block) as string;
      expect(mergeAgentsMdBlock(once, block)).to.equal(once);
    });

    it('appends the block to a file written by hand', () => {
      expect(mergeAgentsMdBlock('# Our own AGENTS.md\r\n\r\n', block)).to.equal(`# Our own AGENTS.md\n\n${block}`);
    });

    it('leaves a file with broken markers alone instead of deleting notes', () => {
      // End marker deleted by hand: appending a block would pair the old start with the new end next time
      expect(mergeAgentsMdBlock(`${AGENTS_MD_START_MARKER}\nold block\n\n## Our notes\n`, block)).to.be.null;
      expect(mergeAgentsMdBlock(`## Our notes\n${AGENTS_MD_END_MARKER}\n`, block)).to.be.null;
      expect(mergeAgentsMdBlock(`${AGENTS_MD_END_MARKER}\nnotes\n${AGENTS_MD_START_MARKER}\n`, block)).to.be.null;
      expect(mergeAgentsMdBlock(`${block}\nnotes\n${block}`, block)).to.be.null;
    });
  });

  describe('buildMonitoringAgentsMdBlock', () => {
    it('lists the checks with the frequencies of the configuration', async () => {
      const content = await buildMonitoringAgentsMdBlock({
        monitoringCommands: [
          { key: 'LICENSES', frequency: 'monthly', frequencyDayOfMonth: 15 },
          { key: 'MY_CUSTOM', title: 'My custom check', command: 'sf my:custom', frequency: 'weekly', frequencyDay: 'monday' },
        ],
        monitoringDisable: ['ORG_LIMITS'],
      });
      expect(content.startsWith(AGENTS_MD_START_MARKER)).to.be.true;
      expect(content.trimEnd().endsWith(AGENTS_MD_END_MARKER)).to.be.true;
      expect(content).to.not.include('{{monitoringCommandsTable}}');
      expect(content).to.include('| monthly (day 15) |');
      expect(content).to.include('| `MY_CUSTOM` | My custom check | `sf my:custom` | weekly (monday) |');
      expect(content).to.match(/\| `ORG_LIMITS` \|.*\| disabled \(monitoringDisable\) \|/);
    });

    it('shows the day a weekly check runs when the configuration sets none', async () => {
      const content = await buildMonitoringAgentsMdBlock({});
      expect(content).to.match(/\| `LICENSES` \|.*\| weekly \(saturday\) \|/);
    });

    it('copies $ patterns of the configuration as they are', async () => {
      const content = await buildMonitoringAgentsMdBlock({
        monitoringCommands: [{ key: 'DOLLARS', title: "Price $' check $&", command: "sf my:check --pattern '$$'", frequency: 'daily' }],
        deploymentRepository: 'https://github.com/a/$$b',
      });
      expect(content).to.include("| `DOLLARS` | Price $' check $& | `sf my:check --pattern '$$'` | daily |");
      expect(content).to.include('`https://github.com/a/$$b`');
    });
  });

  describe('getMonitoringDisable', () => {
    const previous = process.env.MONITORING_DISABLE;
    afterEach(() => {
      if (previous === undefined) {
        delete process.env.MONITORING_DISABLE;
      } else {
        process.env.MONITORING_DISABLE = previous;
      }
    });

    it('trims the keys of the env var and of the configuration', () => {
      process.env.MONITORING_DISABLE = 'AUDIT_TRAIL, LICENSES ,';
      expect(getMonitoringDisable({})).to.deep.equal(['AUDIT_TRAIL', 'LICENSES']);
      delete process.env.MONITORING_DISABLE;
      expect(getMonitoringDisable({ monitoringDisable: [' ORG_LIMITS '] })).to.deep.equal(['ORG_LIMITS']);
      expect(getMonitoringDisable({ monitoringDisable: [] })).to.deep.equal([]);
    });

    it('gives the env var priority over the configuration', () => {
      process.env.MONITORING_DISABLE = 'AUDIT_TRAIL';
      expect(getMonitoringDisable({ monitoringDisable: ['ORG_LIMITS'] })).to.deep.equal(['AUDIT_TRAIL']);
    });

    it('ignores an empty env var and an Azure variable that was never defined', () => {
      process.env.MONITORING_DISABLE = '  ';
      expect(getMonitoringDisable({ monitoringDisable: ['ORG_LIMITS'] })).to.deep.equal(['ORG_LIMITS']);
      process.env.MONITORING_DISABLE = '$(MONITORING_DISABLE)';
      expect(getMonitoringDisable({ monitoringDisable: ['ORG_LIMITS'] })).to.deep.equal(['ORG_LIMITS']);
    });
  });

  describe('grafana', () => {
    it('tells the agent to ask for the instance when there is none, never for a token in the file', () => {
      const status = buildGrafanaStatus({});
      expect(status).to.include('No Grafana instance is configured');
      expect(status).to.include('`grafanaUrl: <url>` in `.sfdx-hardis.yml`');
      expect(status).to.include('never write a token in that file');
    });

    it('names the instance and the datasource uids when set', () => {
      expect(buildGrafanaStatus({ grafanaUrl: 'https://acme.grafana.net' })).to.equal(
        'The Grafana instance that receives the monitoring results is `https://acme.grafana.net` (`grafanaUrl` in `.sfdx-hardis.yml`).'
      );
      const withUids = buildGrafanaStatus({
        grafanaUrl: 'https://acme.grafana.net',
        grafanaLokiDatasourceUid: 'grafanacloud-logs',
        grafanaPrometheusDatasourceUid: 'grafanacloud-prom',
      });
      expect(withUids).to.include('Its Loki datasource uid is `grafanacloud-logs`.');
      expect(withUids).to.include('Its Prometheus datasource uid is `grafanacloud-prom`.');
    });

    it('fills the Grafana section of the rendered block', async () => {
      const content = await buildMonitoringAgentsMdBlock({ grafanaUrl: 'https://acme.grafana.net' });
      expect(content).to.not.include('{{grafanaStatus}}');
      expect(content).to.include('## Monitoring results in Grafana');
      expect(content).to.include('`https://acme.grafana.net`');
    });

    it('keeps the LogQL line_format templates of the recipes, which look like placeholders', async () => {
      const content = await buildMonitoringAgentsMdBlock({});
      expect(content).to.include('line_format "{{.t}}" | keep type');
      expect(content).to.not.match(/\{\{[a-zA-Z]+\}\}/);
    });
  });

  describe('deployment repository', () => {
    it('detects the git provider from the host of the address', () => {
      expect(GitProvider.getProviderTypeFromRemoteUrl('https://github.com/my-company/my-project')).to.equal('github');
      expect(GitProvider.getProviderTypeFromRemoteUrl('git@github.com:my-company/my-project.git')).to.equal('github');
      expect(GitProvider.getProviderTypeFromRemoteUrl('https://gitlab.my-company.com/group/sub/project.git')).to.equal('gitlab');
      expect(GitProvider.getProviderTypeFromRemoteUrl('https://my-org@dev.azure.com/my-org/My%20Project/_git/my-project')).to.equal('azure');
      expect(GitProvider.getProviderTypeFromRemoteUrl('git@ssh.dev.azure.com:v3/my-org/project/repo')).to.equal('azure');
      expect(GitProvider.getProviderTypeFromRemoteUrl('https://my-org.visualstudio.com/project/_git/repo')).to.equal('azure');
      expect(GitProvider.getProviderTypeFromRemoteUrl('https://bitbucket.org/workspace/repo.git')).to.equal('bitbucket');
      expect(GitProvider.getProviderTypeFromRemoteUrl('https://git.my-company.com/repo.git')).to.be.null;
      expect(GitProvider.getProviderTypeFromRemoteUrl('')).to.be.null;
    });

    it('does not read the git provider from the path of the address', () => {
      expect(GitProvider.getProviderTypeFromRemoteUrl('https://gitlab.acme.com/team/github.com-mirror')).to.equal('gitlab');
      expect(GitProvider.getProviderTypeFromRemoteUrl('https://git.acme.com/gitlab-tools/sf.git')).to.be.null;
      expect(GitProvider.getProviderTypeFromRemoteUrl('ssh://git@gitlab.acme.com:2222/team/repo.git')).to.equal('gitlab');
    });

    it('does not guess from the CI variables of the running job', () => {
      const previous = process.env.GITHUB_ACTIONS;
      process.env.GITHUB_ACTIONS = 'true';
      try {
        expect(GitProvider.getProviderTypeFromRemoteUrl('https://git.my-company.com/team/repo.git')).to.be.null;
      } finally {
        if (previous === undefined) {
          delete process.env.GITHUB_ACTIONS;
        } else {
          process.env.GITHUB_ACTIONS = previous;
        }
      }
    });

    it('accepts only git repository addresses', () => {
      expect(isRepositoryUrl('https://github.com/my-company/my-project')).to.be.true;
      expect(isRepositoryUrl('git@github.com:my-company/my-project.git')).to.be.true;
      expect(isRepositoryUrl('ssh://git@gitlab.acme.com:2222/team/repo.git')).to.be.true;
      expect(isRepositoryUrl('my-project')).to.be.false;
      expect(isRepositoryUrl('https://github.com')).to.be.false;
      expect(isRepositoryUrl('')).to.be.false;
    });

    it('tells the agent to ask for the setting when there is none', () => {
      expect(buildDeploymentRepositoryStatus({})).to.include('No deployment repository is configured');
      expect(buildDeploymentRepositoryStatus({})).to.include('`deploymentRepository: <address>` in `.sfdx-hardis.yml`');
      expect(buildDeploymentRepositoryStatus({ deploymentRepository: '  ' })).to.include('No deployment repository is configured');
    });

    it('names the repository, its git server and the branch when set', () => {
      const withoutBranch = buildDeploymentRepositoryStatus({ deploymentRepository: 'https://gitlab.com/group/project' });
      expect(withoutBranch).to.include('`https://gitlab.com/group/project` (git provider: `gitlab`)');
      expect(withoutBranch).to.include('as explained below');
      const withBranch = buildDeploymentRepositoryStatus({ deploymentRepository: 'https://github.com/a/b', deploymentBranch: 'main' });
      expect(withBranch).to.include('Its branch `main` deploys to this org');
    });

    it('fills the status in the rendered block', async () => {
      const content = await buildMonitoringAgentsMdBlock({ deploymentRepository: 'https://github.com/a/b' });
      expect(content).to.not.include('{{deploymentRepositoryStatus}}');
      expect(content).to.include('The deployment repository of this org is `https://github.com/a/b` (git provider: `github`)');
    });
  });

  describe('config file edits', () => {
    let tmpDir: string;
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-config-'));
    });
    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('sets and removes deploymentRepository, keeping the rest and the comments', async () => {
      const configFile = path.join(tmpDir, '.sfdx-hardis.yml');
      fs.writeFileSync(configFile, '# monitored org\ninstanceUrl: https://x.my.salesforce.com\n');
      await setInConfigFile([], { deploymentRepository: 'https://github.com/a/b' }, configFile);
      expect(fs.readFileSync(configFile, 'utf8')).to.include('deploymentRepository: https://github.com/a/b');
      await removeFromConfigFile(configFile, ['deploymentRepository']);
      expect(fs.readFileSync(configFile, 'utf8')).to.equal('# monitored org\ninstanceUrl: https://x.my.salesforce.com\n');
    });

    it('refuses to rewrite a file that is not valid YAML', async () => {
      const configFile = path.join(tmpDir, '.sfdx-hardis.yml');
      const broken = 'instanceUrl: https://x.my.salesforce.com\nmonitoringCommands:\n  - key: A\n - key: B\n';
      fs.writeFileSync(configFile, broken);
      let error: Error | null = null;
      try {
        await setInConfigFile([], { deploymentRepository: 'https://github.com/a/b' }, configFile);
      } catch (e) {
        error = e as Error;
      }
      expect(error?.message).to.include('is not valid YAML');
      expect(fs.readFileSync(configFile, 'utf8')).to.equal(broken);
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
      expect(await writeMonitoringAgentsMd({}, tmpDir)).to.deep.equal({ updatedFiles: ['AGENTS.md', 'CLAUDE.md'], markersBroken: false });
      expect(fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8')).to.equal('@AGENTS.md\n');
      expect(await writeMonitoringAgentsMd({}, tmpDir)).to.deep.equal({ updatedFiles: [], markersBroken: false });
    });

    it('never overwrites an existing CLAUDE.md', async () => {
      fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'Our rules\n');
      expect((await writeMonitoringAgentsMd({}, tmpDir)).updatedFiles).to.deep.equal(['AGENTS.md']);
      expect(fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8')).to.equal('Our rules\n');
    });

    it('reports broken markers and leaves AGENTS.md as it is', async () => {
      const content = `${AGENTS_MD_START_MARKER}\nold\n\n## Our notes\n`;
      fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), content);
      const result = await writeMonitoringAgentsMd({}, tmpDir);
      expect(result.markersBroken).to.be.true;
      expect(fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8')).to.equal(content);
    });
  });
});
