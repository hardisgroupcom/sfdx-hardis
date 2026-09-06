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
# Optional, "promotion" by default: promotion branches are named promotion/<name>
promotionBranchPrefix: promotion
```

A Pull Request is a promotion Pull Request when **all** of the following are true:

- `enablePromotionBranches` is `true`;
- its source branch is named `<promotionBranchPrefix>/<name>` (ex: `promotion/2026-09-release`);
- its description contains a `promotionPullRequests` YAML block.

Anything else is unchanged:

- when `enablePromotionBranches` is not set, the prefix and the YAML key are ignored (an info line in the job log says so);
- a `promotion/` branch without the YAML key is an ordinary feature branch (a warning says so);
- a `promotionPullRequests` key on a `feature/` branch is ignored (a warning says so).

___

## Assemble a promotion branch

1. Make sure the stories are merged into `uat` and validated there.
2. Create the branch from the **target** branch, not from `uat`:

    ```bash
    git fetch origin
    git checkout -b promotion/2026-09-release origin/preprod
    ```

3. Cherry-pick the **merge commit** of each approved story, oldest first, keeping the origin in the message:

    ```bash
    git cherry-pick -m 1 -x <merge commit of PR 482>
    git cherry-pick -m 1 -x <merge commit of PR 487>
    git cherry-pick -m 1 -x <merge commit of PR 491>
    ```

    On a repository using squash merges, cherry-pick the squash commit of each story instead (no `-m 1`).

    If a cherry-pick conflicts, the story depends on another one that is not approved yet: solve the conflict knowingly, or leave the story out. The [sf-git-merge-driver](https://github.com/jayree/sf-git-merge-driver) plugin solves many XML conflicts by itself.

4. Push the branch and create the Pull Request to `preprod`. In its description, declare the stories and list their tickets:

    ````markdown
    Promotion of the approved stories of September.

    ```yaml
    promotionPullRequests: [482, 487, 491]
    ```

    Tickets: PROJ-1201, PROJ-1207, PROJ-1215
    ````

5. Do **not** squash the promotion Pull Request when merging it: the `-x` trailers of the cherry-picks must survive in `preprod`.

The `scripts/actions/.sfdx-hardis.<PR>.yml` files of the stories travel with their commits, so their deployment actions are in the branch too.

___

## What sfdx-hardis does with it

| Job                                    | Behavior                                                                                                                                                                                                                                                                                                                 |
|----------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Validation of `promotion/x -> preprod` | Delta deployment of the cherry-picked changes. The scope is the declared Pull Requests: their deployment actions are listed, their pending manual actions appear as checkboxes, their Apex test classes are collected when `enableDeploymentApexTestClasses` is active.                                                  |
| Deployment of `promotion/x -> preprod` | Same scope. Actions run in `preprod` and each one is recorded on its own story Pull Request, in the "Deployment Actions" comment (`preprod` column).                                                                                                                                                                     |
| Promotion `preprod -> main`            | The promotion Pull Request is part of the go-live like any other merge. sfdx-hardis expands it with the stories it declares, so their actions run in production and the release notes list them.                                                                                                                         |
| Later promotion `uat -> preprod`       | The stories are still in the `uat` promotion window: their original merge commits have not reached `preprod`. Their metadata is redeployed as a no-op, and their actions are skipped where already performed (`runOnlyOnceByOrg`). The Pull Request comment lists them as already deployed through the promotion branch. |

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
