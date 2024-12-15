---
title: "Custom object not found (Deployment assistant)"
description: "How to solve Salesforce deployment error "Error (.*) In field: field - no CustomObject named (.*) found""
---
<!-- markdownlint-disable MD013 -->
# Custom object not found

## Detection

- RegExp: `Error (.*) In field: field - no CustomObject named (.*) found`

## Resolution

```shell
A reference to a custom object {2} is not found in {1}:
- If you renamed the custom object, do a search/replace in sources with previous object name and new object name
- If you deleted the custom object, or if you don't want to deploy it, do a search on the custom object name, and remove XML elements referencing it
- If the object should exist, make sure it is in force-app/main/default/objects and that the object name is in manifest/package.xml in CustomObject section
You may also have a look to command sf hardis:project:clean:references

```
