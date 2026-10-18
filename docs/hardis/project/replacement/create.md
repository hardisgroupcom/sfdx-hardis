<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:replacement:create

## Description


## Command Behavior

**Adds a replacement rule: a change applied to the metadata files right before each deployment, for the org the deployment goes to.**

A rule does one of three things:

- `xml-value`: writes the target org's value in an XML element, whatever git holds (for example the endpoint of a Named Credential).
- `xml-remove`: removes an XML element before deploying (for example one user permission of a Profile: `Profile/userPermissions[name=ViewSetup]`).
- `text`: finds and replaces a text or a regular expression in any file (Apex, LWC, JSON...).

Its value is the same for every org (`--value`), one per target branch with a `default` (`--value-for uat=... --value-for default=...`), or a secret read from a CI/CD variable (`--secret NAME`: NAME_<BRANCH> is read first, then NAME). Secret values are never written anywhere and are masked in every log.

The rule is stored in one place:

- `project`: `config/.sfdx-hardis.yml`
- `branch`: `config/branches/.sfdx-hardis.<branch>.yml`, applied only when deploying to that branch
- `issue`: the "sfdx-hardis Replacement Rules" issue of the git provider (work item on Azure DevOps, Pull Request on Bitbucket), applied at the next deployment job without any commit. It is read only when its author has write access to the repository, and its rules cannot use `secret`

See [Replacement rules](https://sfdx-hardis.cloudity.com/salesforce-devops-config-replacement-rules/) for the full reference.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:replacement:create --agent --layer project --id payment-api-endpoint --type xml-value --files "**/namedCredentials/Payment_API.namedCredential-meta.xml" --xml-path NamedCredential/endpoint --value-for main=https://pay.example.com --value-for default=https://pay-sandbox.example.com
```

Required in agent mode: `--layer` (and `--branch` with `--layer branch`), then either `--rule-file` / `--rule` (whole rule as JSON) or the field flags with at least `--id`, `--type` and `--files`. Every prompt is skipped.

<details markdown="1">
<summary>Technical explanations</summary>

- Project and branch rules are written under the `replacementRules` key with `js-yaml`, keeping every other key.
- Issue rules are the YAML block of the issue body (`getDashboardBody` / `updateDashboardBody` of the git provider); the issue is created when missing.
- The rule is validated before being written (`validateReplacementRule`): an id already used in the same place is refused, use `hardis:project:replacement:update`.
</details>


## Parameters

| Name             |  Type   | Description                                                                                                                                                                   | Default | Required |              Options              |
|:-----------------|:-------:|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:---------------------------------:|
| agent            | boolean | Run in non-interactive mode for agents and automation                                                                                                                         |         |          |                                   |
| branch           | option  | Major branch of the branch config file, with --layer branch                                                                                                                   |         |          |                                   |
| debug<br/>-d     | boolean | Activate debug mode (more logs)                                                                                                                                               |         |          |                                   |
| description      | option  | Description shown in logs and Pull Request comments                                                                                                                           |         |          |                                   |
| enabled          | option  | Turn the rule on or off (also works for a built-in rule)                                                                                                                      |         |          |          true<br/>false           |
| exclude-branches | option  | Comma-separated target branches the rule does not apply to. Empty value removes the filter                                                                                    |         |          |                                   |
| files            | option  | Glob of the files the rule applies to, from the repository root (can be repeated)                                                                                             |         |          |                                   |
| find             | option  | Text or regular expression to find, with --type text                                                                                                                          |         |          |                                   |
| flags-dir        | option  | Import flag values from a directory.                                                                                                                                          |         |          |                                   |
| id               | option  | Id of the rule: lowercase letters, digits and "-"                                                                                                                             |         |          |                                   |
| include-branches | option  | Comma-separated target branches the rule applies to (dev-sandboxes for any other org). Empty value removes the filter                                                         |         |          |                                   |
| json             | boolean | Format output as json.                                                                                                                                                        |         |          |                                   |
| layer            | option  | Where the rule is stored: project (config/.sfdx-hardis.yml), branch (config/branches/.sfdx-hardis.<branch>.yml) or issue (git provider issue, no commit needed)               |         |          |   project<br/>branch<br/>issue    |
| regex            | boolean | --find is a regular expression                                                                                                                                                |         |          |                                   |
| required         | boolean | Warn in the Pull Request comment when the files are deployed but nothing matches                                                                                              |         |          |                                   |
| rule             | option  | Whole rule as JSON, instead of the field flags                                                                                                                                |         |          |                                   |
| rule-file        | option  | Path of a JSON file holding the whole rule, instead of the field flags                                                                                                        |         |          |                                   |
| secret           | option  | Name of the CI/CD variable holding the value (NAME_<BRANCH> is read first, then NAME). Never a value                                                                          |         |          |                                   |
| type             | option  | xml-value (set an XML element), xml-remove (remove an XML element) or text (find and replace)                                                                                 |         |          | xml-value<br/>xml-remove<br/>text |
| value            | option  | Same value for every org                                                                                                                                                      |         |          |                                   |
| value-for        | option  | Value for one target, as <branch>=<value> or default=<value> (can be repeated). An empty value removes it                                                                     |         |          |                                   |
| websocket        | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                     |         |          |                                   |
| xml-path         | option  | Element path, for example NamedCredential/endpoint, Workflow/alerts[fullName=MyAlert]/senderAddress, or Profile/userPermissions[name=ViewSetup] to remove one user permission |         |          |                                   |

## Examples

```shell
$ sf hardis:project:replacement:create
```

```shell
$ sf hardis:project:replacement:create --agent --layer project --id payment-api-endpoint --type xml-value --files "**/namedCredentials/Payment_API.namedCredential-meta.xml" --xml-path NamedCredential/endpoint --value-for main=https://pay.example.com --value-for default=https://pay-sandbox.example.com
```

```shell
$ sf hardis:project:replacement:create --agent --layer project --id payment-api-password --type xml-value --files "**/namedCredentials/Payment_API.namedCredential-meta.xml" --xml-path NamedCredential/password --secret PAYMENT_API_PASSWORD
```

```shell
$ sf hardis:project:replacement:create --agent --layer project --id remove-view-setup-in-production --type xml-remove --files "**/profiles/*.profile-meta.xml" --xml-path "Profile/userPermissions[name=ViewSetup]" --include-branches main
```

```shell
$ sf hardis:project:replacement:create --agent --layer branch --branch uat --id uat-hide-case-actions --type xml-remove --files "**/layouts/Case-*.layout-meta.xml" --xml-path Layout/platformActionList
```

```shell
$ sf hardis:project:replacement:create --agent --layer issue --rule-file ./rule.json
```


