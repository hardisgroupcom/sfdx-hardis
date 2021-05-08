import * as util from "util";
import * as WebSocket from "ws";
import { isCI } from "./utils";

let globalWs: WebSocketClient | null;

const PORT = process.env.SFDX_HARDIS_WEBSOCKET_PORT || 2702;

export class WebSocketClient {
  private ws: any;
  private wsContext: any;
  private promptResponse: any;

  constructor(context: any) {
    this.wsContext = context;
    const wsHostPort = context.websocketHostPort ? `ws://${context.websocketHostPort}` : `ws://localhost:${PORT}`;
    this.ws = new WebSocket(wsHostPort);
    globalWs = this;
    this.start();
  }

  static isAlive(): boolean {
    return !isCI && globalWs != null;
  }

  static sendMessage(data: any) {
    if (globalWs) {
      globalWs.sendMessageToServer(data);
    }
  }

  static sendPrompts(prompts: any): Promise<any> {
    return globalWs.promptServer(prompts);
  }

  start() {
    this.ws.on("open", () => {
      this.ws.send(
        JSON.stringify({
          event: "initClient",
          context: this.wsContext,
        })
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
      }, 300000);
    });
  }

  dispose() {
    this.ws.send(
      JSON.stringify({
        event: "closeClient",
        context: this.wsContext,
      })
    );
    this.ws.terminate();
    globalWs = null;
    // uxLog(this,c.grey('Closed WebSocket connection with VsCode SFDX Hardis'));
  }
}
