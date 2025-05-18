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

  public static isLangChainAvailable() {
    if (getEnvVar("USE_LANGCHAIN_LLM") === "true" && getEnvVar("LANGCHAIN_LLM_MODEL")) {
      return true;
    }
    return false;
  }

  public static isAgentforceAvailable() {
    if (getEnvVar("USE_AGENTFORCE") === "true" && (globalThis.jsForceConn || globalThis.jsForceConnTechnical)) {
      return true;
    }
    return false;
  }

  public static getPromptsLanguage(): string {
    return process.env.PROMPTS_LANGUAGE || "en";
  }

  public static async findAiCache(template: PromptTemplate, promptParameters: any[], uniqueId: string): Promise<{ success: boolean, cacheText?: string, fingerPrint: string, aiCacheDirFile: string }> {
    const fingerPrint = this.getFingerPrint(promptParameters);
    const lang = this.getPromptsLanguage();

    // Manual override by user
    const aiManualOverride = path.join("docs", "cache-ai-results", `${lang}-${template}-${uniqueId}.md`);
    if (fs.existsSync(aiManualOverride)) {
      const cacheText = await fs.readFile(aiManualOverride, "utf8");
      return { success: true, cacheText, fingerPrint, aiCacheDirFile: aiManualOverride.replace(/\\/g, '/') };
    }

    // Cache of latest generated AI result
    const aiCacheDirFile = path.join("docs", "cache-ai-results", `${lang}-${template}-${uniqueId}-${fingerPrint}.md`);
    if (process.env?.IGNORE_AI_CACHE === "true") {
      return { success: false, fingerPrint, aiCacheDirFile: aiCacheDirFile.replace(/\\/g, '/') };
    }
    if (fs.existsSync(aiCacheDirFile)) {
      const cacheText = await fs.readFile(aiCacheDirFile, "utf8");
      return { success: true, cacheText, fingerPrint, aiCacheDirFile: aiCacheDirFile.replace(/\\/g, '/') };
    }
    return { success: false, fingerPrint, aiCacheDirFile: aiCacheDirFile.replace(/\\/g, '/') };
  }

  public static async writeAiCache(template: PromptTemplate, promptParameters: any[], uniqueId: string, aiCacheText: string): Promise<void> {
    const fingerPrint = this.getFingerPrint(promptParameters);
    const aiCacheDir = path.join("docs", "cache-ai-results");
    await fs.ensureDir(aiCacheDir);
    const lang = this.getPromptsLanguage();
    const aiCacheDirFile = path.join(aiCacheDir, `${lang}-${template}-${uniqueId}-${fingerPrint}.md`);
    const otherCacheFiles = fs.readdirSync(aiCacheDir).filter((file) => file.includes(`${lang}-${template}-${uniqueId}`) && !file.includes(fingerPrint));
    for (const otherCacheFile of otherCacheFiles) {
      await fs.remove(path.join(aiCacheDir, otherCacheFile));
    }
    await fs.writeFile(aiCacheDirFile, aiCacheText);
  }

  public static getFingerPrint(promptParameters: any[]): string {
    const parametersFingerPrints = promptParameters.map((promptParameter) => {
      if (typeof promptParameter === "string" && promptParameter.includes("<xml")) {
        try {
          const xmlObj = new XMLParser().parse(UtilsAi.normalizeString(promptParameter));
          return farmhash.fingerprint32(UtilsAi.normalizeString(JSON.stringify(xmlObj)));
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        catch (e) {
          return farmhash.fingerprint32(UtilsAi.normalizeString(promptParameter));
        }
      }
      else if (typeof promptParameter === "string") {
        return farmhash.fingerprint32(UtilsAi.normalizeString(promptParameter));
      }
      return farmhash.fingerprint32(UtilsAi.normalizeString(JSON.stringify(promptParameter)));
    });
    return parametersFingerPrints.join("-");
  }

  public static normalizeString(str: string) {
    return str.normalize().trim().replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\r\n/g, '\n');
  }
}
