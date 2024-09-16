---
title: : Missing feature Opportunity Teams (Deployment assistant)
description: How to solve Salesforce deployment error OpportunityTeam
---
<!-- markdownlint-disable MD013 -->
# Missing feature Opportunity Teams

## Detection

- String: `OpportunityTeam`

## Resolution

```shell
Opportunity Teams must be activated in the target org.
- Org: Setup -> Opportunity Team Settings -> Enable Team Selling
- Scratch org:
"opportunitySettings": {
  "enableOpportunityTeam": true
}
```
