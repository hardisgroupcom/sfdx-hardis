import { PromptTemplateDefinition } from "./types.js";

const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "ROLES_DESCRIPTION",
      description: "Description of all roles of the org",
      example: "- **Role Name (id:role_api_name)**: Role description (parentId: parent_role_id)\n- **Another Role (id:another_role_api_name)**: Another role description (parentId: another_parent_role_id)\n - **Root Role (id:root_role_api_name)**: Root role description (parentId: ROOT)",
      truncateAfter: 100000
    },
  ],
  text: {
    "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the business organization of the company. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Analyze the provided role hierarchy data to understand the organizational structure.
    - Identify key roles and their relationships within the hierarchy.
    - Summarize the roles in a way that is clear and understandable for business stakeholders.
    - Ensure the summary is concise yet comprehensive, highlighting the most important aspects of the role hierarchy.

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The description of all role hierarchies is:
{{ROLES_DESCRIPTION}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}
`,
  },
};

export default template;
