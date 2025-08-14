---
title: PROMPT_DESCRIBE_APEX
description: Prompt template for PROMPT_DESCRIBE_APEX
---

# PROMPT_DESCRIBE_APEX

## Variables
| Name           | Description                                        | Example                                   |
|:---------------|:---------------------------------------------------|:------------------------------------------|
| **CLASS_NAME** | The name of the Salesforce Apex class to describe. | `MyCustomController`                      |
| **APEX_CODE**  | The full source code of the Apex class.            | `public class MyCustomController { ... }` |

## Prompt

```
You are a developer working on a Salesforce project. Your goal is to summarize the behavior of the Salesforce Apex class "{{CLASS_NAME}}" in plain English, providing a detailed explanation suitable for a business user. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the apex class.
    - List the key functionalities and business logic implemented in the class.

2. {{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The code for Apex class "{{CLASS_NAME}}" is:
{{APEX_CODE}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_APEX.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
