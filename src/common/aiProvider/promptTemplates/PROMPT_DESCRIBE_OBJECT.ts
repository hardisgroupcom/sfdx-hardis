import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
    variables: [
        {
            name: "OBJECT_NAME",
            description: "The API name of the Salesforce object to describe.",
            example: "Account"
        },
        {
            name: "OBJECT_XML",
            description: "The XML metadata definition of the Salesforce object.",
            example: "<CustomObject>...</CustomObject>"
        },
        {
            name: "ALL_OBJECTS_LIST",
            description: "A list of all objects in the Salesforce org.",
            example: "Account, Contact, Opportunity, ..."
        },
        {
            name: "ALL_OBJECT_LINKS",
            description: "The object model (MasterDetail and Lookup relationships) for all objects.",
            example: "Account->Contact (Lookup), Opportunity->Account (MasterDetail)"
        }
    ],
    text: {
        "en": `You are a business analyst working on a Salesforce project. Your goal is to describe the Salesforce object "{{OBJECT_NAME}}" in plain English, providing a detailed explanation suitable for a business user.  {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role and purpose of the object "{{OBJECT_NAME}}" in the Salesforce org.
    - Explain its significance in the project, its purpose in the org's implementation, and any key business processes it supports.

2. **Relationships**:
    - Use the provided object model data to describe how "{{OBJECT_NAME}}" relates to other objects.
    - Include:
        - Direct relationships (MasterDetail and Lookup fields on the object).
        - Inverse relationships (other objects referencing "{{OBJECT_NAME}}").
        - Highlight any key dependencies or implications of these relationships in plain English.

3. **Additional Guidance**:
    - **Do NOT include** fields table or validation rules table in the response
    - Use the acronyms provided to interpret metadata names (e.g., TR: Trigger, VR: Validation Rule, WF: Workflow).
    - If the XML metadata contains sensitive information (e.g., tokens, passwords), replace them with a placeholder (e.g., \`[REDACTED]\`).

4. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The list of all objects in the Salesforce org is: {{ALL_OBJECTS_LIST}}

- The object model (MasterDetail and Lookup relationships) is: {{ALL_OBJECT_LINKS}}

- The metadata XML for "{{OBJECT_NAME}}" is:
{{OBJECT_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
    },
};

export default template;
