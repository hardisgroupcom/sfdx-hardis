---
title: PROMPT_DESCRIBE_PERMISSION_SET
description: Prompt template for PROMPT_DESCRIBE_PERMISSION_SET
---

# PROMPT_DESCRIBE_PERMISSION_SET

## Variables
| Name                   | Description                                            | Example                              |
|:-----------------------|:-------------------------------------------------------|:-------------------------------------|
| **PERMISSIONSET_NAME** | The name of the Salesforce Permission Set to describe. | `PS_CloudityAccount`                 |
| **PERMISSIONSET_XML**  | The XML metadata for the Salesforce Permission Set.    | `<PermissionSet>...</PermissionSet>` |

## Prompt

```
You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce PermissionSet "{{PERMISSIONSET_NAME}}" in plain English, providing a detailed explanation suitable for a business user. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the Salesforce PermissionSet that you can guess according to the content of the XML. Try to guess the role of users assigned to this permission set according to applicationVisibilities, objectVisibilities and userPermissions.
    - List the key features of the Permission Set.
      - The most important features are License, Applications, User Permissions ,features with default values ,Custom Objects and Record Types
      - Ignore Apex classes and Custom Fields
      - Ignore blocks who has access or visibility set to "false"

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The metadata XML for Salesforce Permission Set "{{PERMISSIONSET_NAME}}" is:
{{PERMISSIONSET_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_PERMISSION_SET.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
