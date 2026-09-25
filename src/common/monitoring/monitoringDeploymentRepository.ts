import c from 'chalk';
import * as yaml from 'js-yaml';
import { SfError } from '@salesforce/core';
import fs from '../utils/fsUtils.js';
import { git, uxLog } from '../utils/index.js';
import { prompts } from '../utils/prompts.js';
import { t } from '../utils/i18n.js';

// A monitoring repository has one branch per monitored org, each with its own .sfdx-hardis.yml at the
// root. deploymentRepository is the address of the sfdx-hardis CI/CD repository that deploys to the
// org of the branch, the mirror of monitoringRepository in that CI/CD repository.

export const MONITORING_CONFIG_FILE = '.sfdx-hardis.yml';

// https://host/path, ssh://[user@]host/path or the scp-like form user@host:path
const REPOSITORY_URL_REGEX = /^(?:https?:\/\/[^\s/]+\/\S+|ssh:\/\/\S+\/\S+|[\w.-]+@[\w.-]+:\S+)$/i;

export function isRepositoryUrl(value: string | null | undefined): boolean {
  return REPOSITORY_URL_REGEX.test((value || '').trim());
}

export function getRepositoryHost(repositoryUrl: string | null | undefined): string | null {
  const value = (repositoryUrl || '').trim();
  const scpLike = value.match(/^[\w.-]+@([\w.-]+):/);
  if (scpLike && !/^[a-z][\w+.-]*:\/\//i.test(value)) {
    return scpLike[1].toLowerCase();
  }
  try {
    return new URL(value).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function detectGitServer(repositoryUrl: string | null | undefined): string | null {
  const host = getRepositoryHost(repositoryUrl);
  if (!host) {
    return null;
  }
  const isHostOrSubdomain = (domain: string) => host === domain || host.endsWith('.' + domain);
  if (isHostOrSubdomain('github.com')) {
    return 'GitHub';
  }
  if (isHostOrSubdomain('dev.azure.com') || isHostOrSubdomain('visualstudio.com')) {
    return 'Azure DevOps';
  }
  if (isHostOrSubdomain('bitbucket.org')) {
    return 'Bitbucket';
  }
  // GitLab is often self-hosted: gitlab.com, gitlab.my-company.com...
  if (host.split('.').some((label) => label === 'gitlab' || label.startsWith('gitlab-'))) {
    return 'GitLab';
  }
  return null;
}

export async function readDeploymentRepository(configFile: string = MONITORING_CONFIG_FILE): Promise<string | null> {
  if (!fs.existsSync(configFile)) {
    return null;
  }
  try {
    const branchConfig: any = yaml.load(await fs.readFile(configFile, 'utf8'));
    const value = branchConfig?.deploymentRepository;
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  } catch {
    return null;
  }
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
      const content = await git().show([`${ref}:${MONITORING_CONFIG_FILE}`]);
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

export type DeploymentRepositoryChange =
  | { action: 'set'; value: string }
  | { action: 'clear' }
  | { action: 'none' };

// Decides what to do with deploymentRepository, from the flags or by asking the user.
// An empty answer removes a value set before.
export async function resolveDeploymentRepositoryChange(
  commandThis: any,
  options: { repository?: string; clear?: boolean; interactive: boolean; currentBranch: string },
): Promise<DeploymentRepositoryChange> {
  if (options.clear === true) {
    return { action: 'clear' };
  }
  if (typeof options.repository === 'string') {
    const value = options.repository.trim();
    if (value === '') {
      return { action: 'clear' };
    }
    if (!isRepositoryUrl(value)) {
      throw new SfError(t('deploymentRepositoryPromptInvalid'));
    }
    return { action: 'set', value };
  }
  if (!options.interactive) {
    return { action: 'none' };
  }
  const currentValue = await readDeploymentRepository();
  const suggestedValue = currentValue || (await findDeploymentRepositoryInMonitoringBranches(options.currentBranch)) || '';
  const deploymentRepositoryRes = await prompts({
    type: 'text',
    name: 'value',
    initial: suggestedValue,
    message: c.cyanBright(t('deploymentRepositoryPrompt')),
    description: t('deploymentRepositoryPromptDescription'),
    placeholder: t('deploymentRepositoryPromptPlaceholder'),
    validate: (value: string) => (!value || value.trim() === '' || isRepositoryUrl(value) ? true : t('deploymentRepositoryPromptInvalid')),
  });
  const answer = (deploymentRepositoryRes.value || '').trim();
  if (answer === '') {
    return currentValue ? { action: 'clear' } : { action: 'none' };
  }
  if (!isRepositoryUrl(answer)) {
    uxLog("action", commandThis, c.yellow(t('deploymentRepositoryPromptInvalid')));
    return { action: 'none' };
  }
  return { action: 'set', value: answer };
}

export function logDeploymentRepositoryChange(commandThis: any, change: DeploymentRepositoryChange): void {
  if (change.action === 'set') {
    uxLog("action", commandThis, c.cyan(t('deploymentRepositorySaved', { deploymentRepository: c.bold(change.value) })));
  } else if (change.action === 'clear') {
    uxLog("action", commandThis, c.cyan(t('deploymentRepositoryRemoved')));
  } else {
    uxLog("action", commandThis, c.cyan(t('deploymentRepositorySkipped')));
  }
}
