import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: ["FLOW_XML"],
  text: {
    "en": `You are a business analyst working on a Salesforce project.
Please describe the following flow using plain English that can be understood by a business user.
Please respond with markdown format, that can be embedded in a level 2 header (##).
Add a new line before starting a bullet list so mkdocs-material displays it correctly, including for sub-bullets.
Caution: If the XML contains secret tokens or password, please replace them with a placeholder.
The flow XML is:
{{FLOW_XML}}
`,
  },
};

export default template;
