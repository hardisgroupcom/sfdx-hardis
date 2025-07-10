---
title: PROMPT_DESCRIBE_PROFILE
description: Prompt template for PROMPT_DESCRIBE_PROFILE
---

# PROMPT_DESCRIBE_PROFILE

## Variables
| Name             | Description                                     | Example                  |
|:-----------------|:------------------------------------------------|:-------------------------|
| **PROFILE_NAME** | The name of the Salesforce Profile to describe. | `Cloudity Sales`         |
| **PROFILE_XML**  | The XML metadata for the Salesforce Profile.    | `<Profile>...</Profile>` |

## Prompt

```
You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce Profile "{{PROFILE_NAME}}" in plain English, providing a detailed explanation suitable for a business user.  {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the Salesforce Profile that you can guess according to the content of the XML. Try to guess the role of users assigned to this profile according to applicationVisibilities, objectVisibilities and userPermissions.
    - List the key features of the Profiles.
      - The most important features are License, Applications, User Permissions ,features with default values ,Custom Objects and Record Types
      - Ignore Apex classes and Custom Fields
      - Ignore blocks who has access or visibility set to "false"

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The metadata XML for Salesforce Profile "{{PROFILE_NAME}}" is:
{{PROFILE_XML}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_PROFILE.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
