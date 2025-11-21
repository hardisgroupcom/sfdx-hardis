import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "VF_NAME",
      description: "The name of the Visualforce Page.",
      example: "Account_Custom_View"
    },
    {
      name: "VF_CODE",
      description: "The full Visualforce markup of the page, potentially with inline comments about standard fields.",
      example: "<apex:page standardController='Account'><!-- Account Name (Text) --></apex:page>"
    },
    {
      name: "RAW_VF_CODE",
      description: "The raw, unprocessed Visualforce markup of the page, used for direct display in documentation.",
      example: "<apex:page standardController='Account'>...</apex:page>"
    },
    {
      name: "VF_CONTROLLER",
      description: "Structured information about Apex controller/extension methods and properties referenced by the page, including Javadoc comments.",
      example: "// public PageReference save() // Saves the record"
    },
    {
      name: "VF_COMPONENTS_SUMMARY",
      description: "A summary of key Visualforce components used on the page, including custom components.",
      example: "Uses <c:CustomHeader> for branding, <apex:pageBlockTable> for data display."
    },
    {
      name: "VF_ANALYSIS_SUMMARY",
      description: "Automated analysis summary including performance, security, and best practices insights.",
      example: "Performance: medium complexity; Security: Potential concerns detected; Best Practices: Improvement opportunities"
    }
  ],

  text: {
    en: `
You are a Salesforce developer and documentation specialist.
Your goal is to summarize the content and behavior of the Visualforce page **"{{VF_NAME}}"**.

Provide a clear, structured explanation suitable for both technical and business stakeholders.
The description should be comprehensive and use the provided structured Apex controller information.

Consider the following analysis insights in your response:
{{VF_ANALYSIS_SUMMARY}}

The output **must be valid JSON** with the following structure:

{
  "shortDescription": "", // A very brief, single-sentence summary for index tables
  "overview": "", // 2-4 sentence overview of page functionality
  "purpose": "", // Business need and user workflow supported
  "keyFunctions": [], // Core UI components and logic
  "interactions": [], // Client-server interactions and AJAX behavior
  "properties": [], // Properties bound with Visualforce expressions
  "methods": [], // Controller methods used in markup
  "componentSummary": "", // Refined component usage summary
  "performanceConsiderations": [], // Performance insights and recommendations
  "securityConsiderations": [], // Security insights and recommendations
  "bestPractices": [] // Best practice recommendations
}

---

### Visualforce Page Code (Enriched)
{{VF_CODE}}

### Apex Controller Information
{{VF_CONTROLLER}}

### Visualforce Components Summary
{{VF_COMPONENTS_SUMMARY}}

### Automated Analysis Summary
{{VF_ANALYSIS_SUMMARY}}

---

### Instructions:

1.  **shortDescription**
    Provide a concise, single-sentence summary of the page's main function. This will be used in tables.

2.  **Overview**
    Describe in 2–4 sentences what the page does, leveraging information from both VF_CODE and VF_CONTROLLER.

3.  **Purpose**
    What business need does this page address? What user workflow does it support?

4.  **Key Functions**
    - List the core UI components and logic (forms, tables, pageBlocks, inputs, buttons, JS, actionFunction, rerender, etc.)
    - Reference {{VF_COMPONENTS_SUMMARY}} for component usage

5.  **Interactions**
    - Describe client-server interactions, controller method calls, AJAX behavior, component-based logic
    - Note any JavaScript remoting or action functions

6.  **Properties**
    - Identify properties bound with Visualforce expressions (e.g. {!account.Name}, {!controller.property})
    - Use VF_CONTROLLER info where available

7.  **Methods**
    - Identify controller methods used in the markup, and describe what they appear to handle
    - Leverage VF_CONTROLLER info for method signatures and documentation

8.  **Performance Considerations**
    - Based on the automated analysis, provide performance insights
    - Suggest optimizations for large data sets, ViewState, or complex components

9.  **Security Considerations**
    - Highlight any security concerns or best practices
    - Note proper input validation and output encoding

10. **Best Practices**
    - Recommend Visualforce best practices specific to this page
    - Suggest improvements for maintainability and user experience

Return only the JSON object.`
  }
};

export default template;
