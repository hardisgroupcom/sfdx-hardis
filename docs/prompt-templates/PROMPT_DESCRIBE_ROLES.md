---
title: PROMPT_DESCRIBE_ROLES
description: Prompt template for PROMPT_DESCRIBE_ROLES
---

# PROMPT_DESCRIBE_ROLES

## Variables
| Name                  | Description                         | Example                                                                                                                                                                                                                                                                             |
|:----------------------|:------------------------------------|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **ROLES_DESCRIPTION** | Description of all roles of the org | `- **Role Name (id:role_api_name)**: Role description (parentId: parent_role_id)<br>- **Another Role (id:another_role_api_name)**: Another role description (parentId: another_parent_role_id)<br> - **Root Role (id:root_role_api_name)**: Root role description (parentId: ROOT)` |

## Prompt

```
You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the business organization of the company. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

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

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_ROLES.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
