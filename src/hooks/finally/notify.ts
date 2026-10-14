import { Hook } from '@oclif/core';

// The use of this method is deprecated: use NotifProvider.sendNotification 😊

const hook: Hook<"finally"> = async (options) => {
  // Skip hooks from commands that are not in sfdx-hardis or a sfdx-hardis plugin context
  if (!globalThis.hardisCommandActivated) {
    return;
  }

  // Dynamic imports in parallel to save perfs when other CLI commands are called
  const [
    { default: c },
    { elapseEnd, uxLog },
    { t },
  ] = await Promise.all([
    import('chalk'),
    import('../../common/utils/index.js'),
    import('../../common/utils/i18n.js'),
  ]);

  // Always close log file stream if open, regardless of command origin
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
        uxLog("warning", this, c.yellow(t('unableToCloseWebsocketclientJs')) + '\n' + (e as Error).message);
      }
    }
    globalThis.webSocketClient = null;
  }

  const aiCounter = globalThis?.aiCallsNumber || 0;
  if (aiCounter > 0) {
    uxLog("log", this, c.grey(c.italic(t('aiPromptsApiCalls', { aiCounter }))));
  }
  elapseEnd(`${options?.Command?.id} execution time`);
  globalThis.hardisCommandActivated = false;
};

export default hook;
