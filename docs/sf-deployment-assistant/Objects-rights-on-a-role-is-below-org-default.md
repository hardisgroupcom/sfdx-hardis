---
title: : Objects rights on a role is below org default (Deployment assistant)
description: How to solve Salesforce deployment error access level below organization default
---
<!-- markdownlint-disable MD013 -->
# Objects rights on a role is below org default

## Detection

- String: `access level below organization default`

## Resolution

```shell
Your org wide settings default must be lower than the level defined in roles:
- If you are in a scratch org, it can be fixable using "objectProperties" in project-scratch-def.json (see "Set Object-Level Sharing Settings" paragraph in page https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_scratch_orgs_def_file.htm)
- If you are in a sandbox/dev/prod org, you need to update default org wide settings before deployment. See https://www.sfdcpoint.com/salesforce/organization-wide-defaults-owd-in-salesforce/
            
```
