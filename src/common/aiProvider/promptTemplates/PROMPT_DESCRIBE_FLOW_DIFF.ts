import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "FLOW_XML_NEW",
      description: "The XML definition of the new version of the Salesforce Flow.",
      example: "<FlowDefinition>...</FlowDefinition>"
    },
    {
      name: "FLOW_XML_PREVIOUS",
      description: "The XML definition of the previous version of the Salesforce Flow.",
      example: "<FlowDefinition>...</FlowDefinition>"
    }
  ],
  text: {
    "en": `You are a business analyst working on a Salesforce project.
Please describe the differences between new version of the flow and previous version of the flow, using plain English that can be understood by a business user.
Ignore tags related to location attributes (locationX and locationY) or positions: do not mention them in your response
Ignore nodes and elements that have not changed: do not mention them in your response
Ignore connector changes: do not mention them in your response
Please respond with markdown format, that can be embedded in a level 2 header (##).
Add a new line before starting a bullet list so mkdocs-material displays it correctly, including for sub-bullets and sub-sub-bullets.
If the XML contains secret tokens or password, please replace them with a placeholder.
The new version flow XML is:
{{FLOW_XML_NEW}}

The previous version flow XML is:
{{FLOW_XML_PREVIOUS}}
`,
  },
};

export default template;
