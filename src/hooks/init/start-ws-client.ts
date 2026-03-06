import { Hook } from '@oclif/core';

const hook: Hook<'init'> = async (options) => {
  const commandId = options?.id || '';

  // Skip if command is not in sfdx-hardis or a sfdx-hardis plugin context
  if (!shouldInitWebSocket(commandId, options?.config)) {
    return;
  }

  // Flag that we are in sfdx-hardis or a sfdx-hardis plugin context
  // Set before CI check so it is true even in CI environments
  globalThis.hardisCommandActivated = true;

  // Skip WebSocket initialization in CI environments
  // Inlined isCI check avoids importing the heavy utils module (~2300 lines + transitive deps)
  if (process.env.CI != null) {
    return;
  }

  // Dynamically import only when actually needed (non-CI, eligible command)
  const { WebSocketClient } = await import('../../common/websocketClient.js');

  // Initialize WebSocketClient to communicate with VS Code SFDX Hardis extension
  const context: any = { command: commandId, id: process.pid };
  const websocketArgIndex = options?.argv?.indexOf('--websocket') ?? -1;
  if (
    websocketArgIndex > -1 &&
    options?.argv &&
    options.argv.length > websocketArgIndex + 1
  ) {
    context.websocketHostPort = options.argv[websocketArgIndex + 1];
  }
  globalThis.webSocketClient = new WebSocketClient(context);
  await WebSocketClient.isInitialized();
};

// Check if the WebSocket should be initialized for this command
function shouldInitWebSocket(commandId: string, config: any): boolean {
  // Always activate for hardis commands
  if (commandId.startsWith('hardis')) {
    return true;
  }

  // Check SFDX_HARDIS_PLUGIN_PREFIXES env var for additional command prefixes (comma-separated)
  const extraPrefixes = process.env.SFDX_HARDIS_PLUGIN_PREFIXES;
  if (extraPrefixes) {
    const prefixes = extraPrefixes.split(',').map(p => p.trim()).filter(Boolean);
    if (prefixes.some(prefix => commandId.startsWith(prefix))) {
      return true;
    }
  }

  // Auto-detect: check if the command belongs to a plugin that depends on sfdx-hardis
  if (config) {
    try {
      const command = config.findCommand(commandId);
      const pluginName = command?.pluginName ?? command?.plugin?.name;
      if (pluginName && pluginName !== 'sfdx-hardis') {
        for (const plugin of config.plugins?.values?.() ?? []) {
          if (plugin.name === pluginName) {
            const deps = plugin.pjson?.dependencies ?? {};
            const peerDeps = plugin.pjson?.peerDependencies ?? {};
            if (deps['sfdx-hardis'] || peerDeps['sfdx-hardis']) {
              return true;
            }
            break;
          }
        }
      }
    } catch {
      // Silently ignore lookup errors
    }
  }

  return false;
}

export default hook;
