import c from 'chalk';
import { elapseEnd, uxLog } from '../../common/utils/index.js';
import { Hook } from '@oclif/core';

// The use of this method is deprecated: use NotifProvider.sendNotification :)

const hook: Hook<'postrun'> = async (options) => {
  if (globalThis.hardisLogFileStream) {
    globalThis.hardisLogFileStream.end();
    globalThis.hardisLogFileStream = null;
  }

  // Skip hooks from other commands than hardis commands
  const commandId = options?.Command?.id || '';
  if (!commandId.startsWith('hardis')) {
    return;
  }

  // Close WebSocketClient if existing
  if (globalThis.webSocketClient) {
    try {
      globalThis.webSocketClient.dispose();
    } catch (e) {
      if (options?.Command?.flags?.debug) {
        uxLog(this, c.yellow('Unable to close websocketClient.js') + '\n' + (e as Error).message);
      }
    }
    globalThis.webSocketClient = null;
  }

  elapseEnd(`${options?.Command?.id} execution time`);
};

export default hook;
