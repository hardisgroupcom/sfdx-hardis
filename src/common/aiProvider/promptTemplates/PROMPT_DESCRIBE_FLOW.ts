import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "FLOW_XML",
      description: "The XML definition of the Salesforce Flow to describe.",
      example: "<FlowDefinition>...</FlowDefinition>"
    }
  ],
  text: {
    "en": `You are a business analyst working on a Salesforce project. Your goal is to describe the Salesforce Flow in plain English, providing a detailed explanation suitable for a business user.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose and business context of the flow.
    - Explain what business process or automation this flow supports.

2. **Step-by-Step Description**:
    - Describe the main steps, decisions, and actions in the flow.
    - Use plain English and avoid technical jargon when possible.
    - If there are sub-flows or important conditions, mention them clearly.

3. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (##).
    - Add a new line before starting a bullet list so mkdocs-material displays it correctly, including for sub-bullets.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The flow XML is:
{{FLOW_XML}}

Caution: If the XML contains secret tokens or passwords, please replace them with a placeholder (e.g., [REDACTED]). Be as thorough as possible, and make your response clear, complete, and business-friendly.
`,
  },
};

export default template;
