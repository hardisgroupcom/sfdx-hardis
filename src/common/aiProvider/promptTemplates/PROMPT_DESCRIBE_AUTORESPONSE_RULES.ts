import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "AUTORESPONSERULES_NAME",
      description: "The name of the Salesforce AutoResponse Rules to describe.",
      example: "Case_AutoResponse_Rules"
    },
    {
      name: "AUTORESPONSERULES_XML",
      description: "The XML metadata for the Salesforce AutoResponse Rules.",
      example: "<AutoResponseRules>...</AutoResponseRules>"
    }
  ], text: {
    "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce AutoResponse Rules "{{AUTORESPONSERULES_NAME}}" in plain English, providing a detailed explanation suitable for a business user. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by explaining the role of the Salesforce AutoResponse Rules that you can guess according to the content of the XML and the name.
    Try to guess the role of users assigned to this AutoResponse rule. Do not mention the email of assigned users, but you can mention type of assigned users.
    - Analyze all the AutoResponse rules for objects and in the description tell what are the aim of those rules. What is the role of the object in the system, based by the AutoResponse rules.
    - Based by Criteria items, explain what would be the response to the user, if the criteria are met.

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The metadata XML for Salesforce AutoResponse Rule "{{AUTORESPONSERULES_NAME}}" is:
{{AUTORESPONSERULES_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
  },
};

export default template;
