<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:pipeline:describe

## Description


## Command Behavior

**Describes the pipeline of the project: its major branches, the org behind each of them, and the steps a merge can follow from one major branch to the next.**

A pipeline is not always `integration -> uat -> preprod -> main`. A project can have several production orgs fed by a core branch, a run branch next to the build ones, or a single sandbox before production. This command reads what the project really declares, so a script or a coding agent never has to assume the names or the order of the branches.

The command:

- lists every major branch, which is every branch with a `config/branches/.sfdx-hardis.<branch>.yml` file, with its `instanceUrl` and `targetUsername`;
- reads the `mergeTargets` of each branch, the same way the [deployment jobs](https://sfdx-hardis.cloudity.com/salesforce-devops-smart-deployment/) do, and says when they are not declared and had to be guessed from the branch names;
- lists the steps of the pipeline, one for each source branch and merge target, and says whether a [promotion branch (Beta)](https://sfdx-hardis.cloudity.com/salesforce-devops-promotion-branches/) may be assembled on it;
- names the entry branches, that no other major branch is merged into, and the final branches, that are merged into no other one (ex: production);
- reports `developmentBranch`, `availableTargetBranches`, `enablePromotionBranches` and `allowedPromotionSteps`.

It only reads the configuration files of the current checkout: no org, no git provider and no network are needed, and nothing is written.

With `--json`, the result holds `developmentBranch`, `availableTargetBranches`, `branches` (`name`, `level`, `instanceUrl`, `targetUsername`, `mergeTargets`, `mergeTargetsGuessed`, `mergeSources`), `steps` (`source`, `target`, `promotionBranchAllowed`), `entryBranches`, `finalBranches`, `promotionBranches` (`enabled`, `allowedSteps`), `warnings` and `mergeTargetsRecommendation`.

When merge targets had to be guessed, `mergeTargetsRecommendation` is a sentence for the user: it names the branches concerned and the files where `mergeTargets` must be declared. It is `null` when every branch declares them.

<details markdown="1">
<summary>Technical explanations</summary>

- The major branches and their merge targets come from the function the deployment jobs use, so the description matches what a deployment does.
- A branch whose config file declares no `mergeTargets` gets them guessed from the usual names (integration, uat, preprod, main...). `mergeTargetsGuessed` is then true and a warning names the file to complete: declare `mergeTargets` there to stop depending on branch names.
- A final branch is not a guess when it is a production branch (its name starts with main or prod) or when its file declares an empty list (`mergeTargets: []`).
- `mergeSources` is the reverse reading of `mergeTargets`: the branches that are merged into this one.
- `promotionBranchAllowed` is true when `enablePromotionBranches` is true and the step is listed in `allowedPromotionSteps`. A step is always open to a full promotion, a Pull Request from the source branch to the target one, whatever this value.
- A merge target that has no config file is kept in the steps and reported in `warnings`.
- The configuration is read from the files of the current checkout, so run it on a branch that is up to date with the remote.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:pipeline:describe --agent --json
```

In agent mode:

- No flag is required: the command never prompts, and only reads the configuration files.
- Use `--json` and read `steps` to know which branch can be merged into which, instead of assuming branch names.
- When `mergeTargetsRecommendation` is not null, relay it to the user: the pipeline was partly guessed, and they should declare `mergeTargets` in the files it names.


## Parameters

| Name         |  Type   | Description                                                   | Default | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent        | boolean | Run in non-interactive mode for agents and automation         |         |          |         |
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir    | option  | Import flag values from a directory.                          |         |          |         |
| json         | boolean | Format output as json.                                        |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:project:pipeline:describe
```

```shell
$ sf hardis:project:pipeline:describe --json
```

```shell
$ sf hardis:project:pipeline:describe --agent --json
```


