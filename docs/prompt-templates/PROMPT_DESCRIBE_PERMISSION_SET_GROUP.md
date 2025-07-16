---
title: PROMPT_DESCRIBE_PERMISSION_SET_GROUP
description: Prompt template for PROMPT_DESCRIBE_PERMISSION_SET_GROUP
---

# PROMPT_DESCRIBE_PERMISSION_SET_GROUP

## Variables
| Name                        | Description                                                  | Example                                        |
|:----------------------------|:-------------------------------------------------------------|:-----------------------------------------------|
| **PERMISSIONSETGROUP_NAME** | The name of the Salesforce Permission Set Group to describe. | `PS_CloudityAdmin`                             |
| **PERMISSIONSETGROUP_XML**  | The XML metadata for the Salesforce Permission Set Group.    | `<PermissionSetGroup>...</PermissionSetGroup>` |

## Prompt

```
You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce PermissionSetGroup "{{PERMISSIONSETGROUP_NAME}}" in plain English, providing a detailed explanation suitable for a business user. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the Salesforce PermissionSetGroup that you can guess according to the content of the XML. Try to guess the role of users assigned to this permission set group according to the name, description and related Permission Sets
    - List the key features of the Permission Set.

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The metadata XML for Salesforce Permission Set Group "{{PERMISSIONSETGROUP_NAME}}" is:
{{PERMISSIONSETGROUP_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_PERMISSION_SET_GROUP.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
