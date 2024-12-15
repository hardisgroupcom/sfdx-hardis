---
title: "Mandatory custom field can not be in a profile/permission set (Deployment assistant)"
description: "How to solve Salesforce deployment error /Error (.*) You cannot deploy to a required field: (.*)/gm"
---
<!-- markdownlint-disable MD013 -->
# Mandatory custom field can not be in a profile/permission set

## Detection

- RegExp: `Error (.*) You cannot deploy to a required field: (.*)`

## Resolution

```shell

- Search for {2} in source file XML of {1}, then remove the entries matching the results
Example of element to delete:
<fieldPermissions>
  <editable>true</editable>
  <field>{2}</field>
  <readable>true</readable>
</fieldPermissions>

```
