---
title: Handle Profiles on a Salesforce CI/CD project
description: Learn how to handle the profile mess !
---
<!-- markdownlint-disable MD013 -->

## Deploy Profiles

### Use Permission Sets

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

This is quite boring because if you do nothing, Calendar, Tasks, Home or Contact tab visibilities won't be deployed !

To avoid that, standard tab visibility must be added in the Profile XML.

You can use sfdx-hardis command [Fix Profile Tabs](https://sfdx-hardis.cloudity.com/hardis/project/fix/profiletabs/) to Show / Hide tabs in your Profile XML files.

### Application visibility

While you can deploy custom application visibility settings through the Profile XML, **hiding standard applications for a profile cannot be deployed** via metadata.

This is a Salesforce platform limitation: standard applications can be set as visible or default in the Profile XML, but hiding them must be done manually in the target org.

**Manual steps required:**

1. Go to **Setup** in the target org
2. Navigate to **Profiles**
3. Select the profile you want to modify
4. Scroll to the **Custom App Settings** section
5. Find the standard application(s) you want to hide
6. Uncheck the **Visible** checkbox for the application(s)
7. Save the profile

**Important notes:**

- Ensure at least one application remains set as the default for each profile (see [Missing profile default application](sf-deployment-assistant/Missing-profile-default-application.md))
- This manual step must be repeated in each environment (sandbox, pre-production, production)
- Document this manual step in your deployment checklist or use [deployment actions](salesforce-ci-cd-work-on-task-deployment-actions.md#manual-step) to track it

