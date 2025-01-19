import { getEnvVar } from "../../config/index.js";
import { PromptTemplate } from "./promptTemplates.js";
import path from 'path';
import fs from 'fs-extra';
import { XMLParser } from "fast-xml-parser";
import farmhash from 'farmhash';

export class UtilsAi {
  public static isOpenAiAvailable() {
    if (getEnvVar("OPENAI_API_KEY")) {
      return true;
    }
    return false;
  }

  public static isAgentforceAvailable() {
    if (getEnvVar("USE_AGENTFORCE") === "true" && globalThis.jsForceConn) {
      return true;
    }
    return false;
  }

  public static getPromptsLanguage(): string {
    return process.env.PROMPTS_LANGUAGE || "en";
  }

  public static async findAiCache(template: PromptTemplate, promptParameters: any[]): Promise<{ success: boolean, cacheText?: string, fingerPrint: string, aiCacheDirFile: string }> {
    const fingerPrint = this.getFingerPrint(promptParameters);
    const lang = this.getPromptsLanguage();
    const aiCacheDirFile = path.join("docs", "cache-ai-results", `${lang}-${template}-${fingerPrint}.md`);
    if (process.env?.IGNORE_AI_CACHE === "true") {
      return { success: false, fingerPrint, aiCacheDirFile: aiCacheDirFile.replace(/\\/g, '/') };
    }
    if (fs.existsSync(aiCacheDirFile)) {
      const cacheText = await fs.readFile(aiCacheDirFile, "utf8");
      return { success: true, cacheText, fingerPrint, aiCacheDirFile: aiCacheDirFile.replace(/\\/g, '/') };
    }
    return { success: false, fingerPrint, aiCacheDirFile: aiCacheDirFile.replace(/\\/g, '/') };
  }

  public static async writeAiCache(template: PromptTemplate, promptParameters: any[], aiCacheText: string): Promise<void> {
    const fingerPrint = this.getFingerPrint(promptParameters);
    const aiCacheDir = path.join("docs", "cache-ai-results");
    await fs.ensureDir(aiCacheDir);
    const lang = this.getPromptsLanguage();
    const aiCacheDirFile = path.join(aiCacheDir, `${lang}-${template}-${fingerPrint}.md`);
    await fs.writeFile(aiCacheDirFile, aiCacheText);
  }

  public static getFingerPrint(promptParameters: any[]): string {
    const parametersFingerPrints = promptParameters.map((promptParameter) => {
      if (typeof promptParameter === "string" && promptParameter.includes("<xml")) {
        try {
          const xmlObj = new XMLParser().parse(promptParameter);
          return farmhash.fingerprint32(JSON.stringify(xmlObj));
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        catch (e) {
          return farmhash.fingerprint32(promptParameter);
        }
      }
      return farmhash.fingerprint32(JSON.stringify(promptParameter));
    });
    return parametersFingerPrints.join("-");
  }

}
