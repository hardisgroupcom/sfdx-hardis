<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:list:metadata

## Description


## Command Behavior

**Lists the metadata components of one type in an org, for scripts, agents and user interfaces.**

- **Any listable type:** Pass `--type` with a Metadata API type (ApexClass, Flow, CustomField, Layout...). The result holds the API name (`fullName`) and the Id of each component, sorted by name.
- **Folder types in two steps:** For Report, Dashboard, Document and EmailTemplate, `--type` alone lists the folders. Pass `--folder` to list the content of one folder, named `Folder/Name`.
- **Cached per org:** The listing is kept 30 days per org Id, and shared with [hardis:doc:metadata-deps](https://sfdx-hardis.cloudity.com/hardis/doc/metadata-deps/): a listing made by one command serves the other. Pass `--refresh` to list the org again.
- **Read-only:** Nothing is written in the org. A type the Metadata API cannot list (a Tooling-only type, a misspelled type) returns `listable: false` and no items instead of an error. Any other failure (expired session, network error, API limit) is an error.
- **Output:** Without `--json`, a table and a CSV/Excel report. With `--json`, only the JSON result: no table and no report file.

The VS Code extension uses it to suggest API names in the Metadata Dependencies panel.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:list:metadata --agent --type ApexClass --target-org myOrgAlias --json
```

The command has no prompt: `--type` is required, and `--agent` only confirms the non-interactive use. Pair it with `--json`.

<details markdown="1">
<summary>Technical explanations</summary>

- The components come from the Metadata API `listMetadata` call. The folder types are the types marked `inFolder` in the metadata registry. Their folders come from `ReportFolder`, `DashboardFolder`, `DocumentFolder`, and both `EmailFolder` (Classic) and `EmailTemplateFolder` (Lightning) for email templates. `unfiled$public` is always offered for Reports, email templates and Documents, because `listMetadata` never returns it. `--folder` is refused for a type without folders.
- Only the names and the Ids are cached, under `~/.sfdx/sfdx-hardis-cache/orgs/<orgId>/`. Flow listings are never cached, because activating another Flow version changes its Id. A failed listing is not cached either. `NO_CACHE` disables the cache, `sf hardis:cache:clear` empties it.
- The `--json` result is `{ type, folder, kind, items, listable, fromCache }`, where `kind` is `folders` or `components` and each item is `{ fullName, id }`.
</details>


## Parameters

| Name              |  Type   | Description                                                                                                  | Default | Required | Options |
|:------------------|:-------:|:-------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                                                        |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                              |         |          |         |
| flags-dir         | option  | Import flag values from a directory.                                                                         |         |          |         |
| folder            | option  | Folder to list, for Report, Dashboard, Document and EmailTemplate                                            |         |          |         |
| json              | boolean | Format output as json.                                                                                       |         |          |         |
| refresh           | boolean | List the org again instead of using the cached listing                                                       |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                |         |          |         |
| target-org<br/>-o | option  | Username or alias of the target org. Not required if the `target-org` configuration variable is already set. |         |   true   |         |
| type              | option  | Metadata API type to list (for example ApexClass, CustomField or Report)                                     |         |   true   |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                    |         |          |         |

## Examples

```shell
$ sf hardis:org:list:metadata --type ApexClass --json
```

```shell
$ sf hardis:org:list:metadata --type Report --json
```

```shell
$ sf hardis:org:list:metadata --type Report --folder SalesReports --json
```

```shell
$ sf hardis:org:list:metadata --agent --type CustomField --refresh --target-org myOrgAlias --json
```


