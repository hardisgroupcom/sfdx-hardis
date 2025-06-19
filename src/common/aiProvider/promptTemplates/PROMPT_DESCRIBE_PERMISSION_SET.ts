import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "PERMISSIONSET_NAME",
      description: "The name of the Salesforce Permission Set to describe.",
      example: "PS_CloudityAccount"
    },
    {
      name: "PERMISSIONSET_XML",
      description: "The XML metadata for the Salesforce Permission Set.",
      example: "<PermissionSet>...</PermissionSet>"
    }
  ], text: {
    "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce PermissionSet "{{PERMISSIONSET_NAME}}" in plain English, providing a detailed explanation suitable for a business user. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the Salesforce PermissionSet that you can guess according to the content of the XML. Try to guess the role of users assigned to this permission set according to applicationVisibilities, objectVisibilities and userPermissions.
    - List the key features of the Permission Set.
      - The most important features are License, Applications, User Permissions ,features with default values ,Custom Objects and Record Types
      - Ignore Apex classes and Custom Fields
      - Ignore blocks who has access or visibility set to "false"

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The metadata XML for Salesforce Permission Set "{{PERMISSIONSET_NAME}}" is:
{{PERMISSIONSET_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
  },
};

export default template;
