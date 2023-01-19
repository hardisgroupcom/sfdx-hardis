---
title: Fix sfdx pull issues
description: Learn how to retrieve updated metadatas when force:source:pull forgets some elements
---
<!-- markdownlint-disable MD013 -->

## Automated force retrieve

It happens that when calling [sfdx hardis:scratch:pull](https://hardisgroupcom.github.io/sfdx-hardis/hardis/scratch/pull/), some elements are not retrieved.

The most usual cases are updates on:

- CustomApplication
- RecordTypes

See how to [configure .sfdx-hardis to force the retrieve of metadatas]() with **autoRetrieveWhenPull** property.

## Manual Retrieve

You can also use command ![](assets/images/btn-select-retrieve.jpg) to manually retrieve metadatas, but it will pull **a lot of metadatas** so you will have to **carefully select them** for your commit.

> ![Under the hood](assets/images/engine.png) **_Under the hood_**
>
> See details in [hardis:source:retrieve](hardis/source/retrieve/) command documentation
