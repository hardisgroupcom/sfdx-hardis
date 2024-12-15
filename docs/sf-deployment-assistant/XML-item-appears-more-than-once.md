---
title: "XML item appears more than once (Deployment assistant)"
description: "How to solve Salesforce deployment error /Error (.*) Field:(.*), value:(.*) appears more than once/gm"
---
<!-- markdownlint-disable MD013 -->
# XML item appears more than once

## Detection

- RegExp: `Error (.*) Field:(.*), value:(.*) appears more than once`

## Resolution

```shell
You probably made an error while merging conflicts
Look for {3} in the XML of {1}
If you see two {2} XML blocks with {3}, please decide which one you keep and remove the other one
```
