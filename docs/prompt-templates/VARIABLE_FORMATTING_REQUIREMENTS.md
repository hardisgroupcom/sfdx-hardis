---
title: VARIABLE_FORMATTING_REQUIREMENTS
description: Prompt variable for VARIABLE_FORMATTING_REQUIREMENTS
---

# VARIABLE_FORMATTING_REQUIREMENTS

## Description

This is a reusable prompt variable that provides common instructions across multiple prompt templates.

## Content

```
**Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (`##`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.
```

## How to override

To define your own variable content, you can define a local file **config/prompt-templates/VARIABLE_FORMATTING_REQUIREMENTS.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override variable files at once.

