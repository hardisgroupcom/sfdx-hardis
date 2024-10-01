---
title: Not valid sharing model (Deployment assistant)
description: How to solve Salesforce deployment error /Error (.*) (.*) is not a valid sharing model for (.*) when (.*) sharing model is (.*)/gm
---
<!-- markdownlint-disable MD013 -->
# Not valid sharing model

## Detection

- RegExp: `Error (.*) (.*) is not a valid sharing model for (.*) when (.*) sharing model is (.*)`

## Resolution

```shell
It seems that Sharing Models of {1} and {4} are not compatible in target org.
- Use compatible sharing models between {1} and {4} by updating Sharing model of {1} or {4}
- Make sure that sfdx sources {1}.object-meta.xml and {4}.object-meta.xml and in the files, and that {1} and {4} are in package.xml in CustomObject block
- You may directly update sharingModel in XML. For example, replace <sharingModel>ReadWrite</sharingModel> by <sharingModel>Private</sharingModel> in {3}.object-meta.xml

```
