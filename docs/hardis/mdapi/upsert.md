<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:mdapi:upsert

## Description


## Command Behavior

**Deploys local source files to an org using the CRUD-based Metadata API (`upsertMetadata`), pushing each component whole.**

This is a standalone, manually invoked command. It is the mirror of `sf hardis:mdapi:read` and exists for the same reason: types like `Profile` and `PermissionSet` deploy **completely** this way. File-based deploy of a Profile only writes permissions for components present in the same deployment; `upsertMetadata` writes the whole Profile.

> **Warning - whole-component overwrite.** `upsertMetadata` replaces each component entirely. Any object/field permission, Apex-class access, or tab visibility that is **not** in your local file is **removed** in the org. A stale or partial local file will strip permissions. There is no check-only / validation mode for the CRUD Metadata API.

This command is **not** part of the CI/CD pipeline and runs **no** Apex tests, **no** check-only validation, **no** quick deploy, and **no** coverage gate. Use `sf hardis:project:deploy:smart` for gated deployments.

Key functionalities:

- **Component selection:** `--source-dir` (default: the project package directories), `--manifest` (a `package.xml`), or `--metadata` to filter.
- **Confirmation:** In interactive mode it lists the components that will be overwritten whole and asks for confirmation before pushing.
- **Chunking:** Upserts are batched to respect the CRUD Metadata API limit (10 components per call, 200 for `CustomMetadata` and `CustomApplication`).
- **Supported types are adapter-gated:** Compatibility is decided by the metadata type's @salesforce/source-deploy-retrieve registry adapter (`strategies.adapter`). Only pure-XML types are upserted through the CRUD Metadata API; types whose source carries non-XML content (code, binaries, multi-file bundles) are reported as skipped with a warning. The incompatible adapters are `bundle` (LWC, Aura), `matchingContentFile` (Apex classes/triggers/pages/components, Visualforce), `mixedContent` (`StaticResource`, `Document`), and `digitalExperience` (`DigitalExperienceBundle`). Deploy those with file-based deploy (`sf project deploy start`).

<details markdown="1">
<summary>Technical explanations</summary>

- **Input resolution:** `ComponentSetBuilder` resolves `--source-dir` / `--manifest` / `--metadata` from local source.
- **Recomposition:** Source is converted to metadata format with `@salesforce/source-deploy-retrieve` (recomposing decomposed types such as CustomObject into a single file), then each top-level component is upserted with jsforce `connection.metadata.upsert`.
- **Granularity:** Components are upserted at the top-level-type granularity; child types (e.g. RecordType) are deployed inside their parent component.
- **Adapter rule:** `partitionCrudCompatibility` resolves each type to its SDR adapter via `RegistryAccess.getTypeByName(name).strategies.adapter`. Types with adapter `bundle`, `matchingContentFile`, `mixedContent`, or `digitalExperience` are set aside as skipped (and re-checked before sending); types with `decomposed`, `default`, or no adapter (e.g. `CustomObject`, `Profile`, `PermissionSet`, `Layout`, `CustomMetadata`, `CustomApplication`) are processed. Unknown type names are treated as compatible so the API call (not the guard) surfaces the real error.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:mdapi:upsert --source-dir force-app/main/default/profiles --agent
```

In agent mode (and in CI), the overwrite confirmation prompt is skipped and the deployment proceeds. The caller owns the risk of the whole-component overwrite.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|chunk-size|option|Components upserted per API call (max 10, or 200 for CustomMetadata/CustomApplication)||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|ignore-errors|boolean|Report component failures but exit with code 0||||
|json|boolean|Format output as json.||||
|manifest<br/>-x|option|Path to a package.xml listing the metadata to deploy||||
|metadata<br/>-m|option|Metadata to deploy, as Type or Type:Name (e.g. Profile, "Profile:Admin"). Repeatable.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|source-dir|option|Local source path to deploy (default: the project package directories)||||
|target-org<br/>-o|option|undefined||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:mdapi:upsert --metadata Profile
```

```shell
$ sf hardis:mdapi:upsert --source-dir force-app/main/default/profiles
```

```shell
$ sf hardis:mdapi:upsert --manifest manifest/package.xml
```

```shell
$ sf hardis:mdapi:upsert --source-dir force-app/main/default/profiles --agent
```


