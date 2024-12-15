---
title: "Missing feature Live Agent (Deployment assistant)"
description: "How to solve Salesforce deployment error "FeedItem.ContentNote""
---
<!-- markdownlint-disable MD013 -->
# Missing feature Live Agent

## Detection

- String: `FeedItem.ContentNote`

## Resolution

```shell
Live Agent must be activated in the target org.
- Org: Setup -> Live Agent Settings -> Enable Live Agent
- Scratch org feature: LiveAgent
```
