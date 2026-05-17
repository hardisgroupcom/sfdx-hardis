<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:packagexml:remove-managed

## Description


## Command Behavior

**Removes all managed package items from a `package.xml` file, while preserving custom metadata created on top of managed objects.**

Managed items - those whose API name starts with a namespace prefix (e.g. `SBQQ__Quote__c`, `nCino__Loan__c`) - are automatically excluded from deployments that target orgs where the managed package is already installed. Keeping them in a `package.xml` causes unnecessary noise and can block deployments.

Key functionalities:

- **Namespace detection:**
  - `--namespaces` flag - explicit comma-separated list (e.g. `SBQQ,nCino`). When provided, `--namespace-detection` is ignored.
  - When `--namespaces` is omitted, `--namespace-detection` selects the auto-detection strategy:
    - `api-name` *(default)* - scans every member name for the `NS__Name__suffix` pattern (three or more double-underscore segments) and extracts the leading prefix as a namespace.
    - `installed-packages` - reads the `InstalledPackage` entries already present in the `package.xml`.
- **Smart child-item preservation:** For metadata that lives under a managed object (e.g. a `CustomField` or `ValidationRule`), the member is removed **only** if the child part of the API name is itself namespaced. A custom field such as `SBQQ__Quote__c.My_Status__c` is therefore kept, while `SBQQ__Quote__c.SBQQ__Status__c` is removed.
- **Output file:** By default the result is written to `<input>-without-managed.xml` (e.g. `package-without-managed.xml`). Use `--outputfile` to choose a different path.
- **Summary report:** Logs the number of removed items per metadata type. Use `--debug` for a full itemised list.

<details markdown="1">
<summary>Technical explanations</summary>

- **Parsing:** Uses `parsePackageXmlFile` to load the manifest into a flat `{ TypeName: string[] }` dictionary.
- **Namespace resolution:** `--namespaces` flag takes priority. When absent, `--namespace-detection` selects the strategy: `api-name` scans member API names for the `NS__Name__suffix` pattern (≥ 3 segments when split by `__`, first segment validated against `/^[A-Za-z][A-Za-z0-9]{0,14}$/`); `installed-packages` reads `InstalledPackage` type members from the manifest.
- **Filtering rule:**
  - A member is removed when it starts with `<namespace>__` (top-level item) **or** when its child part (the segment after `.`) also starts with `<namespace>__` (namespaced sub-item).
  - A member whose object is managed but whose child is *not* namespaced is retained (e.g. a developer-created custom field on a managed object).
- **Output:** The filtered manifest is written with `writePackageXmlFile` to `<input>-without-managed.xml` by default.
- **Empty types:** Metadata types that have no remaining members after filtering are removed from the manifest.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:packagexml:remove-managed --packagexml manifest/package.xml --namespaces SBQQ,nCino --agent
```

In agent mode all interactive prompts are skipped and default values are used.
The command is fully non-interactive regardless of this flag.


## Parameters

| Name                |  Type   | Description                                                                                                                                                                                                                        |   Default   | Required |             Options             |
|:--------------------|:-------:|:-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-----------:|:--------:|:-------------------------------:|
| agent               | boolean | Run in non-interactive mode for agents and automation                                                                                                                                                                              |             |          |                                 |
| debug<br/>-d        | boolean | debug                                                                                                                                                                                                                              |             |          |                                 |
| flags-dir           | option  | undefined                                                                                                                                                                                                                          |             |          |                                 |
| json                | boolean | Format output as json.                                                                                                                                                                                                             |             |          |                                 |
| namespace-detection | option  | Auto-detection strategy used when --namespaces is not provided. "api-name" (default) infers namespaces from member API name patterns (NS__Name__suffix). "installed-packages" reads InstalledPackage entries from the package.xml. |  api-name   |          | api-name<br/>installed-packages |
| namespaces<br/>-n   | option  | Comma-separated list of namespace prefixes to remove (e.g. SBQQ,cpq). When provided, --namespace-detection is ignored.                                                                                                             |             |          |                                 |
| outputfile<br/>-o   | option  | Output package.xml file path. Defaults to <input>-without-managed.xml (e.g. package-without-managed.xml).                                                                                                                          |             |          |                                 |
| packagexml<br/>-p   | option  | Path to the package.xml file to filter                                                                                                                                                                                             | package.xml |          |                                 |
| websocket           | option  | websocket                                                                                                                                                                                                                          |             |          |                                 |

## Examples

```shell
$ sf hardis:packagexml:remove-managed
```

```shell
$ sf hardis:packagexml:remove-managed --packagexml manifest/package.xml --namespaces SBQQ,cpq
```

```shell
$ sf hardis:packagexml:remove-managed -p package.xml -n SBQQ --outputfile package-no-managed.xml
```

```shell
$ sf hardis:packagexml:remove-managed --namespace-detection installed-packages
```

```shell
$ sf hardis:packagexml:remove-managed --agent
```


