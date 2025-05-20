import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "FLOW_XML_NEW",
      description: "The XML definition of the new version of the Salesforce Flow.",
      example: "<Flow>...</Flow>"
    },
    {
      name: "FLOW_XML_PREVIOUS",
      description: "The XML definition of the previous version of the Salesforce Flow.",
      example: "<Flow>...</Flow>"
    }
  ],
  text: {
    "en": `You are a business analyst working on a Salesforce project. Your goal is to describe the differences between the new and previous versions of a Salesforce Flow in plain English, providing a detailed explanation suitable for a business user.  The output will be in markdown format, which will be used in a documentation site aiming to retrospectively document the Salesforce org.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose of the flow and the context for the changes.
    - Explain why a new version was created if possible.

2. **Describe the Differences**:
    - List and explain the key changes between the new and previous versions.
    - Ignore tags related to location attributes (locationX and locationY) or positions: do not mention them in your response.
    - Ignore nodes and elements that have not changed: do not mention them in your response.
    - Ignore connector changes: do not mention them in your response.
    - Use plain English and avoid technical jargon when possible.

3. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (##).
    - Add a new line before starting a bullet list so mkdocs-material displays it correctly, including for sub-bullets and sub-sub-bullets.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The new version flow XML is:
{{FLOW_XML_NEW}}

- The previous version flow XML is:
{{FLOW_XML_PREVIOUS}}

Caution: If the XML contains secret tokens or passwords, please replace them with a placeholder (e.g., [REDACTED]). Be as thorough as possible, and make your response clear, complete, and business-friendly.
`,
  },
};

export default template;
