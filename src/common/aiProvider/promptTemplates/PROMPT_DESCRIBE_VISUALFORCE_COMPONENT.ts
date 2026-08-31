import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "VISUALFORCE_NAME",
      description: "The name of the Visualforce component to describe.",
      example: "AccountAddressBlock"
    },
    {
      name: "VISUALFORCE_MARKUP",
      description: "The Visualforce markup of the component.",
      example: "<apex:component>...</apex:component>",
      truncateAfter: 100000
    },
    {
      name: "VISUALFORCE_META",
      description: "The metadata file of the Visualforce component.",
      example: "<ApexComponent>...</ApexComponent>"
    },
    {
      name: "VISUALFORCE_APEX_CONTROLLERS",
      description: "The names of the Apex controller and extensions declared by the component, or \"none\".",
      example: "AccountAddressBlockController"
    }
  ],
  text: {
    "en": `You are a skilled Salesforce developer working on a Visualforce project. Your goal is to explain the Salesforce Visualforce component "{{VISUALFORCE_NAME}}" in plain English, providing a detailed explanation suitable for other developers and business users. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing what the component displays or does, and the business need it answers.
    - Explain how a page embedding the component benefits from it.

2. **Attributes and Reusability**:
    - List the attributes declared by the component (\`apex:attribute\`), and for each of them its type, whether it is required, its default value and what the component does with it.
    - Explain how a page or another component must embed it, showing the markup tag with its attributes.
    - Describe the assumptions the component makes about its context, for example a record it expects to receive or a controller it needs.

3. **Technical Analysis**:
    - Describe the internal structure of the component and the data bindings it uses.
    - Mention the other custom components, static resources, JavaScript and stylesheets it relies on.

Important: only the markup and the metadata of the component are provided. The source of the Apex controller and extensions is NOT provided: name them and describe the role you can infer from how the component calls them, but do not speculate about their internal implementation.

{{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The Apex controller and extensions declared by component "{{VISUALFORCE_NAME}}": {{VISUALFORCE_APEX_CONTROLLERS}}

- The Visualforce markup of component "{{VISUALFORCE_NAME}}":
\`\`\`
{{VISUALFORCE_MARKUP}}
\`\`\`

- The metadata of component "{{VISUALFORCE_NAME}}":
\`\`\`
{{VISUALFORCE_META}}
\`\`\`

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
  },
};

export default template;
