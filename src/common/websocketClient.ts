import * as c from "chalk";
import * as util from "util";
import * as WebSocket from "ws";
import { isCI, uxLog } from "./utils";

let globalWs: WebSocketClient | null;
let isWsOpen = false;

const PORT = process.env.SFDX_HARDIS_WEBSOCKET_PORT || 2702;

export class WebSocketClient {
  private ws: any;
  private wsContext: any;
  private promptResponse: any;

  constructor(context: any) {
    this.wsContext = context;
    const wsHostPort = context.websocketHostPort ? `ws://${context.websocketHostPort}` : `ws://localhost:${PORT}`;
    try {
      this.ws = new WebSocket(wsHostPort);
      globalWs = this; // eslint-disable-line
      this.start();
    } catch (err) {
      uxLog(this, c.yellow("Warning: Unable to start WebSocket client on " + wsHostPort+ "\n"+err.message));
    }
  }

  static isAlive(): boolean {
    return !isCI && globalWs != null && isWsOpen === true;
  }

  static sendMessage(data: any) {
    if (globalWs) {
      globalWs.sendMessageToServer(data);
    }
  }

  // Requests open file within VsCode if linked
  static requestOpenFile(file: string) {
    WebSocketClient.sendMessage({ event: "openFile", file: file.replace(/\\/g, "/") });
  }

  static sendPrompts(prompts: any): Promise<any> {
    return globalWs.promptServer(prompts);
  }

  start() {
    this.ws.on("open", () => {
      isWsOpen = true;
      this.ws.send(
        JSON.stringify({
          event: "initClient",
          context: this.wsContext,
        }),
      );
      // uxLog(this,c.grey('Initialized WebSocket connection with VsCode SFDX Hardis'));
    });

    this.ws.on("message", (data: any) => {
      this.receiveMessage(JSON.parse(data));
    });

    this.ws.on("error", (err) => {
      this.ws.terminate();
      globalWs = null;
      if (process.env.DEBUG) {
        console.error(err);
      }
    });
  }

  receiveMessage(data: any) {
    if (process.env.DEBUG) {
      console.debug("websocket: received: %s", util.inspect(data));
    }
    if (data.event === "promptsResponse") {
      this.promptResponse = data.promptsResponse;
    }
  }

  sendMessageToServer(data: any) {
    data.context = this.wsContext;
    this.ws.send(JSON.stringify(data));
  }

  promptServer(prompts: any): Promise<any> {
    this.sendMessageToServer({ event: "prompts", prompts: prompts });
    this.promptResponse = null;
    let ok = false;
    return new Promise((resolve, reject) => {
      let interval = null;
      let timeout = null;
      interval = setInterval(() => {
        if (this.promptResponse != null) {
          clearInterval(interval);
          clearTimeout(timeout);
          ok = true;
          resolve(this.promptResponse);
        }
      }, 300);
      timeout = setTimeout(() => {
        if (ok === false) {
          clearInterval(interval);
          reject("[sfdx-hardis] No response from UI WebSocket Server");
        }
      }, 7200000); // 2h timeout
    });
  }

  dispose() {
    this.ws.send(
      JSON.stringify({
        event: "closeClient",
        context: this.wsContext,
      }),
    );
    this.ws.terminate();
    globalWs = null;
    // uxLog(this,c.grey('Closed WebSocket connection with VsCode SFDX Hardis'));
  }
}
