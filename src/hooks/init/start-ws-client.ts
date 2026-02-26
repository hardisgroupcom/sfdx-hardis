import { Hook } from '@oclif/core';

const hook: Hook<'init'> = async (options) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.id || '';
  if (!commandId.startsWith('hardis')) {
    return;
  }

  // Skip WebSocket initialization in CI environments
  // Inlined isCI check avoids importing the heavy utils module (~2300 lines + transitive deps)
  if (process.env.CI != null) {
    return;
  }

  // Dynamically import only when actually needed (non-CI, hardis command)
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

export default hook;
