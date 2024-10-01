---
title: Missing feature Enhanced notes (Deployment assistant)
description: How to solve Salesforce deployment error FeedItem.ContentNote
---
<!-- markdownlint-disable MD013 -->
# Missing feature Enhanced notes

## Detection

- String: `FeedItem.ContentNote`

## Resolution

```shell
Enhanced Notes must be activated in the target org.
- Org: Setup -> Notes settings -> Enable Notes
- Scratch org setting:
"enhancedNotesSettings": {
  "enableEnhancedNotes": true
},
```
