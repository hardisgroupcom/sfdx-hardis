---
title: "Missing Quick Action (Deployment assistant)"
description: "How to solve Salesforce deployment error "Error (.*) In field: QuickAction - no QuickAction named (.*) found""
---
<!-- markdownlint-disable MD013 -->
# Missing Quick Action

## Detection

- RegExp: `Error (.*) In field: QuickAction - no QuickAction named (.*) found`

## Resolution

```shell
QuickAction {2} referred in {1} is unknown. You can either:
- Make sure your QuickAction {2} is present in source files and in package.xml
- If {2} is a standard QuickAction, activate related feature in target org
- Solve other errors that could impact QuickAction {2}
- Remove QuickAction {2} in the source XML of {1}. Example of XML to remove below:
<quickActionListItems>
  <quickActionName>FeedItem.RypplePost</quickActionName>
</quickActionListItems>
```
