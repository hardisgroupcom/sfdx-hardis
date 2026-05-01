---
title: PROMPT_RELEASE_SUMMARY
description: Prompt template for PROMPT_RELEASE_SUMMARY
---

# PROMPT_RELEASE_SUMMARY

## Variables
| Name | Description | Example |
| :------|:-------------|:---------|
| **RELEASE_DATA_JSON** | JSON object containing tickets, pull requests, and metadata change statistics for the release. | `{"tickets":[{"id":"PROJ-123","subject":"Add field","status":"Done"}],"pullRequests":[{"id":"42","title":"feat: add field","author":"J. Smith"}],"metadataStats":{"addedCount":12,"deletedCount":2}}` |
| **RELEASE_VERSION** | The release version identifier (tag or branch name). | `v1.2.0` |

## Prompt

```
You are a release manager writing release notes for stakeholders of a Salesforce project.

### Context:
Release: {{RELEASE_VERSION}}
Below is JSON data containing tickets, pull requests, and metadata change statistics for this release.

### Instructions:
1. **Main Features**: List the key features and enhancements (from tickets/PRs that are features or enhancements). Group related items together. Use concise bullet points.
2. **Bug Fixes**: List bug fixes and patches, one line per item.
3. **Statistics**: Brief stats - number of PRs merged, tickets resolved, metadata items changed.

Keep the tone professional and concise. Use markdown formatting. Do not repeat raw IDs or JSON. Do not include section numbering.

### Release Data:
{{RELEASE_DATA_JSON}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_RELEASE_SUMMARY.md**

> For backward compatibility, **config/prompt-templates/PROMPT_RELEASE_SUMMARY.txt** is also supported, but **.md is preferred**.

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
