// Action type lists shared by the deployment actions and the org initialization steps.
// This module imports nothing, so any module can read it without creating an import cycle.

/** Types a deployment action (commandsPreDeploy / commandsPostDeploy) can use. */
export const DEPLOYMENT_ACTION_TYPES = [
  'command',
  'data',
  'apex',
  'publish-community',
  'manual',
  'schedule-batch',
  'run-batch',
  'remove-packagexml-items',
] as const;

/**
 * Types that only exist in orgInitSteps. They never appear in deployment actions:
 * deploy:smart already installs packages and deploys sources, and a permission set assignment
 * only reaches the user running the command.
 */
export const ORG_INIT_ONLY_ACTION_TYPES = ['install-packages', 'deploy-sources', 'assign-permission-sets'] as const;

/** Built-in types an org initialization step can use (a custom function id is also valid). */
export const ORG_INIT_ACTION_TYPES = [
  'install-packages',
  'deploy-sources',
  'assign-permission-sets',
  'apex',
  'data',
  'command',
  'run-batch',
  'schedule-batch',
  'publish-community',
] as const;

/** Every type implemented by sfdx-hardis: a custom function id may not shadow one of them. */
export const RESERVED_ACTION_TYPES: string[] = [...DEPLOYMENT_ACTION_TYPES, ...ORG_INIT_ONLY_ACTION_TYPES];

export function isOrgInitOnlyActionType(type: string | undefined | null): boolean {
  return !!type && (ORG_INIT_ONLY_ACTION_TYPES as readonly string[]).includes(type);
}
