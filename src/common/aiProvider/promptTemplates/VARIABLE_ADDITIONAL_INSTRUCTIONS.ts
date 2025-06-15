import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [],
  text: {
    "en": `### Additional Instructions
    
- Caution: Redact any sensitive information (tokens, passwords, API keys, etc.) and replace with \`[HIDDEN_SENSITIVE_INFOS]\`.
- Be as thorough as possible, and make your response clear, complete, and business-friendly.`
  },
};

export default template;
