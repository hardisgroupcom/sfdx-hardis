---
title: : Can not find user (2) (Deployment assistant)
description: How to solve Salesforce deployment error /Error (.*) In field: (.*) - no User named (.*) found/gm
---
<!-- markdownlint-disable MD013 -->
# Can not find user (2)

## Detection

- RegExp: `Error (.*) In field: (.*) - no User named (.*) found`

## Resolution

```shell
You made reference to username {3} in {1}, and it probably does not exist in the target org.
- Do not use named users, but user public groups for assignments -> https://help.salesforce.com/s/articleView?id=sf.creating_and_editing_groups.htm&type=5
- or Create matching user {3} in the target deployment org
- or open {1} metadata and remove the XML part referring to hardcoded username {3}
```
