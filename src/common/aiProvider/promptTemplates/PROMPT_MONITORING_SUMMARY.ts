import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "NOTIFICATIONS_JSON",
      description: "JSON array of all monitoring notification messages collected during this run.",
      example: '[{"type":"ORG_LIMITS","severity":"warning","text":"..."}]',
      truncateAfter: 100000,
    },
    {
      name: "ORG_URL",
      description: "The Salesforce org instance URL being monitored.",
      example: "https://mycompany.my.salesforce.com",
    },
  ],
  text: {
    "en": `You are a Salesforce administrator reviewing the results of an automated org monitoring run on {{ORG_URL}}.

### Context:
Below is a JSON array of all monitoring notifications generated during this run. Each notification has a type, severity (critical/error/warning/info/success), text description, and optional data.

### Instructions:

1. **Executive Summary**: Write a 2-3 sentence high-level overview of the org's health status.

2. **Findings by Priority**: Group findings into sections by severity (critical first, then error, warning, info). For each finding:
   - State what was detected
   - Explain the business risk if not addressed
   - Provide a concrete recommended action

3. **Quick Wins**: Identify the top 3 easiest items to fix that would improve org health.

4. **Metrics Snapshot**: Summarize key numeric metrics (limits usage, error counts, unused licenses, etc.) in a brief table.

5. Keep the tone professional and actionable. Use markdown formatting.

### Monitoring Data:
{{NOTIFICATIONS_JSON}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
  },
};

export default template;
