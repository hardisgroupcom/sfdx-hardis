import { Hook } from '@oclif/core';
import { isCI } from '../../common/utils/index.js';
import { WebSocketClient } from '../../common/websocketClient.js';

const hook: Hook<'init'> = async (options) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.id || '';
  if (!commandId.startsWith('hardis')) {
    return;
  }

  // Initialize WebSocketClient to communicate with VsCode SFDX Hardis extension
  if (!isCI) {
    const context: any = { command: commandId, id: process.pid };
    const websocketArgIndex = options?.argv?.indexOf('--websocket');
    if (websocketArgIndex || websocketArgIndex === 0) {
      context.websocketHostPort = options.argv[websocketArgIndex + 1];
    }
    globalThis.webSocketClient = new WebSocketClient(context);
  }
};

export default hook;
