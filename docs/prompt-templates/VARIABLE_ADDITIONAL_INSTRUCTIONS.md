---
title: VARIABLE_ADDITIONAL_INSTRUCTIONS
description: Prompt variable for VARIABLE_ADDITIONAL_INSTRUCTIONS
---

# VARIABLE_ADDITIONAL_INSTRUCTIONS

## Description

This is a reusable prompt variable that provides common instructions across multiple prompt templates.

## Content

```
### Additional Instructions
    
- Caution: Redact any sensitive information (tokens, passwords, API keys, etc.) and replace with `[HIDDEN_SENSITIVE_INFOS]`.
- Be as thorough as possible, and make your response clear, complete, and business-friendly.
```

## How to override

To define your own variable content, you can define a local file **config/prompt-templates/VARIABLE_ADDITIONAL_INSTRUCTIONS.txt**

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override variable files at once.

