import { Hook } from '@oclif/core';

// Commands that never need a WebSocket connection (CLI-only).
// Keep in sync with classes that declare `public static disableWebsocket = true`.
const DISABLE_WEBSOCKET_COMMANDS = new Set([
  'hardis:cache:clear',
  'hardis:config:get',
  'hardis:config:monitoring-defaults',
]);

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

  // Skip WebSocket initialization when running in agent mode or requesting help.
  // isAgentMode comes from the dependency-free envUtils leaf module so the
  // heavy utils barrel (langchain, puppeteer, jira, ... 1000+ modules) is
  // never loaded before the WebSocket connects: the VS Code extension gets
  // feedback as early as possible.
  const { isAgentMode } = await import('../../common/utils/envUtils.js');
  if (isAgentMode() || options?.argv?.includes('--help') || options?.argv?.includes('-h')) {
    return;
  }

  // Fast path: skip WebSocket for known CLI-only commands without loading the class
  if (DISABLE_WEBSOCKET_COMMANDS.has(commandId)) {
    return;
  }

  const { WebSocketClient } = await import('../../common/websocketClient.js');

  // Initialize WebSocketClient to communicate with VS Code SFDX Hardis extension.
  // When the extension spawned this process, it passes a provisional context id
  // (SFDX_HARDIS_COMMAND_CONTEXT_ID) so it can open the command execution panel
  // at click time and have this client adopt it on connection.
  const context: any = {
    command: commandId,
    id: process.env.SFDX_HARDIS_COMMAND_CONTEXT_ID || process.pid,
  };
  // Consume the provisional id: child `sf hardis:*` processes spawned by this
  // command inherit the environment, and reusing the same id would make the
  // extension conflate their panels (and cancel/close the wrong command)
  delete process.env.SFDX_HARDIS_COMMAND_CONTEXT_ID;

  // Resolve the plugin root from the manifest (cheap, no class loading)
  let cmd: any = null;
  try {
    cmd = options?.config?.findCommand(commandId);
    const pluginRoot = cmd?.plugin?.root;
    if (pluginRoot) {
      context.commandPluginRoot = pluginRoot;
    }
  } catch {
    // Silently ignore - commandPluginRoot is optional
  }

  const websocketArgIndex = options?.argv?.indexOf('--websocket') ?? -1;
  if (
    websocketArgIndex > -1 &&
    options?.argv &&
    options.argv.length > websocketArgIndex + 1
  ) {
    context.websocketHostPort = options.argv[websocketArgIndex + 1];
  }
  // Connect FIRST so the VS Code extension gets instant feedback, then check
  // disableWebsocket on the command class (loading it can take seconds for
  // heavy commands - it used to block the connection). sfdx-hardis own
  // CLI-only commands are already excluded above without any class loading,
  // so the check only runs for third-party plugin commands.
  globalThis.webSocketClient = new WebSocketClient(context);
  const pluginName = (cmd as any)?.pluginName ?? (cmd as any)?.plugin?.name;
  if (pluginName && pluginName !== 'sfdx-hardis') {
    try {
      const cmdClass = await cmd?.load();
      if ((cmdClass as any)?.disableWebsocket === true) {
        globalThis.webSocketClient.dispose();
        globalThis.webSocketClient = null;
        return;
      }
    } catch {
      // Silently ignore - disableWebsocket check is best-effort
    }
  }
  // Warm the command-module import while waiting for the extension's answer:
  // oclif awaits the exact same import right after the init hooks and the ESM
  // loader deduplicates it. When the extension never answers (older extension
  // versions), the import runs during the 10s safety timeout instead of after
  // it. The warm-up only starts once initClient has been sent: the import
  // starves the event loop, and starting it earlier delays the WebSocket
  // handshake (and the instant feedback in VS Code) by several seconds.
  // Third-party plugin commands were already loaded above for the
  // disableWebsocket check.
  if (!pluginName || pluginName === 'sfdx-hardis') {
    WebSocketClient.waitForInitClientSent()
      ?.then(() => cmd?.load())
      ?.catch(() => {
        // Best-effort warm-up: oclif surfaces the real error on its own load
      });
  }
  await WebSocketClient.isInitialized();
};

// Check if the WebSocket should be initialized for this command
function shouldInitWebSocket(commandId: string, config: any): boolean {
  // Always activate for hardis commands
  if (commandId.startsWith('hardis')) {
    return true;
  }

  // Always deactivate when listing commands
  if (commandId.includes("hardis-commands")) {
    return false;
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
      if (command.pluginType === 'core') {
        return false; // Core commands are not from plugins, so we can skip
      }
      if (command.hidden === true) {
        return false; // Hidden commands are likely not meant for end-users, so we can skip
      }
      const pluginName = command?.pluginName ?? command?.plugin?.name;
      if (!pluginName || ["sfdx-git-delta", "sfdmu", "sf-git-merge-driver"].includes(pluginName)) {
        return false; // If we can't determine the plugin, we can't assume it depends on sfdx-hardis
      }
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
    } catch {
      // Silently ignore lookup errors
    }
  }

  return false;
}

export default hook;
