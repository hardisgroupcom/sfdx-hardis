import { HuggingFaceInference } from "@langchain/community/llms/hf";
import { AbstractLLMProvider, ModelConfig, SupportedModel } from "./langChainBaseProvider.js";

export class LangChainHuggingFaceProvider extends AbstractLLMProvider {
  constructor(modelName: string, config: ModelConfig) {
    if (!config.apiKey) {
      throw new Error("API key is required for HuggingFace provider. Define it in a secured env var LANGCHAIN_LLM_MODEL_API_KEY");
    }
    super(modelName, config);
    this.model = this.getModel();
  }

  getModel(): SupportedModel {
    const config = {
      model: this.modelName,
      apiKey: this.config.apiKey!,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      // HuggingFace specific configuration
      endpointUrl: this.config.baseUrl, // Custom endpoint URL if needed
    };

    return new HuggingFaceInference(config);
  }

  getLabel(): string {
    return "HuggingFace LangChain connector";
  }
}
