---
title: "Send email is disabled (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Send Email is disabled or activities are not allowed\""
---
<!-- markdownlint-disable MD013 -->
# Send email is disabled

## Detection

- String: `Send Email is disabled or activities are not allowed`
- String: `Unknown user permission: SendExternalEmailAvailable`

## Resolution

```shell
Go to Email -> Deliverability -> Select value "All emails"
```
