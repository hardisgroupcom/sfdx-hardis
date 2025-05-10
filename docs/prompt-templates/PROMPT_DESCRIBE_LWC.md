---
title: PROMPT_DESCRIBE_LWC
description: Prompt template for PROMPT_DESCRIBE_LWC
---

# PROMPT_DESCRIBE_LWC

## Variables
| Name | Description | Example |
| :------|:-------------|:---------|
| **LWC_NAME** | The name of the Lightning Web Component to describe. | `myCustomComponent` |
| **LWC_JS_CODE** | The JavaScript code of the Lightning Web Component. | `import { LightningElement } from 'lwc'; ...` |
| **LWC_HTML_CODE** | The HTML template code of the Lightning Web Component. | `<template>...</template>` |
| **LWC_JS_META** | The meta configuration file for the Lightning Web Component. | `<LightningComponentBundle>...</LightningComponentBundle>` |

## Prompt

```
You are a skilled Salesforce developer working on a Lightning Web Components (LWC) project. Your goal is to explain the Salesforce Lightning Web Component "{{LWC_NAME}}" in plain English, providing a detailed explanation suitable for other developers and business users.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the purpose and functionality of the Lightning Web Component.
    - Describe the key features and capabilities it provides to users.
    - Explain how it interacts with Salesforce data or other components.

2. **Technical Analysis**:
    - Describe the main JavaScript methods and their purposes.
    - Explain how the component handles data binding and events.
    - Mention any wire services, apex methods, or external services the component uses.
    - Identify any custom properties or special configurations.

3. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (`##`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The HTML template for component "{{LWC_NAME}}":
```
{{LWC_HTML_CODE}}
```

- The JavaScript controller for component "{{LWC_NAME}}":
```
{{LWC_JS_CODE}}
```

- The metadata configuration for component "{{LWC_NAME}}":
```
{{LWC_JS_META}}
```

Caution: Redact any sensitive information and replace with `[REDACTED]`. Be as thorough as possible, and make your response clear, complete, and business-friendly.

```

## How to override

To define your own prompt text, you can define a local file **prompt-templates/PROMPT_DESCRIBE_LWC.txt**

If you do so, please don't forget to use the replacement variables :)
