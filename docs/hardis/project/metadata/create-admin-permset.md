---
title: Create Admin Permission Set
description: Generate a Permission Set with full CRUD and Modify All permissions on all custom objects and fields from local source metadata
---

## Description

This command scans your local Salesforce source metadata and generates a comprehensive Permission Set XML file with maximum permissions on all custom objects and their fields.
It is particularly useful for:

- **Development & Testing:** Quickly create an admin-level permission set for scratch orgs or sandboxes
- **Data Migration:** Grant full access to data loader users during migration projects
- **Troubleshooting:** Eliminate permission-related issues when debugging by granting full access
- **Permission Set Templates:** Use the generated file as a starting point for creating role-specific permission sets

## Usage

```shell
# Generate with default name (ObjectRightsModifyAll)
sf hardis:project:metadata:create-admin-permset

# Generate with custom name
sf hardis:project:metadata:create-admin-permset --name MyAdminPermSet
```

## Parameters

| Name            | Type   | Description                                              | Default                 |
|-----------------|--------|----------------------------------------------------------|-------------------------|
| `--name` / `-n` | string | Name of the permission set (used for label and filename) | `ObjectRightsModifyAll` |

## Output

The command generates a Permission Set XML file at:

```
force-app/main/default/permissionsets/<name>.permissionset-meta.xml
```

## What's Included

### Object Permissions

For each custom object found in `force-app/main/default/objects/`, the permission set grants:

| Permission       | Value  |
|------------------|--------|
| allowCreate      | `true` |
| allowRead        | `true` |
| allowEdit        | `true` |
| allowDelete      | `true` |
| viewAllRecords   | `true` |
| modifyAllRecords | `true` |

### Field Permissions

For each field on the objects:

| Permission | Value                                   |
|------------|-----------------------------------------|
| readable   | `true`                                  |
| editable   | `true` (unless non-editable field type) |

## What's Excluded

The command intelligently filters out metadata that should not be included:

### Excluded Objects

| Object Type                     | Reason                                            |
|---------------------------------|---------------------------------------------------|
| Platform Events (`__e`)         | Cannot have CRUD permissions                      |
| Custom Metadata Types (`__mdt`) | Managed separately, no record-level access        |
| PersonAccount                   | Synthetic object, permissions managed via Account |

### Excluded Fields

| Field Type                 | Reason                               |
|----------------------------|--------------------------------------|
| Formula fields             | Read-only by definition              |
| AutoNumber fields          | System-generated, read-only          |
| Roll-Up Summary fields     | Calculated, read-only                |
| MasterDetail relationships | Controlled by parent record          |
| Required fields            | Already accessible by default        |
| OwnerId                    | System field                         |
| Name                       | Standard field with special handling |

## Example Output

```xml
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
  <label>ObjectRightsModifyAll</label>
  <hasActivationRequired>false</hasActivationRequired>
  <objectPermissions>
    <allowCreate>true</allowCreate>
    <allowDelete>true</allowDelete>
    <allowEdit>true</allowEdit>
    <allowRead>true</allowRead>
    <modifyAllRecords>true</modifyAllRecords>
    <object>Account__c</object>
    <viewAllRecords>true</viewAllRecords>
  </objectPermissions>
  <fieldPermissions>
    <editable>true</editable>
    <field>Account__c.Description__c</field>
    <readable>true</readable>
  </fieldPermissions>
</PermissionSet>
```

## See Also

- [Salesforce Permission Sets Documentation](https://help.salesforce.com/s/articleView?id=sf.perm_sets_overview.htm)
- [hardis:project:convert:profilestopermsets](../convert/profilestopermsets.md) - Convert profiles to permission sets
