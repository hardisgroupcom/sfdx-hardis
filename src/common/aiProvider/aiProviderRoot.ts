import { SfError } from "@salesforce/core";
import { AiResponse } from "./index.js";
import { getEnvVar } from "../../config/index.js";

export abstract class AiProviderRoot {
  protected token: string;

  public getLabel(): string {
    throw new SfError("getLabel should be implemented on this call");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async promptAi(prompt: string): Promise<AiResponse | null> {
    throw new SfError("promptAi should be implemented on this call");
  }

  // Get user defined maximum number of calls during an sfdx-hardis command
  getAiMaxCallsNumber() {
    return parseInt(getEnvVar("AI_MAXIMUM_CALL_NUMBER") || "10");
  }

  // Increment number of api calls performed
  incrementAiCallsNumber() {
    globalThis.aiCallsNumber = (globalThis.aiCallsNumber || 0) + 1;
  }

  // Check if max number of calls during a sfdx-hardis command has been reached
  checkMaxAiCallsNumber() {
    const maxCalls = globalThis.aiCallsNumber || 0;
    return maxCalls < this.getAiMaxCallsNumber();
  }
}
