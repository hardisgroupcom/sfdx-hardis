import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { PACKAGE_ROOT_DIR } from '../../src/settings.js';
import { MONITORING_TEMPLATE_LINKS } from '../../src/common/monitoring/monitoringTemplateLinks.js';

// The CI/CD definition files sfdx-hardis copies into projects. Each one names its template, so a
// coding agent asked to upgrade the file of a project knows where the latest version is.
const PIPELINE_PATTERNS = [
  'defaults/**/.github/workflows/*.yml',
  'defaults/**/.gitlab-ci.yml',
  'defaults/**/.gitlab-ci-config.yml',
  'defaults/**/azure-pipelines*.yml',
  'defaults/**/bitbucket-pipelines.yml',
  'defaults/**/Jenkinsfile',
];

async function listPipelineFiles(): Promise<string[]> {
  const files = await glob(PIPELINE_PATTERNS, { cwd: PACKAGE_ROOT_DIR, dot: true, posix: true });
  return [...new Set(files)].sort();
}

describe('Default pipeline files', () => {
  it('are found', async () => {
    const files = await listPipelineFiles();
    expect(files).to.include('defaults/ci/.gitlab-ci.yml');
    expect(files).to.include('defaults/ci/.github/workflows/check-major-branch-deploy.yml');
    expect(files).to.include('defaults/ci/azure-pipelines-major-branch-check.yml');
    expect(files).to.include('defaults/monitoring/Jenkinsfile');
  });

  it('each start with the URL of their own template', async () => {
    for (const file of await listPipelineFiles()) {
      const content = fs.readFileSync(path.join(PACKAGE_ROOT_DIR, file), 'utf8');
      const head = content.split(/\r?\n/).slice(0, 12).join('\n');
      expect(head, file).to.include('Source of this file: the sfdx-hardis default template');
      expect(head, file).to.include(`https://github.com/hardisgroupcom/sfdx-hardis/blob/main/${file}`);
      expect(head, file).to.include(`https://raw.githubusercontent.com/hardisgroupcom/sfdx-hardis/main/${file}`);
    }
  });

  it('keep the YAML document start on the first line', async () => {
    for (const file of (await listPipelineFiles()).filter((f) => f.endsWith('.yml'))) {
      const firstLine = fs.readFileSync(path.join(PACKAGE_ROOT_DIR, file), 'utf8').split(/\r?\n/)[0];
      expect(firstLine === '---' || firstLine.startsWith('#'), file).to.equal(true);
    }
  });
});

describe('Links to lines of the monitoring templates', () => {
  for (const link of MONITORING_TEMPLATE_LINKS) {
    it(`${link.platform}: line ${link.line} of ${link.file} holds ${link.expected}`, () => {
      const lines = fs.readFileSync(path.join(PACKAGE_ROOT_DIR, link.file), 'utf8').split(/\r?\n/);
      expect(lines[link.line - 1]).to.include(link.expected);
    });
  }
});
