---
title: : Missing object referenced in package.xml (Deployment assistant)
description: How to solve Salesforce deployment error /An object (.*) of type (.*) was named in package.xml, but was not found in zipped directory/gm
---
<!-- markdownlint-disable MD013 -->
# Missing object referenced in package.xml

## Detection

- RegExp: `An object (.*) of type (.*) was named in package.xml, but was not found in zipped directory`

## Resolution

```shell
You can either:
- Update the package.xml to remove the reference to the missing {2} {1}
- Add the missing {2} {1} in your project source files
```
