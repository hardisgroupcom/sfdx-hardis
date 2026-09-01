---
title: "Empty custom object (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Error (.*) Must specify a non-empty label for the CustomObject\""
---
<!-- markdownlint-disable MD013 -->
# Empty custom object

## Detection

- RegExp: `Error (.*) Must specify a non-empty label for the CustomObject`

## Resolution

```shell
The CustomObject {1} has been committed without its attributes: its .object-meta.xml has no label, so the target org can not create it.
This usually happens when an object is retrieved empty, for example an object owned by a managed package.
- Either retrieve {1} again and check that its .object-meta.xml really contains a label and the other object attributes:
  sf project retrieve start -m CustomObject:{1} -o SOURCE_ORG_USERNAME
- Or, if {1} does not belong to your project, remove it from the source files (objects/{1} folder) AND from the CustomObject section of manifest/package.xml
```
