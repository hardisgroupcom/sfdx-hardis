---
title: Handle Profiles on a Salesforce CI/CD project
description: Learn how to handle the profile mess !
---
<!-- markdownlint-disable MD013 -->

## Deploy Profiles

### Use Permission Sets !

In case an attribute is available on Profiles and Permission Sets: **USE PERMISSION SETS** :)

- Apex Class Access (`classAccesses`)
- Custom Metadata Type Access (`customMetadataTypeAccesses`)
- External Data Source Access (`externalDataSourceAccesses`)
- Field Permissions (`fieldPermissions`)
- Object Permissions (`objectPermissions`)
- Page Access (`pageAccesses`)
- User Permissions (`userPermissions (except on Admin Profile)`)

If you are on a build project, it is recommended to [automate Minimize Profile](https://sfdx-hardis.cloudity.com/hardis/project/clean/minimizeprofiles/) so such attributes are [automatically removed from Profiles before Merge Requests](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-config-cleaning/#minimize-profiles).

### Tab visibility

When you retrieve a profile, standard tabs visibility is not present in the XML.

This is quite boring because if you do nothing, Calendar, Tasks, Home or Contact tab vibilities won't be deployed !

To avoid that, standard tab visibility must be added in the Profile XML.

You can use sfdx-hardis command [Fix Profile Tabs]() to Show / Hide tabs in your Profile XML files.

