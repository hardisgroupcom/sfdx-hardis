---
title: Source retrieve issues
description: Learn how to retrieve the metadata that sf hardis:scratch:pull sometimes misses, like CustomApplication or RecordType, with the Metadata Retriever or autoRetrieveWhenPull
---
<!-- markdownlint-disable MD013 -->

## Source retrieve issues

Sometimes [sf hardis:scratch:pull](https://sfdx-hardis.cloudity.com/hardis/scratch/pull/) does not retrieve every element you updated in your org.

The most usual cases are updates on:

- CustomApplication
- RecordType

You have three ways to get the missing metadata.

### Metadata Retriever (recommended)

Use the **Metadata Retriever** panel of the VS Code SFDX Hardis extension to pick exactly the metadata to retrieve from your org, then commit it.

![Metadata Retriever panel](assets/images/metadata-retriever.gif)

### Automated retrieve after each pull

Declare the metadata that is often missed in the **autoRetrieveWhenPull** property of `.sfdx-hardis.yml`: sfdx-hardis retrieves it automatically after each pull.

```yaml
autoRetrieveWhenPull:
  - CustomApplication
  - RecordType:Account.Customer
```

See the [autoRetrieveWhenPull](schema/sfdx-hardis-json-schema-parameters.html#autoRetrieveWhenPull) property in the configuration reference.

### Select and retrieve command

You can also use the command ![Select and retrieve sources from org](assets/images/btn-select-retrieve.jpg) to retrieve metadata manually. It pulls **a lot of metadata**, so you have to **carefully select** what you commit.

> ![Under the hood](assets/images/engine.png) **_Under the hood_**
>
> See details in the [hardis:source:retrieve](https://sfdx-hardis.cloudity.com/hardis/source/retrieve/) command documentation
