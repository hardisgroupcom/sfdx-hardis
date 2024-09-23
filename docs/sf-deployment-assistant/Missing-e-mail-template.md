---
title: : Missing e-mail template (Deployment assistant)
description: How to solve Salesforce deployment error /In field: template - no EmailTemplate named (.*) found/gm
---
<!-- markdownlint-disable MD013 -->
# Missing e-mail template

## Detection

- RegExp: `In field: template - no EmailTemplate named (.*) found`

## Resolution

```shell
An email template should be present in the sources. To retrieve it, you can run:
sf project retrieve start -m EmailTemplate:{1} -o YOUR_ORG_USERNAME
```
