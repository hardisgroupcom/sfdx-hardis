---
title: Promotion branches with Salesforce CI/CD
description: Ship a subset of approved User Stories from uat to preprod and production with sfdx-hardis promotion branches, without losing their deployment actions, test classes and tickets
---
<!-- markdownlint-disable MD013 -->

## Promotion branches

- [When to use them](#when-to-use-them)
- [How it works](#how-it-works)
- [Configuration](#configuration)
- [Assemble a promotion branch](#assemble-a-promotion-branch)
- [What sfdx-hardis does with it](#what-sfdx-hardis-does-with-it)
- [After the promotion](#after-the-promotion)
- [Limits](#limits)

___

## When to use them

With sfdx-hardis, you promote **branches**, not features: everything merged into `uat` goes to `preprod`, then to production, as one version. This is the recommended way, because the stories of a version were tested together.

Some organizations cannot always follow it. Business sign-off happens **per User Story**, a stakeholder is on leave, a story comes back from a demo with rework, and a release date is fixed. At that moment `uat` holds a mix of approved and unapproved stories, and one unapproved story would block every other one.

A **promotion branch** is the exception path for that situation: a branch cut from the target major branch (usually `preprod`), on which the release manager cherry-picks the approved stories only, and which is merged through an ordinary Pull Request. It is not a replacement for the normal promotion of `uat`: use it when you have to, and promote `uat` as usual as soon as you can.

For urgent fixes that were never in `uat`, use [hotfixes and retrofit](salesforce-ci-cd-hotfixes.md) instead.

___

## How it works

A promotion branch is an ordinary minor branch for the deployment itself: its Pull Request to `preprod` gets a delta validation, a Quick Deploy after the merge, the overwrite management, exactly like a hotfix branch.

What makes it special is the **Pull Request scope**. sfdx-hardis finds the User Stories carried by a merge by matching merged Pull Requests with the commits of the merge. Cherry-picked commits have new SHAs, so the stories of a promotion branch would be invisible: their [deployment actions](salesforce-ci-cd-work-on-task-deployment-actions.md) would not run, their Apex test classes would not be collected, and the release notes would not mention them.

With promotion branches enabled, the promotion Pull Request **declares** the stories it carries, in a YAML block of its description:

```yaml
promotionPullRequests: [482, 487, 491]
```

sfdx-hardis then treats those Pull Requests as the scope of the promotion Pull Request, on the validation job and on the deployment job.

___

## Configuration

In `config/.sfdx-hardis.yml` (or in a branch config file like `config/branches/.sfdx-hardis.preprod.yml` to allow promotion branches into that branch only):

```yaml
enablePromotionBranches: true
```

### Naming

Promotion branches follow one naming convention, which is not configurable:

```text
promotion/<source branch>/<target branch>/<YYYY-MM-DD>-<counter>
```

For example `promotion/uat/preprod/2026-09-06-1` is the first promotion assembled on September 6th, 2026, from `uat` to `preprod`. The name alone says where the stories come from and where they go, and the counter separates two promotions assembled the same day between the same branches (`-1`, `-2`...). If the Pull Request targets another branch than the one in the name, the job warns about it.

A Pull Request is a promotion Pull Request when **all** of the following are true:

- `enablePromotionBranches` is `true`;
- its source branch follows the naming convention above;
- its description contains a `promotionPullRequests` YAML block.

Anything else is unchanged:

- when `enablePromotionBranches` is not set, the naming and the YAML key are ignored (an info line in the job log says so);
- a branch starting with `promotion/` that does not follow the convention (ex: `promotion/2026-09`) is an ordinary feature branch, even with the YAML key (a warning says so);
- a well-named promotion branch without the YAML key is an ordinary feature branch (a warning says so);
- a `promotionPullRequests` key on a `feature/` branch is ignored (a warning says so).

___

## Assemble a promotion branch

Promotion branches are **always created with the command** [`sf hardis:project:promotion:create`](hardis/project/promotion/create.md), from the VS Code SFDX Hardis extension (**Create promotion** button of a major branch in the DevOps Pipeline) or from a terminal. Do not assemble them by hand: the command is what guarantees the naming, the cherry-pick options and the Pull Request declaration the deployment jobs rely on.

1. Make sure the stories are merged into `uat` and validated there, and that your local repository has no uncommitted change.
2. Run the command:

    ```bash
    sf hardis:project:promotion:create --source-branch uat
    ```

    It lists the Pull Requests merged into `uat` and not yet promoted to `preprod`, and asks which ones to carry. The target branch is the merge target of `uat` (`preprod`), unless you pass `--target-branch`.

3. The command then:

    - creates `promotion/uat/preprod/<today>-<counter>` from `origin/preprod`;
    - cherry-picks the merge commit of each selected story, oldest first, with `-x` so each commit keeps a pointer to its origin (`-m 1` on merge commits, plain on squash commits);
    - pushes the branch and **creates the Pull Request** to `preprod`, with a description that declares the carried Pull Requests (`promotionPullRequests`), lists their titles, authors, source branches and tickets.

4. If a cherry-pick conflicts, the story depends on another one that is not part of the promotion. The command asks what to do (or takes it from `--on-conflict`):
    - **skip**: leave that story out, it is listed as such in the Pull Request description;
    - **commit-with-markers**: commit the story anyway with its git conflict markers, so the conflicts can be solved later on the branch, by hand or with a coding agent. The Pull Request description warns about it and lists the files to fix; the validation job fails until they are fixed;
    - **abort**: stop, the branch is deleted and nothing is pushed.

    The [sf-git-merge-driver](https://github.com/scolladon/sf-git-merge-driver) plugin solves many XML conflicts by itself.
5. Review the Pull Request like any other, and do **not** squash it when merging: the `-x` trailers of the cherry-picks must survive in `preprod`.

Agents and automation call the same command without prompts:

```bash
sf hardis:project:promotion:create --agent --source-branch uat --pull-requests 482,487,491
```

The Pull Request is created through the git provider API when a token is configured, or with the `gh` CLI on GitHub. Without either, the branch is pushed and the description is saved under `hardis-report/` so you can create the Pull Request yourself.

The `scripts/actions/.sfdx-hardis.<PR>.yml` files of the stories travel with their commits, so their deployment actions are in the branch too.

___

## What sfdx-hardis does with it

| Job                                                           | Behavior                                                                                                                                                                                                                                                                                                                 |
|---------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Validation of `promotion/uat/preprod/2026-09-06-1 -> preprod` | Delta deployment of the cherry-picked changes. The scope is the declared Pull Requests: their deployment actions are listed, their pending manual actions appear as checkboxes, their Apex test classes are collected when `enableDeploymentApexTestClasses` is active.                                                  |
| Deployment of `promotion/uat/preprod/2026-09-06-1 -> preprod` | Same scope. Actions run in `preprod` and each one is recorded on its own story Pull Request, in the "Deployment Actions" comment (`preprod` column).                                                                                                                                                                     |
| Promotion `preprod -> main`                                   | The promotion Pull Request is part of the go-live like any other merge. sfdx-hardis expands it with the stories it declares, so their actions run in production and the release notes list them.                                                                                                                         |
| Later promotion `uat -> preprod`                              | The stories are still in the `uat` promotion window: their original merge commits have not reached `preprod`. Their metadata is redeployed as a no-op, and their actions are skipped where already performed (`runOnlyOnceByOrg`). The Pull Request comment lists them as already deployed through the promotion branch. |

**Custom behaviors are inherited.** If a carried story declares `NO_DELTA`, `PURGE_FLOW_VERSIONS`, `DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT` or `FLOW_DELETE_INTERVIEWS` in its description, the promotion Pull Request inherits it, and the validation comment says which story it came from. What a story declared, it needs in every org it reaches.

The declared list is taken as is, with two exceptions reported as warnings: a Pull Request number that cannot be found is skipped, and a Pull Request that is not merged is skipped, since its content cannot be in the branch.

___

## After the promotion

- **Retrofit right away.** Once `preprod` (or production) contains the promotion branch, retrofit it into `integration` with a `retrofit/` branch as for a [hotfix](salesforce-ci-cd-hotfixes.md#3-retrofit-in-the-build-stream). The cherry-picked commits then meet their originals at the next `integration -> uat` promotion instead of at the next go-live.
- **Freeze `uat -> preprod` while a promotion branch sits in `preprod`** and has not reached production yet, otherwise unapproved stories ride along. This is the RUN/BUILD rule of the hotfix process.
- The stories stay listed in the `uat` window of the DevOps Pipeline until `uat` is really promoted: neither the promotion branch nor the retrofit changes that. The VS Code extension marks them as already deployed.

A `uat` window that stays full of already-shipped stories is the sign that `uat` is used as the approval gate `preprod` was designed to be. Consider adding an intermediate major branch rather than assembling every version by hand.

___

## Limits

- One level only: a promotion branch built from another promotion branch is not supported.
- Custom behaviors are inherited on the promotion Pull Request only. On the next `preprod -> main` promotion, keywords are read from that Pull Request's description, like for any promotion.
- `sf hardis:work:save` warns when run on a promotion branch: its cleaning and manifest updates are meant for User Story branches.
