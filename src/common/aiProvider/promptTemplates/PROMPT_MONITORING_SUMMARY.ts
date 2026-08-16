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

### Hard length constraint:
Your full response MUST be **under 2800 characters total** (this will be posted to Slack, which rejects messages longer than 3000 characters). Be concise: prefer short bullets, compact tables, and trim adjectives. Do not output a preamble or closing remarks.

### Instructions:

1. **Executive Summary**: 1-2 short sentences on overall org health.

2. **Findings by Priority**: Group by severity (critical first, then error, warning; skip info/success unless notable). For each finding use one compact bullet:
   - what was detected -- business risk -- recommended action
   If there are many findings of the same type, aggregate them into a single bullet with a count.

3. **Quick Wins**: Top 3 easiest fixes, one short line each.

4. **Metrics Snapshot**: A compact markdown table of the most relevant numeric metrics only. Skip if not informative.

5. Tone: professional, actionable, terse. Markdown formatting. No emojis.

### Monitoring Data:
{{NOTIFICATIONS_JSON}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

Remember: the entire response must stay under 2800 characters.
`,
  },
};

export default template;
