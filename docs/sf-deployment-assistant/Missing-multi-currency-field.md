---
title: "Missing multi-currency field (Deployment assistant)"
description: "How to solve Salesforce deployment error \"/A reference to a custom field (.*)CurrencyIsoCode\""
---
<!-- markdownlint-disable MD013 -->
# Missing multi-currency field

## Detection

- RegExp: `A reference to a custom field (.*)CurrencyIsoCode`

## Resolution

```shell
You probably need to activate MultiCurrency (from Setup -> Company information)
```
