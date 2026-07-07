<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doctor

## Description


## Command Behavior

**Collects your local sfdx-hardis install info and helps you open a pre-filled GitHub issue.**

This command gathers everything a maintainer usually asks for when investigating a bug, then prints it as a ready-to-paste report and offers to open the sfdx-hardis "New issue" page with the report already filled in.

Key functionalities:

- **Install info gathering:** sfdx-hardis version, Salesforce CLI version, Node.js version, OS, shell, language and the full list of installed SF CLI plugins with their versions.
- **Latest version check:** Queries npm for the latest published versions and flags any outdated component (shown as `(latest: x.y.z)` in the report). If anything is outdated, it warns you to upgrade first, in case the issue is already fixed in a newer version. Disable with `--skip-version-check`.
- **VS Code extension detection:** When the command runs inside VS Code with the sfdx-hardis extension linked, the extension version is added to the report.
- **CI detection:** Detects whether it runs in a CI environment and which provider.
- **Pre-filled GitHub issue:** Builds the "New issue" URL of the sfdx-hardis repository with the report pre-filled in the body, and (interactively) opens it in your browser.

The report is always printed in your terminal, so you can copy it manually if the browser page is not enough.

<details markdown="1">
<summary>Technical explanations</summary>

- **oclif Config:** Install info is read from the oclif `Config` object (`config.version`, `config.shell`, `config.plugins`), so no shell command is executed to list plugins.
- **Node & OS:** Node version comes from `process.version`; OS details come from the Node.js `os` module.
- **VS Code extension version:** Requested over the existing WebSocket connection (`getExtensionVersion` event). The extension answers with its version; the request times out gracefully after a few seconds and reports "not available" if no compatible extension is linked.
- **Issue URL:** Built as `https://github.com/hardisgroupcom/sfdx-hardis/issues/new` with `title` and `body` query parameters. If the encoded URL would exceed the browser limit, the plugin list is trimmed from the URL body (the full report stays in the terminal).
- **Browser:** Uses the `open` package to launch the default browser after user confirmation.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:doctor --agent
```

In agent mode (or in CI):
- The install info report and the GitHub issue URL are printed.
- No prompt is displayed and the browser is never opened.


## Parameters

| Name               |  Type   | Description                                                      | Default | Required | Options |
|:-------------------|:-------:|:-----------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent              | boolean | Run in non-interactive mode for agents and automation            |         |          |         |
| debug<br/>-d       | boolean | Activate debug mode (more logs)                                  |         |          |         |
| flags-dir          | option  | undefined                                                        |         |          |         |
| json               | boolean | Format output as json.                                           |         |          |         |
| open<br/>-o        | boolean | Open the GitHub new issue page directly without prompting        |         |          |         |
| skip-version-check | boolean | Do not query npm for the latest versions (faster, works offline) |         |          |         |
| skipauth           | boolean | Skip authentication check when a default username is required    |         |          |         |
| websocket          | option  | Websocket host:port for VsCode SFDX Hardis UI integration        |         |          |         |

## Examples

```shell
$ sf hardis:doctor
```

```shell
$ sf hardis:doctor --agent
```


