<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:mdapi:read

## Description


## Command Behavior

**Retrieves metadata from an org using the CRUD-based Metadata API (`readMetadata`), writing complete source files.**

This is a standalone, manually invoked alternative to the file-based retrieve (`sf hardis:org:retrieve:sources:metadata`). It exists for metadata types that file-based retrieve returns **incomplete** when source tracking is not used, most notably `Profile` and `PermissionSet`: `readMetadata` returns the whole component (every object/field permission, Apex-class access, tab visibility), not just the parts tied to other components in the same package.

Key functionalities:

- **Component selection:** Choose what to read with `--metadata` (e.g. `Profile:Admin`, or a bare type like `Profile` to read every component of that type), `--manifest` (a `package.xml`), or `--source-dir` (refresh the types/names already present in a local folder).
- **Complete components:** Each component is read whole and written to standard source format, so a `git diff` shows exactly what file-based retrieve had been dropping.
- **Chunking:** Reads are batched to respect the CRUD Metadata API limit (10 components per call, 200 for `CustomMetadata` and `CustomApplication`).
- **Supported types are adapter-gated:** Compatibility is decided by the metadata type's @salesforce/source-deploy-retrieve registry adapter (`strategies.adapter`). Only pure-XML types round-trip through the CRUD Metadata API; types whose source carries non-XML content (code, binaries, multi-file bundles) are reported as skipped with a warning. The incompatible adapters are `bundle` (LWC, Aura), `matchingContentFile` (Apex classes/triggers/pages/components, Visualforce), `mixedContent` (`StaticResource`, `Document`), and `digitalExperience` (`DigitalExperienceBundle`). Retrieve those with file-based retrieve (`sf project retrieve start`).

The write counterpart is `sf hardis:mdapi:upsert`.

<details markdown="1">
<summary>Technical explanations</summary>

- **Input resolution:** `ComponentSetBuilder` resolves `--metadata` / `--manifest` / `--source-dir`. Bare types and wildcards are expanded against the org via `listMetadata`.
- **Read:** Components are grouped by type, chunked, and read with jsforce `connection.metadata.read`.
- **Conversion:** Read results are serialized to metadata-format XML (`fast-xml-parser`), then converted to source format with `@salesforce/source-deploy-retrieve`'s public converter, which handles per-type decomposition (e.g. CustomObject into `fields/` and `recordTypes/`).
- **Adapter rule:** `partitionCrudCompatibility` resolves each type to its SDR adapter via `RegistryAccess.getTypeByName(name).strategies.adapter`. Types with adapter `bundle`, `matchingContentFile`, `mixedContent`, or `digitalExperience` are set aside as skipped; types with `decomposed`, `default`, or no adapter (e.g. `CustomObject`, `Profile`, `PermissionSet`, `Layout`, `CustomMetadata`, `CustomApplication`) are processed. Unknown type names are treated as compatible so the API call (not the guard) surfaces the real error.
- **Limitations:** Folder-based types (Report, Dashboard, EmailTemplate) require explicit `Folder/Name` members; bare-type expansion does not enumerate folders yet.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:mdapi:read --metadata Profile,PermissionSet --agent
```

In agent mode (and in CI), interactive prompts are skipped. You must pass at least one of `--metadata`, `--manifest`, or `--source-dir`; the command never prompts for what to read.


## Parameters

| Name              |  Type   | Description                                                                                                                                                                                            | Default | Required | Options |
|:------------------|:-------:|:-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                                                                                                                                                  |         |          |         |
| chunk-size        | option  | Components read per API call (max 10, or 200 for CustomMetadata/CustomApplication)                                                                                                                     |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                                                                                                                        |         |          |         |
| flags-dir         | option  | undefined                                                                                                                                                                                              |         |          |         |
| ignore-errors     | boolean | Report component failures but exit with code 0                                                                                                                                                         |         |          |         |
| json              | boolean | Format output as json.                                                                                                                                                                                 |         |          |         |
| manifest<br/>-x   | option  | Path to a package.xml listing the metadata to read                                                                                                                                                     |         |          |         |
| metadata<br/>-m   | option  | Metadata to read, as Type or Type:Name (e.g. Profile, "Profile:Admin"). Repeatable.                                                                                                                    |         |          |         |
| output-dir        | option  | Directory where source files are written. When set, all files are written here instead of being refreshed in place in the project package directories (default: the project default package directory) |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                                                                                                          |         |          |         |
| source-dir        | option  | Local source path whose components should be re-read from the org                                                                                                                                      |         |          |         |
| target-org<br/>-o | option  | undefined                                                                                                                                                                                              |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                              |         |          |         |

## Examples

```shell
$ sf hardis:mdapi:read --metadata Profile
```

```shell
$ sf hardis:mdapi:read --source-dir force-app/main/default/profiles
```

```shell
$ sf hardis:mdapi:read --metadata "Profile:Admin" --metadata PermissionSet
```

```shell
$ sf hardis:mdapi:read --manifest manifest/package.xml
```

```shell
$ sf hardis:mdapi:read --metadata Profile,PermissionSet --agent
```


