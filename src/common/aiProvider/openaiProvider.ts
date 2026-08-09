import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage } from "@langchain/core/messages";
import { AiResponse } from "./index.js";
import { AiProviderRoot } from "./aiProviderRoot.js";
import c from "chalk";
import { uxLog } from "../utils/index.js";
import { PromptTemplate } from "./promptTemplates.js";
import { getEnvVar } from "../../config/index.js";
import { resolveBooleanFlag, parseDefaultHeaders, HEADER_PARSE_I18N_KEYS } from "./providerConfigUtils.js";
import { t } from '../utils/i18n.js';

export class OpenAiProvider extends AiProviderRoot {
  private static readonly DEFAULT_MODEL = "gpt-4o-mini";
  private static readonly SUPPORTED_SERVICE_TIERS: OpenAiServiceTier[] = ["auto", "default", "flex"];
  private static readonly SUPPORTED_REASONING_EFFORTS: OpenAiReasoningEffort[] = ["low", "medium", "high"];

  protected model: ChatOpenAI;
  private readonly modelName: string;
  private readonly serviceTier?: OpenAiServiceTier;
  private readonly reasoningEffort?: OpenAiReasoningEffort;

  private constructor(config: OpenAiResolvedConfig) {
    super();
    this.modelName = config.modelName || OpenAiProvider.DEFAULT_MODEL;
    this.serviceTier = config.serviceTier;
    this.reasoningEffort = config.reasoningEffort;

    // Routed through @langchain/openai (already shipped for the langchain provider),
    // so the standalone openai SDK is not needed anymore. useResponsesApi keeps the
    // historical behavior of calling the OpenAI Responses API.
    // reasoning goes through modelKwargs on purpose: ChatOpenAI only forwards its
    // own `reasoning` field for model names it recognizes as reasoning models, while
    // the historical client always sent it (needed for gateway/alias model names).
    this.model = new ChatOpenAI({
      model: this.modelName,
      apiKey: config.apiKey || "",
      useResponsesApi: true,
      ...(this.serviceTier ? { service_tier: this.serviceTier } : {}),
      ...(this.reasoningEffort ? { modelKwargs: { reasoning: { effort: this.reasoningEffort } } } : {}),
      configuration: {
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        ...(config.defaultHeaders ? { defaultHeaders: config.defaultHeaders } : {}),
      },
    });
  }

  public getLabel(): string {
    return "OpenAi connector";
  }

  public static async isConfigured(): Promise<boolean> {
    const config = await this.resolveConfig();
    return config != null;
  }

  public static async create(): Promise<OpenAiProvider> {
    const config = await this.resolveConfig();
    if (!config) {
      throw new Error("OpenAI provider is not properly configured");
    }
    return new OpenAiProvider(config);
  }

  private static async resolveConfig(): Promise<OpenAiResolvedConfig | null> {
    const apiKey = getEnvVar("OPENAI_API_KEY") || undefined;
    const baseURL = getEnvVar("OPENAI_BASE_URL") || undefined;

    const headerResult = parseDefaultHeaders(getEnvVar("OPENAI_DEFAULT_HEADERS"));
    if (headerResult.error) {
      uxLog("warning", this, c.yellow(t(HEADER_PARSE_I18N_KEYS[headerResult.error], { label: "OpenAI", key: headerResult.errorKey })));
    }
    const defaultHeaders = headerResult.headers;

    const hasGatewayAuth = baseURL && defaultHeaders && Object.keys(defaultHeaders).length > 0;
    if (!apiKey && !hasGatewayAuth) {
      return null;
    }

    const { enabled, rootConfig } = await resolveBooleanFlag({
      envVar: "USE_OPENAI_DIRECT",
      configKey: "useOpenaiDirect",
      defaultValue: true,
    });
    if (!enabled) {
      return null;
    }
    const modelName = getEnvVar("OPENAI_MODEL")
      || rootConfig.openaiModel
      || rootConfig.OPENAI_MODEL
      || OpenAiProvider.DEFAULT_MODEL;
    const serviceTier = this.resolveOptionalServiceTier(
      getEnvVar("OPENAI_SERVICE_TIER")
      || rootConfig.openaiServiceTier
      || rootConfig.OPENAI_SERVICE_TIER
    );
    const reasoningEffort = this.resolveOptionalReasoningEffort(
      getEnvVar("OPENAI_REASONING_EFFORT")
      || rootConfig.openaiReasoningEffort
      || rootConfig.OPENAI_REASONING_EFFORT
    );
    return { apiKey, baseURL, defaultHeaders, modelName, serviceTier, reasoningEffort };
  }

  private static resolveOptionalServiceTier(rawValue: string | null | undefined): OpenAiServiceTier | undefined {
    return this.resolveOptionalEnumValue(rawValue, OpenAiProvider.SUPPORTED_SERVICE_TIERS);
  }

  private static resolveOptionalReasoningEffort(rawValue: string | null | undefined): OpenAiReasoningEffort | undefined {
    return this.resolveOptionalEnumValue(rawValue, OpenAiProvider.SUPPORTED_REASONING_EFFORTS);
  }

  private static resolveOptionalEnumValue<T extends string>(rawValue: string | null | undefined, supportedValues: T[]): T | undefined {
    if (!rawValue) {
      return undefined;
    }
    const normalizedValue = rawValue.toLowerCase();
    if (supportedValues.includes(normalizedValue as T)) {
      return normalizedValue as T;
    }
    return undefined;
  }

  public async promptAi(promptText: string, template: PromptTemplate | null = null): Promise<AiResponse | null> {
    if (!this.checkAndWarnMaxAiCalls("OpenAi")) {
      return null;
    }
    const gptModel = this.modelName;
    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey('[OpenAI] ' + t('openaiRequestingPromptDebug', { modelName: gptModel, template: template ? ' using template ' + template : '', promptText })));
    }
    else {
      uxLog("log", this, c.grey('[OpenAI] ' + t('openaiRequestingPrompt', { modelName: gptModel, template: template ? ' using template ' + template : '' })));
    }
    this.incrementAiCallsNumber();
    const response = await this.model.invoke([new SystemMessage(promptText)]);
    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey('[OpenAI] ' + t('openaiReceivedResponseDebug', { modelName: gptModel, response: JSON.stringify(response, null, 2) })));
    }
    else {
      uxLog("log", this, c.grey('[OpenAI] ' + t('openaiReceivedResponse', { modelName: gptModel })));
    }
    const responseText = typeof response.content === "string"
      ? response.content
      : response.text;
    const responseModelName = response.response_metadata?.model_name || response.response_metadata?.model;
    const aiResponse: AiResponse = {
      success: false,
      model: typeof responseModelName === "string" ? responseModelName : gptModel,
    };
    if (responseText) {
      aiResponse.success = true;
      aiResponse.promptResponse = responseText;
    }
    return aiResponse;
  }
}

interface OpenAiResolvedConfig {
  apiKey?: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  modelName: string;
  serviceTier?: OpenAiServiceTier;
  reasoningEffort?: OpenAiReasoningEffort;
}

type OpenAiServiceTier = "auto" | "default" | "flex";
type OpenAiReasoningEffort = "low" | "medium" | "high";
