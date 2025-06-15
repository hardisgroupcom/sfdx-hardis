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
You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the business organization of the company.

### Instructions:

1. **Contextual Overview**:
    - Analyze the provided role hierarchy data to understand the organizational structure.
    - Identify key roles and their relationships within the hierarchy.
    - Summarize the roles in a way that is clear and understandable for business stakeholders.
    - Ensure the summary is concise yet comprehensive, highlighting the most important aspects of the role hierarchy.

2. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (`##`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The description of all role hierarchies is:
{{ROLES_DESCRIPTION}}

Caution: Redact any sensitive information and replace with `[REDACTED]`. Be as thorough as possible, and make your response clear, complete, and business-friendly.

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_ROLES.txt**

If you do so, please don't forget to use the replacement variables :)
