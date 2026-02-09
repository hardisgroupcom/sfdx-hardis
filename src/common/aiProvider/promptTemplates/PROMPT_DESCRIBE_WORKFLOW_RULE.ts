import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "WORKFLOWRULE_NAME",
      description: "The name of the Salesforce Workflow Rule to describe.",
      example: "Account.HighValue_Alert"
    },
    {
      name: "WORKFLOWRULE_XML",
      description: "The XML metadata for the Salesforce Workflow Rule.",
      example: "<workflowRule>...</workflowRule>"
    }
  ], text: {
    "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to explain what the Salesforce Workflow Rule "{{WORKFLOWRULE_NAME}}" does in plain English, providing a detailed explanation suitable for a business user. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Summarize the business purpose of this workflow rule.
    - Explain the main criteria that trigger the rule and the actions it performs.

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The metadata XML for Workflow Rule "{{WORKFLOWRULE_NAME}}" is:
{{WORKFLOWRULE_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
  },
};

export default template;
