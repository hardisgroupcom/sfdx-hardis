---
title: PROMPT_DESCRIBE_OBJECT
description: Prompt template for PROMPT_DESCRIBE_OBJECT
---

# PROMPT_DESCRIBE_OBJECT

## Variables
| Name | Description | Example |
| :------|:-------------|:---------|
| **OBJECT_NAME** | The API name of the Salesforce object to describe. | `Account` |
| **OBJECT_XML** | The XML metadata definition of the Salesforce object. | `<CustomObject>...</CustomObject>` |
| **ALL_OBJECTS_LIST** | A list of all objects in the Salesforce org. | `Account, Contact, Opportunity, ...` |
| **ALL_OBJECT_LINKS** | The object model (MasterDetail and Lookup relationships) for all objects. | `Account->Contact (Lookup), Opportunity->Account (MasterDetail)` |

## Prompt

```
You are a business analyst working on a Salesforce project. Your goal is to describe the Salesforce object "{{OBJECT_NAME}}" in plain English, providing a detailed explanation suitable for a business user.  The output will be in markdown format, which will be used in a documentation site aiming to retrospectively document the Salesforce org.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role and purpose of the object "{{OBJECT_NAME}}" in the Salesforce org.
    - Explain its significance in the project, its purpose in the org's implementation, and any key business processes it supports.

2. **Relationships**:
    - Use the provided object model data to describe how "{{OBJECT_NAME}}" relates to other objects.
    - Include:
        - Direct relationships (MasterDetail and Lookup fields on the object).
        - Inverse relationships (other objects referencing "{{OBJECT_NAME}}").
        - Highlight any key dependencies or implications of these relationships in plain English.

3. **Additional Guidance**:
    - **Do NOT include** fields table or validation rules table in the response
    - Use the acronyms provided to interpret metadata names (e.g., TR: Trigger, VR: Validation Rule, WF: Workflow).
    - If the XML metadata contains sensitive information (e.g., tokens, passwords), replace them with a placeholder (e.g., `[REDACTED]`).

4. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (`##`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The list of all objects in the Salesforce org is: {{ALL_OBJECTS_LIST}}

- The object model (MasterDetail and Lookup relationships) is: {{ALL_OBJECT_LINKS}}

- The metadata XML for "{{OBJECT_NAME}}" is:
{{OBJECT_XML}}

Caution: Redact any sensitive information and replace with `[REDACTED]`. Be as thorough as possible, and make your response clear, complete, and business-friendly.

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_OBJECT.txt**

If you do so, please don't forget to use the replacement variables :)
