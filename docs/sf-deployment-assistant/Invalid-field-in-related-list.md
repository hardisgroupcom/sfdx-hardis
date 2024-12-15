---
title: "Invalid field in related list (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Error (.*) Invalid field:(.*) in related list:(.*)\""
---
<!-- markdownlint-disable MD013 -->
# Invalid field in related list

## Detection

- RegExp: `Error (.*) Invalid field:(.*) in related list:(.*)`

## Resolution

```shell
Field {2} is unknown. You can:
- Activate the related feature license or option to make {2} existing in target org
- Update XML of {1} to remove reference to field {2} in the related list {3}
- Update XML of {1} to remove the whole related list {3}
Example of XML to remove:
<relatedLists>
  <fields>SOLUTION.ISSUE</fields>
  <fields>SOLUTION.SOLUTION_NUMBER</fields>
  <fields>SOLUTION.STATUS</fields>
  <fields>CORE.USERS.ALIAS</fields>
  <relatedList>RelatedSolutionList</relatedList>
</relatedLists>

```
