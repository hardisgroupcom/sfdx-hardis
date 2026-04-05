<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:purge:profile

## Description


## Command Behavior

**Removes or "mutes" Permission Sets attributes from selected Salesforce Profile metadata files and redeploys the cleaned profiles to the target org.**

This command is intended to safely remove PS attributes from Profiles after a migration from Profile-based to PS-based permission management. It:

- Builds or reuses a full org manifest to determine metadata present in the org.
- Filters the manifest to remove selected managed package namespaces and keep only relevant metadata types required for profile processing.
- Retrieves the necessary metadata (profiles, objects, fields, classes) into the local project.
- Iterates over selected profile files and mutes configured attributes (for example: classAccesses.enabled, fieldPermissions.readable/editable, objectPermissions.* and userPermissions.enabled).
- Resets record type visibilities on purged objects: assigns the Master record type as default and visible, and unchecks all other record types.
- Resets application visibilities: keeps only the default app visible, and sets all others to not visible.
- Writes the modified profile XML files back to the repository
- Deploys the updated profiles to the target org.

The command checks for uncommitted changes and will not run if the working tree has modifications, and it allows reusing a previously generated full org manifest to speed up repeated runs.

<details markdown="1">
<summary>Technical explanations</summary>

- **Manifest generation:** Uses 'buildOrgManifest' to create a full org 'package.xml'. If an existing manifest file is available the user can choose to reuse it.
- **Namespace filtering:** Queries installed packages using 'MetadataUtils.listInstalledPackages' to propose namespaces to remove from the manifest.
- **Metadata filtering:** Keeps only metadata types required to safely mute profiles (Profile plus the package types configured in the command).
- **Profile processing:** Parses profile XML files, iterates nodes ('classAccesses', 'fieldPermissions', 'objectPermissions', 'userPermissions') and sets attributes to configured mute values, skipping configured excluded names/files.
- **Retrieval & Deployment:** Uses the Salesforce CLI ('sf project retrieve' / 'sf project deploy') via 'execCommand' to retrieve metadata and deploy the updated profiles.
- **Exit behavior:** Returns an object with 'orgId' and an 'outputString'. Errors are logged to the console and do not throw uncaught exceptions within the command.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|outputfile<br/>-f|option|Force the path and name of output report file. Must end with .csv||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
sf hardis:org:purge:profile
```

```shell
sf hardis:org:purge:profile --target-org my-org@example.com
```


