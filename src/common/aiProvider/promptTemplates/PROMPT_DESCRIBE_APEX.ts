import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "CLASS_NAME",
      description: "The name of the Salesforce Apex class to describe.",
      example: "MyCustomController"
    },
    {
      name: "APEX_CODE",
      description: "The full source code of the Apex class.",
      example: "public class MyCustomController { ... }"
    }
  ], text: {
    "en": `You are a developer working on a Salesforce project. Your goal is to summarize the behavior of the Salesforce Apex class "{{CLASS_NAME}}" in plain English, providing a detailed explanation suitable for a business user. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the apex class.
    - List the key functionalities and business logic implemented in the class.

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The code for Apex class "{{CLASS_NAME}}" is:
{{APEX_CODE}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
  },
};

export default template;
