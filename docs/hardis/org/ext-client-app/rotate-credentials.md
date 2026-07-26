<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:ext-client-app:rotate-credentials

## Description


## Command Behavior

**Rotates the OAuth consumer key and secret of an External Client App directly in a Salesforce org, without relying on local metadata.**

This command drives the Connect REST OAuth Credentials API to generate a brand new consumer key and secret for an External Client App, then promotes them so they become the active credentials. The new values are printed once, copy-pastable, and are hidden from log files so they can be safely stored in CI/CD variables.

Key functionalities:

- **Live Org Source:** Reads the list of External Client Apps and their consumers straight from the org through the OAuth Usage and OAuth Credentials REST APIs. Nothing is read from or written to local metadata files.
- **App and Consumer Selection:** Lists External Client Apps from the org and lets you pick one interactively. When an app has more than one consumer, you choose which credential to rotate.
- **Staged Credential Safety Check:** Salesforce allows only one staged credential per consumer. If one already exists, the command warns and offers to delete it before staging the new credentials.
- **Rotation:** Stages new credentials, then issues the `rotate` command so they become the active set. By default the previous credentials stay valid for 30 days before Salesforce removes them automatically, so running integrations keep working while you update them.
- **Immediate Revocation (Optional):** Pass `--revoke-previous` (or answer the prompt) to delete the previous credentials right after rotation, with no 30-day overlap. Use this for security incidents (e.g. a leaked secret): any integration still using the old credentials will break immediately.
- **Secure Output:** Both the new consumer key and secret are displayed with copy buttons in the VS Code UI and shown as obfuscated lines in log files, exactly like the CI/CD secrets produced by [hardis:project:configure:auth](https://sfdx-hardis.cloudity.com/hardis/project/configure/auth/).

> **Prerequisite:** "Allow access to External Client App consumer secrets via REST API" must be enabled in External Client App Settings, and the running user needs the **External Client App Developer** and **View Client Secret** permissions.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical flow involves:

- **App Discovery:** Calls `GET /services/data/vXX.0/apps/oauth/usage` to list External Client Apps and resolve the app identifier from its developer name.
- **Consumer Discovery:** Calls `GET /apps/oauth/credentials/{appId}` to list the consumers of the selected app.
- **Staged Check:** Calls `GET /apps/oauth/credentials/{appId}/{consumerId}/staged` to detect an existing staged credential, and `DELETE` on the same resource to clear it when requested.
- **Staging:** Calls `POST /apps/oauth/credentials/{appId}/{consumerId}/staged`, which returns the brand new `key` and `secret`.
- **Rotation:** Calls `PATCH /apps/oauth/credentials/{appId}/{consumerId}/staged/{stagedId}` with body `{ "command": "rotate" }` to promote the staged credentials to the active set.
- **Immediate Revocation:** With `--revoke-previous`, after rotation the former credentials occupy the staged slot in `rotated` state; the command reads them with a `GET .../staged` and issues a `DELETE` to revoke them immediately.
- **Output Handling:** Uses `uxLog(..., true)` so secrets are replaced by an obfuscated line in log files, and wraps values with `<copy>` tags when the VS Code UI is available.
- **JSON Output:** `--json` returns the app name, the new consumer key, and `rotated: true`. The secret is never included in the JSON output.

</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:ext-client-app:rotate-credentials --agent --name MyExternalClientApp --target-org myorg@example.com
```

In agent mode:

- `--name` (External Client App developer name) is required, since the app cannot be selected interactively.
- When the app has multiple consumers, `--consumer-key` is required to pick one.
- An existing staged credential is deleted automatically instead of prompting.
- The previous credentials are revoked immediately only when `--revoke-previous` is passed; otherwise the 30-day overlap is kept and the revocation prompt is skipped.
- The new secret is not returned in the `--json` output; capture it from an interactive run instead.


## Parameters

| Name              |  Type   | Description                                                                                                                                                                                         | Default | Required | Options |
|:------------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                                                                                                                                               |         |          |         |
| consumer-key      | option  | Consumer key of the credential to rotate, used when the app has more than one consumer (required in CI or agent mode in that case).                                                                 |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                                                                                                                     |         |          |         |
| flags-dir         | option  | undefined                                                                                                                                                                                           |         |          |         |
| json              | boolean | Format output as json.                                                                                                                                                                              |         |          |         |
| name<br/>-n       | option  | Developer name of the External Client App to rotate. Required in CI or agent mode.                                                                                                                  |         |          |         |
| revoke-previous   | boolean | Immediately revoke the previous credentials after rotation instead of keeping the 30-day overlap. Use for security (e.g. a leaked secret): integrations still using the old credentials will break. |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                                                                                                       |         |          |         |
| target-org<br/>-o | option  | undefined                                                                                                                                                                                           |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                           |         |          |         |

## Examples

```shell
$ sf hardis:org:ext-client-app:rotate-credentials
```

```shell
$ sf hardis:org:ext-client-app:rotate-credentials --name MyExternalClientApp
```

```shell
$ sf hardis:org:ext-client-app:rotate-credentials --revoke-previous --name MyExternalClientApp
```

```shell
$ sf hardis:org:ext-client-app:rotate-credentials --agent --name MyExternalClientApp --target-org myorg@example.com
```


