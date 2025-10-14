import { Hook } from '@oclif/core';

// The use of this method is deprecated: use NotifProvider.sendNotification 😊

const hook: Hook<"finally"> = async (options) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.Command?.id || '';
  if (!commandId.startsWith('hardis')) {
    return;
  }

  // Dynamic import to save perfs when other CLI commands are called
  const c = (await import('chalk')).default;
  const { elapseEnd, uxLog } = await import('../../common/utils/index.js');

  if (globalThis.hardisLogFileStream) {
    globalThis.hardisLogFileStream.end();
    globalThis.hardisLogFileStream = null;
  }

  const status = options?.error ? 'error' : 'success';
  const error = options?.error || null;

  // Close WebSocketClient if existing
  if (globalThis.webSocketClient) {
    try {
      globalThis.webSocketClient.dispose(status, error);
    } catch (e) {
      if (options?.Command?.flags?.debug) {
        uxLog("warning", this, c.yellow('Unable to close websocketClient.js. ') + '\n' + (e as Error).message);
      }
    }
    globalThis.webSocketClient = null;
  }

  const aiCounter = globalThis?.aiCallsNumber || 0;
  if (aiCounter > 0) {
    uxLog("log", this, c.grey(c.italic(`AI prompts API calls: ${aiCounter}.`)));
  }
  elapseEnd(`${options?.Command?.id} execution time`);
};

export default hook;
