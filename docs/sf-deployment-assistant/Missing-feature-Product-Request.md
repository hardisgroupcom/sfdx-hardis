---
title: : Missing feature Product Request (Deployment assistant)
description: How to solve Salesforce deployment error ProductRequest
---
<!-- markdownlint-disable MD013 -->
# Missing feature Product Request

## Detection

- String: `ProductRequest`

## Resolution

```shell
ProductRequest object is not available in the target org.
Maybe you would like to clean its references within Profiles / PS using the following command ?
sf hardis:project:clean:references , then select "ProductRequest references"
```
