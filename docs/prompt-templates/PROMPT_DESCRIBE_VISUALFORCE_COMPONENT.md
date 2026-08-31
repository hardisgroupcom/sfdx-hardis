---
title: PROMPT_DESCRIBE_VISUALFORCE_COMPONENT
description: Prompt template for PROMPT_DESCRIBE_VISUALFORCE_COMPONENT
---

# PROMPT_DESCRIBE_VISUALFORCE_COMPONENT

## Variables
| Name                             | Description                                                                           | Example                                |
|:---------------------------------|:--------------------------------------------------------------------------------------|:---------------------------------------|
| **VISUALFORCE_NAME**             | The name of the Visualforce component to describe.                                    | `AccountAddressBlock`                  |
| **VISUALFORCE_MARKUP**           | The Visualforce markup of the component.                                              | `<apex:component>...</apex:component>` |
| **VISUALFORCE_META**             | The metadata file of the Visualforce component.                                       | `<ApexComponent>...</ApexComponent>`   |
| **VISUALFORCE_APEX_CONTROLLERS** | The names of the Apex controller and extensions declared by the component, or "none". | `AccountAddressBlockController`        |

## Prompt

```
You are a skilled Salesforce developer working on a Visualforce project. Your goal is to explain the Salesforce Visualforce component "{{VISUALFORCE_NAME}}" in plain English, providing a detailed explanation suitable for other developers and business users. {{VARIABLE_OUTPUT_FORMAT_MARKDOWN_DOC}}

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing what the component displays or does, and the business need it answers.
    - Explain how a page embedding the component benefits from it.

2. **Attributes and Reusability**:
    - List the attributes declared by the component (`apex:attribute`), and for each of them its type, whether it is required, its default value and what the component does with it.
    - Explain how a page or another component must embed it, showing the markup tag with its attributes.
    - Describe the assumptions the component makes about its context, for example a record it expects to receive or a controller it needs.

3. **Technical Analysis**:
    - Describe the internal structure of the component and the data bindings it uses.
    - Mention the other custom components, static resources, JavaScript and stylesheets it relies on.

Important: only the markup and the metadata of the component are provided. The source of the Apex controller and extensions is NOT provided: name them and describe the role you can infer from how the component calls them, but do not speculate about their internal implementation.

{{VARIABLE_FORMATTING_REQUIREMENTS}}

### Reference Data:

- The Apex controller and extensions declared by component "{{VISUALFORCE_NAME}}": {{VISUALFORCE_APEX_CONTROLLERS}}

- The Visualforce markup of component "{{VISUALFORCE_NAME}}":
```
{{VISUALFORCE_MARKUP}}
```

- The metadata of component "{{VISUALFORCE_NAME}}":
```
{{VISUALFORCE_META}}
```

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_VISUALFORCE_COMPONENT.md**

> For backward compatibility, **config/prompt-templates/PROMPT_DESCRIBE_VISUALFORCE_COMPONENT.txt** is also supported, but **.md is preferred**.

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
