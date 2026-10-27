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
  'user-access-policy',
  'agent-activate',
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

/**
 * Types that only run in the process-deployment-only context, whatever their context holds.
 * A registry rather than a provider method: getEffectiveActionContext is synchronous and called
 * from synchronous code, where no provider class can be loaded.
 */
export const DEPLOYMENT_ONLY_ACTION_TYPES: string[] = ['run-batch', 'user-access-policy', 'agent-activate'];

/**
 * Types that run at every deployment when their runOnlyOnceByOrg is not written: a deployment sets
 * the User Access Policies it contains back to Design, so they are activated again each time, and a
 * deployment may bring a new agent version, which an agent-activate action skips when already active.
 * A registry for the same reason as DEPLOYMENT_ONLY_ACTION_TYPES: read by synchronous code.
 */
export const RUN_AT_EVERY_DEPLOYMENT_BY_DEFAULT_ACTION_TYPES: string[] = ['user-access-policy', 'agent-activate'];

/** runOnlyOnceByOrg of an action, with the default of its type when it is not written. */
export function resolveRunOnlyOnceByOrg(action: { type?: string; runOnlyOnceByOrg?: boolean } | null | undefined): boolean {
  if (action?.runOnlyOnceByOrg === true || action?.runOnlyOnceByOrg === false) {
    return action.runOnlyOnceByOrg;
  }
  return !RUN_AT_EVERY_DEPLOYMENT_BY_DEFAULT_ACTION_TYPES.includes(action?.type || '');
}

/** Every type implemented by sfdx-hardis: a custom function id may not shadow one of them. */
export const RESERVED_ACTION_TYPES: string[] = [...DEPLOYMENT_ACTION_TYPES, ...ORG_INIT_ONLY_ACTION_TYPES];

export function isOrgInitOnlyActionType(type: string | undefined | null): boolean {
  return !!type && (ORG_INIT_ONLY_ACTION_TYPES as readonly string[]).includes(type);
}
