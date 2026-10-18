<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:replacement:update

## Description


## Command Behavior

**Changes a replacement rule in one place (project config, branch config file or git provider issue).**

- With `--rule-file` or `--rule`, the rule stored in that place is replaced by the given one.
- With field flags, only those fields change. Setting one value source (`--value`, `--value-for`, `--secret`) removes the other ones; `--value-for uat=` removes the value of one target; `--unset <field>` removes a field.
- When the rule is not stored in that place yet, an override is created there: it changes only the given fields of the rule defined in a lower place. Places merge in this order: built-in rules, project, branch file of the target, issue.
- Built-in rules (ids starting with `builtin-`) can only be turned on or off: `--id builtin-flow-ends --enabled false`.

See [Replacement rules](https://sfdx-hardis.cloudity.com/salesforce-devops-config-replacement-rules/) for the full reference.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:replacement:update --agent --layer issue --id partner-site-admin --value-for preprod=site.admin@example.com.preprod
sf hardis:project:replacement:update --agent --layer project --id builtin-flow-schedule-day-of-month --enabled false
```

Required in agent mode: `--layer` (and `--branch` with `--layer branch`), `--id`, and `--rule-file` / `--rule` or at least one field flag. Every prompt is skipped.

<details markdown="1">
<summary>Technical explanations</summary>

- A full rule (one with a `type`) is validated before being written; an override must target a rule that exists in another place or in the built-in list.
- Project and branch rules are written with `js-yaml`, keeping every other key; issue rules are the YAML block of the issue body.
</details>


## Parameters

| Name             |  Type   | Description                                                                                                                                                     | Default | Required |              Options              |
|:-----------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:---------------------------------:|
| agent            | boolean | Run in non-interactive mode for agents and automation                                                                                                           |         |          |                                   |
| branch           | option  | Major branch of the branch config file, with --layer branch                                                                                                     |         |          |                                   |
| debug<br/>-d     | boolean | Activate debug mode (more logs)                                                                                                                                 |         |          |                                   |
| description      | option  | Description shown in logs and Pull Request comments                                                                                                             |         |          |                                   |
| enabled          | option  | Turn the rule on or off (also works for a built-in rule)                                                                                                        |         |          |          true<br/>false           |
| exclude-branches | option  | Comma-separated target branches the rule does not apply to. Empty value removes the filter                                                                      |         |          |                                   |
| files            | option  | Glob of the files the rule applies to, from the repository root (can be repeated)                                                                               |         |          |                                   |
| find             | option  | Text or regular expression to find, with --type text                                                                                                            |         |          |                                   |
| flags-dir        | option  | Import flag values from a directory.                                                                                                                            |         |          |                                   |
| id               | option  | Id of the rule to change                                                                                                                                        |         |          |                                   |
| include-branches | option  | Comma-separated target branches the rule applies to (dev-sandboxes for any other org). Empty value removes the filter                                           |         |          |                                   |
| json             | boolean | Format output as json.                                                                                                                                          |         |          |                                   |
| layer            | option  | Where the rule is stored: project (config/.sfdx-hardis.yml), branch (config/branches/.sfdx-hardis.<branch>.yml) or issue (git provider issue, no commit needed) |         |          |   project<br/>branch<br/>issue    |
| regex            | boolean | --find is a regular expression                                                                                                                                  |         |          |                                   |
| required         | boolean | Warn in the Pull Request comment when the files are deployed but nothing matches                                                                                |         |          |                                   |
| rule             | option  | Whole rule as JSON, instead of the field flags                                                                                                                  |         |          |                                   |
| rule-file        | option  | Path of a JSON file holding the whole rule, instead of the field flags                                                                                          |         |          |                                   |
| secret           | option  | Name of the CI/CD variable holding the value (NAME_<BRANCH> is read first, then NAME). Never a value                                                            |         |          |                                   |
| type             | option  | xml-value (set an XML element), xml-remove (remove an XML element) or text (find and replace)                                                                   |         |          | xml-value<br/>xml-remove<br/>text |
| unset            | option  | Field to remove from the stored rule (can be repeated), for example includeTargetBranches                                                                       |         |          |                                   |
| value            | option  | Same value for every org                                                                                                                                        |         |          |                                   |
| value-for        | option  | Value for one target, as <branch>=<value> or default=<value> (can be repeated). An empty value removes it                                                       |         |          |                                   |
| websocket        | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                       |         |          |                                   |
| xml-path         | option  | Element path, for example NamedCredential/endpoint or Workflow/alerts[fullName=MyAlert]/senderAddress                                                           |         |          |                                   |

## Examples

```shell
$ sf hardis:project:replacement:update
```

```shell
$ sf hardis:project:replacement:update --agent --layer project --id payment-api-endpoint --value-for preprod=https://pay-staging.example.com
```

```shell
$ sf hardis:project:replacement:update --agent --layer issue --id payment-api-endpoint --enabled false
```

```shell
$ sf hardis:project:replacement:update --agent --layer project --id builtin-flow-ends --enabled false
```

```shell
$ sf hardis:project:replacement:update --agent --layer project --id payment-api-endpoint --rule-file ./rule.json
```


