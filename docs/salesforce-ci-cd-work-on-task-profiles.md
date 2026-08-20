---
title: Profiles and Permission Sets on a Salesforce CI/CD project
description: Learn how to handle Profiles and Permission Sets on a Salesforce CI/CD project, and which Profile settings cannot be deployed
---
<!-- markdownlint-disable MD013 -->

## Profiles and Permission Sets

### Use Permission Sets

When an attribute is available on both Profiles and Permission Sets, **use Permission Sets**. This applies to:

- Apex Class Access (`classAccesses`)
- Custom Metadata Type Access (`customMetadataTypeAccesses`)
- External Data Source Access (`externalDataSourceAccesses`)
- Field Permissions (`fieldPermissions`)
- Object Permissions (`objectPermissions`)
- Page Access (`pageAccesses`)
- User Permissions (`userPermissions`, except on the Admin Profile)

If you are on a build project, it is recommended to [automate Minimize Profiles](https://sfdx-hardis.cloudity.com/hardis/project/clean/minimizeprofiles/) so such attributes are [automatically removed from Profiles before the Pull Request](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-config-cleaning/#minimize-profiles) (Merge Request on GitLab).

### Tab visibility

When you retrieve a Profile, the visibility of standard tabs is not present in the XML.

If you do nothing, the visibility of the Calendar, Tasks, Home or Contact tabs is not deployed.

To avoid that, the standard tab visibility must be added in the Profile XML.

Use the sfdx-hardis command [Fix Profile Tabs](https://sfdx-hardis.cloudity.com/hardis/project/fix/profiletabs/) to show or hide tabs in your Profile XML files.

### Application visibility

You can deploy the visibility of custom applications through the Profile XML, but **hiding a standard application for a Profile cannot be deployed** with metadata.

This is a Salesforce platform limitation: standard applications can be set as visible or default in the Profile XML, but hiding them must be done manually in the target org.

**Manual steps required:**

1. Go to **Setup** in the target org.
2. Open **Profiles**.
3. Select the Profile you want to modify.
4. Scroll to the **Custom App Settings** section.
5. Find the standard application(s) you want to hide.
6. Uncheck the **Visible** checkbox for the application(s).
7. Save the Profile.

**Important notes:**

- Make sure at least one application remains set as the default for each Profile (see [Missing profile default application](sf-deployment-assistant/Missing-profile-default-application.md)).
- This manual step must be repeated in each environment (sandbox, preprod, production).
- Track this manual step with a [manual deployment action](salesforce-ci-cd-work-on-task-deployment-actions.md#manual-step) on your Pull Request, so nobody forgets it.
