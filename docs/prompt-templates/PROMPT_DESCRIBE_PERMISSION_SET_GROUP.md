---
title: PROMPT_DESCRIBE_PERMISSION_SET_GROUP
description: Prompt template for PROMPT_DESCRIBE_PERMISSION_SET_GROUP
---

# PROMPT_DESCRIBE_PERMISSION_SET_GROUP

## Variables
| Name | Description | Example |
| :------|:-------------|:---------|
| **PERMISSIONSETGROUP_NAME** | The name of the Salesforce Permission Set Group to describe. | `My_Permission_Set_Group` |
| **PERMISSIONSETGROUP_XML** | The XML metadata for the Salesforce Permission Set Group. | `<PermissionSetGroup>...</PermissionSetGroup>` |

## Prompt

```
You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce PermissionSetGroup "{{PERMISSIONSETGROUP_NAME}}" in plain English, providing a detailed explanation suitable for a business user.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the Salesforce PermissionSetGroup that you can guess according to the content of the XML. Try to guess the role of users assigned to this permission set group according to the name, description and related Permission Sets
    - List the key features of the Permission Set.

2. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (`##`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The metadata XML for Salesforce Permission Set Group "{{PERMISSIONSETGROUP_NAME}}" is:
{{PERMISSIONSETGROUP_XML}}

Caution: Redact any sensitive information and replace with `[REDACTED]`. Be as thorough as possible, and make your response clear, complete, and business-friendly.

```

## How to override

To define your own prompt text, you can define a local file **prompt-templates/PROMPT_DESCRIBE_PERMISSION_SET_GROUP.txt**

If you do so, please don't forget to use the replacement variables :)
