import OpenAI from "openai";
import * as c from 'chalk';
import { getEnvVar } from "../../config";
import { uxLog } from ".";

const openai = new OpenAI();

export function isOpenApiAvailable() {
  if (getEnvVar("OPENAI_API_KEY")) {
    return true;
  }
  return false;
}

// Import data from sfdmu folder
export async function askOpenApi(promptText: string) {
  const gptModel = process.env.OPENAPI_GPT_MODEL || "gpt-4o";
  uxLog(this, c.grey('[AI] Requesting the following prompt to ' + gptModel + ": " + promptText+" ..."));
  const completion = await openai.chat.completions.create({
    messages: [{ role: "system", content: promptText }],
    model: gptModel,
  });
  return completion;
}