import { Hook } from '@oclif/core';

const hook: Hook<'init'> = async (options) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.id || '';
  if (!commandId.startsWith('hardis')) {
    return;
  }

  // Dynamically import libraries to avoid loading it if not needed
  const { isCI } = await import('../../common/utils/index.js');
  const { WebSocketClient } = await import('../../common/websocketClient.js');

  // Initialize WebSocketClient to communicate with VS Code SFDX Hardis extension
  if (!isCI) {
    const context: any = { command: commandId, id: process.pid };
    const websocketArgIndex = options?.argv?.indexOf('--websocket');
    if (websocketArgIndex || websocketArgIndex === 0) {
      context.websocketHostPort = options.argv[websocketArgIndex + 1];
    }
    globalThis.webSocketClient = new WebSocketClient(context);
    await WebSocketClient.isInitialized();
  }
};

export default hook;
