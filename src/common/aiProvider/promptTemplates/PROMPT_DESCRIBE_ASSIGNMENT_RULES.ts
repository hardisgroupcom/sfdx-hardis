import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "ASSIGNMENTRULES_NAME",
      description: "The name of the Salesforce Assignment Rules to describe.",
      example: "Case_Assignment_Rules"
    },
    {
      name: "ASSIGNMENTRULES_XML",
      description: "The XML metadata for the Salesforce Assignment Rules.",
      example: "<AssignmentRules>...</AssignmentRules>"
    }
  ], text: {
    "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce Assignment Rules "{{ASSIGNMENTRULES_NAME}}" in plain English, providing a detailed explanation suitable for a business user. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by explaining the role of the Salesforce Assignment Rules that you can guess according to the content of the XML and the name.
    Try to guess the role of users assigned to this assignment rule. Do not mention the email of assigned users, but you can mention type of assigned users.
    Based by Criteria items, explain what should so the record will be assigned.
    - Analyze all the assignment rules for objects and in the description tell what are the aim of those rules. What is the role of the object in the system, based by the assignment rules.

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The metadata XML for Salesforce Assignment Rule "{{ASSIGNMENTRULES_NAME}}" is:
{{ASSIGNMENTRULES_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
  },
};

export default template;
