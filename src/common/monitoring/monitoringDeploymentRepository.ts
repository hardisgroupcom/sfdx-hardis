import * as yaml from 'js-yaml';
import { git } from '../utils/index.js';

// A monitoring repository has one branch per monitored org, each with its own .sfdx-hardis.yml at the
// root. deploymentRepository is the address of the sfdx-hardis CI/CD repository that deploys to the
// org of the branch, the mirror of monitoringRepository in that CI/CD repository.

export function detectGitServer(repositoryUrl: string | null | undefined): string | null {
  const url = (repositoryUrl || '').toLowerCase();
  if (url === '') {
    return null;
  }
  if (url.includes('github.com')) {
    return 'GitHub';
  }
  if (url.includes('dev.azure.com') || url.includes('visualstudio.com')) {
    return 'Azure DevOps';
  }
  if (url.includes('bitbucket.org')) {
    return 'Bitbucket';
  }
  if (url.includes('gitlab')) {
    return 'GitLab';
  }
  return null;
}

// Reads deploymentRepository from the .sfdx-hardis.yml of the other monitoring branches, so that it
// is typed once per repository and not once per monitored org
export async function findDeploymentRepositoryInMonitoringBranches(currentBranch: string): Promise<string | null> {
  let refs: string[] = [];
  try {
    const output = await git().raw(['for-each-ref', '--format=%(refname:short)', 'refs/heads/', 'refs/remotes/origin/']);
    refs = output
      .split('\n')
      .map((ref) => ref.trim())
      .filter((ref) => ref !== '' && /(^|\/)monitoring_/.test(ref) && ref.replace(/^origin\//, '') !== currentBranch);
  } catch {
    return null;
  }
  for (const ref of refs) {
    try {
      const content = await git().show([`${ref}:.sfdx-hardis.yml`]);
      const config: any = yaml.load(content);
      if (typeof config?.deploymentRepository === 'string' && config.deploymentRepository.trim() !== '') {
        return config.deploymentRepository.trim();
      }
    } catch {
      // No .sfdx-hardis.yml on that branch, or not readable: try the next one
    }
  }
  return null;
}
