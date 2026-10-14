import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "RELEASE_DATA_JSON",
      description: "JSON object containing tickets, pull requests, and metadata change statistics for the release.",
      example: '{"tickets":[{"id":"PROJ-123","subject":"Add field","status":"Done"}],"pullRequests":[{"id":"42","title":"feat: add field","author":"J. Smith"}],"metadataStats":{"addedCount":12,"deletedCount":2}}',
      truncateAfter: 80000,
    },
    {
      name: "RELEASE_VERSION",
      description: "The release version identifier (tag or branch name).",
      example: "v1.2.0",
    },
  ],
  text: {
    "en": `You are a release manager writing release notes for stakeholders of a Salesforce project.

### Context:
Release: {{RELEASE_VERSION}}
Below is JSON data containing tickets, pull requests, and metadata change statistics for this release.

### Instructions:
1. **Main Features**: List the key features and enhancements (from tickets/PRs that are features or enhancements). Group related items together. Use concise bullet points.
2. **Bug Fixes**: List bug fixes and patches, one line per item.
3. **Statistics**: Brief stats - number of PRs merged, tickets resolved, metadata items changed.

Keep the tone professional and concise. Use markdown formatting. Do not repeat raw IDs or JSON. Do not include section numbering.

### Release Data:
{{RELEASE_DATA_JSON}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
  },
};

export default template;
