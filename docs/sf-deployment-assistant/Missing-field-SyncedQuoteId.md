---
title: "Missing field SyncedQuoteId (Deployment assistant)"
description: "How to solve Salesforce deployment error "field SyncedQuoteId""
---
<!-- markdownlint-disable MD013 -->
# Missing field SyncedQuoteId

## Detection

- String: `field SyncedQuoteId`
- String: `Error  force-app/main/default/objects/Quote/Quote.object-meta.xml`
- String: `Error  force-app/main/default/objects/Opportunity/fields/SyncedQuoteId.field-meta.xml`

## Resolution

```shell
Quotes must be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=sf.quotes_enable.htm&type=5
- Scratch org setting:
"quoteSettings": {
  "enableQuote": true
}
```
