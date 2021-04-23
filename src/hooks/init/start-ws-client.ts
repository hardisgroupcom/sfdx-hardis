import { isCI } from "../../common/utils";
import { WebSocketClient } from "../../common/websocketClient";

export const hook = async (options: any) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.id || "";
  if (!commandId.startsWith("hardis")) {
    return;
  }

  // Initialize WebSocketClient to communicate with VsCode SFDX Hardis extension
  if (!isCI) {
    const context = { command: commandId, id: process.pid };
    globalThis.webSocketClient = new WebSocketClient(context);
  }
};
