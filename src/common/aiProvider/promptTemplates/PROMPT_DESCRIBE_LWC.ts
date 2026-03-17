import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "LWC_NAME",
      description: "The name of the Lightning Web Component to describe.",
      example: "myCustomComponent"
    },
    {
      name: "LWC_JS_CODE",
      description: "The JavaScript code of the Lightning Web Component.",
      example: "import { LightningElement } from 'lwc'; ..."
    },
    {
      name: "LWC_HTML_CODE",
      description: "The HTML template code of the Lightning Web Component.",
      example: "<template>...</template>"
    },
    {
      name: "LWC_JS_META",
      description: "The meta configuration file for the Lightning Web Component.",
      example: "<LightningComponentBundle>...</LightningComponentBundle>"
    }
  ],
  text: {
    "en": `You are a skilled Salesforce developer working on a Lightning Web Components (LWC) project. Your goal is to explain the Salesforce Lightning Web Component "{{LWC_NAME}}" in plain English, providing a detailed explanation suitable for other developers and business users.  {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose and functionality of the Lightning Web Component.
    - Describe the key features and capabilities it provides to users.
    - Explain how it interacts with Salesforce data or other components.

2. **Technical Analysis**:
    - Describe the main JavaScript methods and their purposes.
    - Explain how the component handles data binding and events.
    - Mention any wire services, apex methods, or external services the component uses.
    - Identify any custom properties or special configurations.

{{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The HTML template for component "{{LWC_NAME}}":
\`\`\`
{{LWC_HTML_CODE}}
\`\`\`

- The JavaScript controller for component "{{LWC_NAME}}":
\`\`\`
{{LWC_JS_CODE}}
\`\`\`

- The metadata configuration for component "{{LWC_NAME}}":
\`\`\`
{{LWC_JS_META}}
\`\`\`

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
  },
};

export default template;
