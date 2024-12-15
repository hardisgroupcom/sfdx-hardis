---
title: "Missing feature Social Customer Service (Deployment assistant)"
description: "How to solve Salesforce deployment error \"SocialPersona.AreWeFollowing\""
---
<!-- markdownlint-disable MD013 -->
# Missing feature Social Customer Service

## Detection

- String: `SocialPersona.AreWeFollowing`

## Resolution

```shell
Social Custom Service must be activated in the target org.
- Org: Setup -> https://help.salesforce.com/articleView?id=sf.social_customer_service_setup_enable.htm&type=5
- Scratch org feature: SocialCustomerService
```
