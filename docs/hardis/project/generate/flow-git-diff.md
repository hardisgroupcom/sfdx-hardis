<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:generate:flow-git-diff

## Description

Generate Flow Visual Git Diff markdown between 2 commits

Note: This command might requires @mermaid-js/mermaid-cli to be installed.

Run `npm install @mermaid-js/mermaid-cli --global`

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:generate:flow-git-diff --agent --flow "force-app/main/default/flows/MyFlow.flow-meta.xml" --commit-before abc123 --commit-after def456
```

In agent mode:

- All interactive prompts for flow selection, commit-before, and commit-after are skipped.
- `--flow`, `--commit-before`, and `--commit-after` flags must be provided.
  

## Parameters

| Name          |  Type   | Description                                                                                 | Default | Required | Options |
|:--------------|:-------:|:--------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent         | boolean | Run in non-interactive mode for agents and automation                                       |         |          |         |
| commit-after  | option  | Hash of the commit of the new flow state (will be prompted if not set)                      |         |          |         |
| commit-before | option  | Hash of the commit of the previous flow state, or "allStates" (will be prompted if not set) |         |          |         |
| debug<br/>-d  | boolean | Activate debug mode (more logs)                                                             |         |          |         |
| flags-dir     | option  | undefined                                                                                   |         |          |         |
| flow          | option  | Path to flow file (will be prompted if not set)                                             |         |          |         |
| json          | boolean | Format output as json.                                                                      |         |          |         |
| skipauth      | boolean | Skip authentication check when a default username is required                               |         |          |         |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                   |         |          |         |

## Examples

```shell
$ sf hardis:project:generate:flow-git-diff
```

```shell
$ sf hardis:project:generate:flow-git-diff --flow "force-app/main/default/flows/Opportunity_AfterUpdate_Cloudity.flow-meta.xml" --commit-before 8bd290e914c9dbdde859dad7e3c399776160d704 --commit-after e0835251bef6e400fb91e42f3a31022f37840f65
```

```shell
$ sf hardis:project:generate:flow-git-diff --agent --flow "force-app/main/default/flows/MyFlow.flow-meta.xml" --commit-before abc123 --commit-after def456
```


