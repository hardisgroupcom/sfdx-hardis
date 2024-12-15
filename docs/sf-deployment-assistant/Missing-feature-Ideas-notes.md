---
title: "Missing feature Ideas notes (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Idea.InternalIdeasIdeaRecordType\""
---
<!-- markdownlint-disable MD013 -->
# Missing feature Ideas notes

## Detection

- String: `Idea.InternalIdeasIdeaRecordType`

## Resolution

```shell
Ideas must be activated in the target org.
- Org: https://help.salesforce.com/articleView?id=networks_enable_ideas.htm&type=0
- Scratch org setting:
"ideasSettings": {
  "enableIdeas": true
}
```
