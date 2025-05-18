---
title: PROMPT_DESCRIBE_PACKAGE
description: Prompt template for PROMPT_DESCRIBE_PACKAGE
---

# PROMPT_DESCRIBE_PACKAGE

## Variables
| Name | Description | Example |
| :------|:-------------|:---------|
| **PACKAGE_NAME** | The name of the package to describe. | `Pardot` |
| **PACKAGE_XML** | The JsonL metadata for the package | `{"SubscriberPackageName":"Pardot","SubscriberPackageNamespace":"pi","SubscriberPackageVersionNumber":"1.0.0","SubscriberPackageVersionId":"04t1t0000000abcAAA","SubscriberPackageVersionName":"Pardot Version 1.0"}` |
| **PACKAGE_METADATAS** | A list of all metadata items (Apex classes, objects, flows, etc.) in the org that are provided by this package (namespaced). | `ApexClass: pi__MyClass, CustomObject: pi__MyObject, Flow: pi__MyFlow` |

## Prompt

```
You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce Installed package "{{PACKAGE_NAME}}" in plain English, providing a detailed explanation suitable for a business user.

### Instructions:

1. **Contextual Overview**:
    - Begin by summarizing the role of the package.
    - Continue by describing the package's main features and functionalities.
    - If you can find links to documentation on the internet, include them.

2. **Package Metadata**:
    - Review the list of metadata items (Apex classes, objects, flows, etc.) provided by this package, as listed in reference data.
    - Highlight the most important or business-relevant components.

3. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (`##`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The attributes for Installed package "{{PACKAGE_NAME}}" are:
{{PACKAGE_XML}}

- The list of metadata items provided by this package is:
{{PACKAGE_METADATAS}}


Caution: Redact any sensitive information and replace with `[REDACTED]`. Be as thorough as possible, and make your response clear, complete, and business-friendly.

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_DESCRIBE_PACKAGE.txt**

If you do so, please don't forget to use the replacement variables :)
