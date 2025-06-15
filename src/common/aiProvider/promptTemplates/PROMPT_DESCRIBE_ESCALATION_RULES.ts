import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "ESCALATIONRULES_NAME",
      description: "The name of the Salesforce Escalation Rule to describe.",
      example: "Case_Escalation_Rule"
    },
    {
      name: "ESCALATIONRULES_XML",
      description: "The XML metadata for the Salesforce Escalation Rule.",
      example: "<EscalationRules>...</EscalationRules>"
    }
  ], text: {
    "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to explain the what is the Salesforce Escalation Rule "{{ESCALATIONRULES_NAME}}" about in plain English, provide a detailed explanation suitable for a business user. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose of the escalation rule.
    - List the key functionalities and business logic implemented in the escalation rule.

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The metadata XML for Escalation Rule "{{ESCALATIONRULES_NAME}}" is:
{{ESCALATIONRULES_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
  },
};

export default template;
