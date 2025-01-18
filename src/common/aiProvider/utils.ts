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

  public static getPromptsLanguage(): string {
    return process.env.PROMPTS_LANGUAGE || "en";
  }

  public static async findAiCache(template: PromptTemplate, promptParameters: any[]): Promise<{ success: boolean, cacheText?: string, fingerPrint: string, flowsAiCacheDirFile: string }> {
    const fingerPrint = this.getFingerPrint(promptParameters);
    const lang = this.getPromptsLanguage();
    const flowsAiCacheDirFile = path.join("docs", "cache-ai-results", `${lang}-${template}-${fingerPrint}.md`);
    if (process.env?.IGNORE_AI_CACHE === "true") {
      return { success: false, fingerPrint, flowsAiCacheDirFile };
    }
    if (fs.existsSync(flowsAiCacheDirFile)) {
      const cacheText = await fs.readFile(flowsAiCacheDirFile, "utf8");
      return { success: true, cacheText, fingerPrint, flowsAiCacheDirFile };
    }
    return { success: false, fingerPrint, flowsAiCacheDirFile };
  }

  public static async writeAiCache(template: PromptTemplate, promptParameters: any[], aiCacheText: string): Promise<void> {
    const fingerPrint = this.getFingerPrint(promptParameters);
    const flowsAiCacheDir = path.join("docs", "cache-ai-results");
    await fs.ensureDir(flowsAiCacheDir);
    const lang = this.getPromptsLanguage();
    const flowsAiCacheDirFile = path.join(flowsAiCacheDir, `${lang}-${template}-${fingerPrint}.md`);
    await fs.writeFile(flowsAiCacheDirFile, aiCacheText);
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
