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
    "en": `You are a business analyst working on a Salesforce project. Your goal is to describe the differences between the new and previous versions of a Salesforce Flow in plain English, providing a detailed explanation suitable for a business user.  {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

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

{{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The new version flow XML is:
{{FLOW_XML_NEW}}

- The previous version flow XML is:
{{FLOW_XML_PREVIOUS}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
  },
};

export default template;
