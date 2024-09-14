---
title: : Can not find user (Deployment assistant)
description: How to solve Salesforce deployment error /Error (.*) Cannot find a user that matches any of the following usernames/gm
---
<!-- markdownlint-disable MD013 -->
# Can not find user

## Detection

- RegExp: `Error (.*) Cannot find a user that matches any of the following usernames`

## Resolution

```shell
You made reference to username(s) in {1}, and those users probably do not exist in target org.
- Do not use named users, but user public groups for assignments -> https://help.salesforce.com/s/articleView?id=sf.creating_and_editing_groups.htm&type=5
- or Create matching user(s) in the target deployment org
- or Remove the XML part referring to hardcoded usernames

Example of XML you have to remove in {1}:

<folderShares>
  <accessLevel>Manage</accessLevel>
  <sharedTo>nicolas.vuillamy@hardis-scratch-po-tgci-root-develop_20220412_0604.com</sharedTo>
  <sharedToType>User</sharedToType>
</folderShares>
```
