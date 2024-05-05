import * as c from "chalk";
import { elapseEnd, uxLog } from "../../common/utils";

// The use of this method is deprecated: use NotifProvider.sendNotification :)

export const hook = async (options: any) => {
  if (globalThis.hardisLogFileStream) {
    globalThis.hardisLogFileStream.end();
    globalThis.hardisLogFileStream = null;
  }

  // Skip hooks from other commands than hardis commands
  const commandId = options?.Command?.id || "";
  if (!commandId.startsWith("hardis")) {
    return;
  }
  elapseEnd(`${options?.Command?.id} execution time`);
  if (commandId.startsWith("hardis:doc")) {
    return;
  }

  // Close WebSocketClient if existing
  if (globalThis.webSocketClient) {
    try {
      globalThis.webSocketClient.dispose();
    } catch (e) {
      if (options.debug) {
        uxLog(this, c.yellow("Unable to close webSocketClient") + "\n" + e.message);
      }
    }
    globalThis.webSocketClient = null;
  }
};
