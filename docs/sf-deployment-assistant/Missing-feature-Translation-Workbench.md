---
title: "Missing feature Translation Workbench (Deployment assistant)"
description: "How to solve Salesforce deployment error "/report-meta.xml(.*)filterlanguage""
---
<!-- markdownlint-disable MD013 -->
# Missing feature Translation Workbench

## Detection

- RegExp: `report-meta.xml(.*)filterlanguage`

## Resolution

```shell
Translation workbench must be activated in the target org.
- Org: Setup -> https://help.salesforce.com/articleView?id=sf.customize_wbench.htm&type=5
- Scratch org:
"languageSettings": {
  "enableTranslationWorkbench":  true,
  "enableEndUserLanguages": true
}
```
