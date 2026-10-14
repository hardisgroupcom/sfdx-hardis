// Dependency-free environment predicates.
// IMPORTANT: keep this file free of any import: it is used by the init hooks
// and the WebSocket client BEFORE the command boots. Importing anything heavy
// here would delay every sf hardis command startup (see the PERF note in
// common/websocketClient.ts).

export const isCI = process.env.CI != null;

let isAgentModeCache: boolean | null = null;

export function isAgentMode(): boolean {
  if (isAgentModeCache !== null) {
    return isAgentModeCache;
  }
  const argv = (globalThis as any)?.processArgv || process.argv || [];
  const agentMode = argv.some((arg: string) => arg === '--agent' || arg.startsWith('--agent='));
  isAgentModeCache = agentMode;
  return agentMode;
}

// True when the upgrade check must not run at all: CI pipelines (ephemeral
// environments where the banner is noise and the timestamp cache never persists)
// and the standard NO_UPDATE_NOTIFIER opt-out that update-notifier honored.
export function isUpgradeCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_UPDATE_NOTIFIER !== undefined && env.NO_UPDATE_NOTIFIER !== '' && env.NO_UPDATE_NOTIFIER !== 'false') {
    return true;
  }
  return env.CI !== undefined && env.CI !== '' && env.CI !== 'false';
}
