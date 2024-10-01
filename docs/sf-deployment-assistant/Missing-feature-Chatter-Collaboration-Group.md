---
title: Missing feature Chatter Collaboration Group (Deployment assistant)
description: How to solve Salesforce deployment error CollaborationGroup
---
<!-- markdownlint-disable MD013 -->
# Missing feature Chatter Collaboration Group

## Detection

- String: `CollaborationGroup`

## Resolution

```shell
Quotes must be activated in the target org.
- Org: Setup -> Chatter settings -> Allow Records in Groups
- Scratch org setting:
"chatterSettings": {
  "allowRecordsInChatterGroup": true
},
```
