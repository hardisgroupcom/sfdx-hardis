---
title: Promotion branches (experimental) with Salesforce CI/CD
description: Ship a subset of approved User Stories from uat to preprod and production with sfdx-hardis promotion branches, without losing their deployment actions, test classes and tickets
---
<!-- markdownlint-disable MD013 -->

## Promotion branches (experimental)

> **Experimental feature.** Promotion branches are new in sfdx-hardis. They are switched off by default (`enablePromotionBranches: false`), nothing changes for a project that does not enable them, and their behavior may still change from feedback. Please report anything unexpected in [sfdx-hardis issues](https://github.com/hardisgroupcom/sfdx-hardis/issues).

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

`allowedPromotionSteps` is required with it: see below.

### Which promotions the release manager can create

A project says which promotions its release managers may create, and that list is **required**:
`sf hardis:project:promotion:create` stops while it is missing, rather than assume that every major
branch can be promoted to every merge target. Declare the steps in `config/.sfdx-hardis.yml`:

```yaml
enablePromotionBranches: true
allowedPromotionSteps:
  - source: uat
    target: preprod
```

With that list, `uat -> preprod` is the only promotion a release manager can create:

- in the DevOps Pipeline, the **Create promotion** button and the checkboxes that tick the
  stories to carry show up in the `uat` window only. The other branches show their Pull Requests
  read-only, and `preprod` is passed to the command, so nothing is asked;
- `sf hardis:project:promotion:create` offers `uat` and `preprod` alone, and refuses
  `--source-branch integration` or `--target-branch main` with the list of what is allowed;
- a promotion branch assembled outside the list all the same (by hand, or before the list was
  written) still deploys, and the job logs a warning naming the step and the allowed ones.

Leave `target` out to allow every merge target of a source branch:

```yaml
allowedPromotionSteps:
  - source: uat            # uat to any of its merge targets
  - source: preprod
    target: main
```

A step whose target is not a merge target of its source (`mergeTargets` of the branch config)
opens nothing in the DevOps Pipeline: the command could not resolve that target from the pipeline
either, and would stop.

To allow everything, name every step: there is no wildcard, on purpose, so the list always reads
as a decision somebody made.

The setting sits next to `enablePromotionBranches` in the **Danger Zone** of the Pipeline Settings
panel of the VS Code extension. It is read from the project config only, since
`hardis:project:promotion:create` runs from any branch: a list written in a branch config file
would be invisible to it.

### Naming

Promotion branches follow one naming convention, which is not configurable:

```text
promotion/<source branch>/<target branch>/<YYYY-MM-DD>-<HHMM>
```

For example `promotion/uat/preprod/2026-09-06-1430` is the promotion assembled on September 6th, 2026 at 14:30 UTC, from `uat` to `preprod`. The name alone says where the stories come from and where they go. The date and the time are in UTC, so the name does not depend on the time zone of the machine that assembles the promotion.

A counter is added only when that name is already taken: a second promotion of the same step in the same minute is `promotion/uat/preprod/2026-09-06-1430-2`, then `-3`... A name stays taken as long as a branch, a merge commit of the target branch or a recently merged Pull Request still carries it, so a promotion branch deleted after its merge never gives its name back. If the Pull Request targets another branch than the one in the name, the job warns about it.

Promotion branches assembled by the first releases of the feature are named `<YYYY-MM-DD>-<counter>` (ex: `promotion/uat/preprod/2026-09-06-1`). They are still recognized, so a promotion opened or merged before the upgrade keeps working.

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

1. Make sure the stories are merged into `uat` and validated there.
2. Run the command:

    ```bash
    sf hardis:project:promotion:create --source-branch uat
    ```

    It lists the Pull Requests merged into `uat` and not yet promoted to `preprod`, and asks which ones to carry. The target branch is the merge target of `uat` (`preprod`), unless you pass `--target-branch`.

    A story carried by an earlier promotion branch to the same target is left out of the list: cherry-picked commits keep new SHAs, so it would otherwise be offered again after its promotion was merged. Pass `--include-already-promoted` to promote it a second time anyway.

3. The command then:

    - creates `promotion/uat/preprod/<YYYY-MM-DD>-<HHMM>` (UTC) from `origin/preprod`, with `-2`, `-3`... added only when that name is already taken;
    - cherry-picks the merge commit of each selected story, oldest first, with `-x` so each commit keeps a pointer to its origin (`-m 1` on merge commits, plain on squash commits);
    - pushes the branch and **creates the Pull Request** to `preprod`, with a description that declares the carried Pull Requests (`promotionPullRequests`), lists their titles, authors, source branches and tickets.

4. If a cherry-pick conflicts, the story depends on another one that is not part of the promotion. The command asks what to do (or takes it from `--on-conflict`):
    - **skip**: leave that story out, it is listed as such in the Pull Request description;
    - **commit-with-markers**: commit the story anyway with its git conflict markers, so the conflicts can be solved later on the branch, by hand or with a coding agent. The Pull Request description warns about it, lists the files to fix and embeds a ready-to-paste prompt for a coding agent, also saved in `hardis-report/promotion-conflicts-prompt-*.md`. The validation job stops with an error naming the files while a marker is still in the sources; on a provider that caps the description length (Azure DevOps stops at 4000 characters), the prompt is left out of the description and only the saved file carries it;
    - **commit-with-markers, and all the following conflicts**: the same, and the question is not asked again for the rest of the promotion. A promotion window usually conflicts on the same files story after story, and `--on-conflict commit-with-markers` is the equivalent for a non-interactive run;
    - **abort**: stop, the branch is deleted and nothing is pushed.

    The coding agent prompt asks for a commit message that explains, file by file, what was on the target side, what the story added, and what was kept: the reviewer of the promotion Pull Request reads the resolutions without opening the diff.

    The [sf-git-merge-driver](https://github.com/scolladon/sf-git-merge-driver) plugin solves many XML conflicts by itself.

    A story whose change is already in the target branch (brought by a hotfix, a retrofit or an earlier promotion) has nothing to cherry-pick: it is left out and listed apart in the Pull Request description, without asking anything.

    Only the Pull Requests that carry their own change are listed. A merge between two major branches, and a promotion Pull Request, move other work: they are never offered as candidates, never declared and never have their deployment actions run, even when they appear in the history of a selected commit (a sync of `integration` into a feature branch, for instance).

    Promotion branch names have exactly four segments, so the source and target branch names must not contain a `/`. The command stops before touching git if one of them does.

5. Review the Pull Request like any other, and do **not** squash it when merging: the `-x` trailers of the cherry-picks must survive in `preprod`. The branch itself can be deleted right after the merge, by hand or by a repository that deletes the head branch of every merged Pull Request: a later promotion never takes its name back, because the name of a deleted branch is still read from the merged Pull Requests of the target branch and from its history.

!!! warning "A promotion branch must only be validated, never deployed"
    A promotion branch is the source branch of a Pull Request, like a feature branch. Your CI must run its **validation** job, never a deployment job: deploying from the promotion branch would send the promotion to the target org before it is reviewed and merged. `hardis:project:deploy:smart` stops with an error when it happens, naming the setting to fix.

    The usual cause is a deployment trigger that matches more than your major branches. On GitLab, anchor the `DEPLOY_BRANCHES` regex of `.gitlab-ci-config.yml`:

    ```yaml
    # promotion/integration/uat/2026-09-08-1430 matches this one
    DEPLOY_BRANCHES: /(integration|uat|preprod|main)/
    # it does not match this one
    DEPLOY_BRANCHES: /^(integration|uat|preprod|main)$/
    ```

    On GitHub Actions, Azure Pipelines and Bitbucket Pipelines, list your major branches explicitly in the trigger of the deployment job.

### List what can be promoted, without creating anything

`hardis:project:promotion:create` lists the candidates before asking which ones to carry, but a coding agent (or anyone who only wants to know) needs that list on its own:

```bash
sf hardis:project:promotion:list-candidates --source-branch uat --json
```

[`sf hardis:project:promotion:list-candidates`](hardis/project/promotion/list-candidates.md) reads and reports, nothing else: same configuration checks, same allowed steps, same candidates, same rules about what another promotion already carries. Its JSON result holds `candidates` (Pull Request numbers, title, author, source branch, commit, date), `alreadyPromoted` and `openPromotions`, so an agent can pick the numbers and pass them to `hardis:project:promotion:create --pull-requests`.

The promotion already open between the two branches is named but left alone: only `promotion:create` closes it, once its replacement exists. The stories it carries are reported as already promoted, and they come back as candidates when it is superseded.

### One promotion at a time between two branches

A pipeline step holds a single promotion in flight, so the DevOps Pipeline can draw it on the arrow between the two branch nodes and there is one answer to "what is being promoted to `preprod` right now".

When a promotion from `uat` to `preprod` is already open and you assemble a new one, the command lists it and asks you to confirm; with `--agent` (and in CI) it closes it without asking. The old Pull Request is closed only once the new one has been created, so the step is never left without a promotion. If your git platform refuses to close it, the command says which one to close by hand.

The stories the superseded promotion carried come back to the candidate list: they are not "already promoted" any more, since the promotion that carried them is on its way out. That is the point of superseding it, and it is why you do not need `--include-already-promoted` to reassemble them.

Agents and automation call the same command without prompts:

```bash
sf hardis:project:promotion:create --agent --source-branch uat --pull-requests 482,487,491
```

The Pull Request is created through the git provider API when a token is configured, or with the `gh` CLI on GitHub. Without either, the branch is pushed and the description is saved under `hardis-report/` so you can create the Pull Request yourself. A link to the provider's own creation form, with the source branch, the target branch, the title and the description already filled in, is printed as well, so nothing has to be retyped.

The `scripts/actions/.sfdx-hardis.<PR>.yml` files of the stories travel with their commits, so their deployment actions are in the branch too.

### If your working copy is not clean

Assembling a promotion checks out another branch and cherry-picks commits, so it needs a clean working tree. When you have local changes, the command does not just refuse: it lists them and offers to **stash** them (`git stash`, restore later with `git stash pop`) or to **commit** them on the branch you are on, with the message of your choice. Only the files you changed are stashed or committed: the reports sfdx-hardis writes under `hardis-report/` are left alone, so getting your work back does not fight with them.

In `--agent` mode and in CI nothing is touched: the command stops and names the files to deal with.

___

## What sfdx-hardis does with it

| Job                                                           | Behavior                                                                                                                                                                                                                                                                                                                 |
|---------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Validation of `promotion/uat/preprod/2026-09-06-1430 -> preprod` | Delta deployment of the cherry-picked changes. The scope is the declared Pull Requests: their deployment actions are listed, their pending manual actions appear as checkboxes, their Apex test classes are collected when `enableDeploymentApexTestClasses` is active.                                                  |
| Deployment of `promotion/uat/preprod/2026-09-06-1430 -> preprod` | Same scope. Actions run in `preprod` and each one is recorded on its own story Pull Request, in the "Deployment Actions" comment (`preprod` column).                                                                                                                                                                     |
| Promotion `preprod -> main`                                   | The promotion Pull Request is part of the go-live like any other merge. sfdx-hardis expands it with the stories it declares, so their actions run in production and the release notes list them.                                                                                                                         |
| Later promotion `uat -> preprod`                              | The stories are still in the `uat` promotion window: their original merge commits have not reached `preprod`. Their metadata is redeployed as a no-op, and their actions are skipped where already performed (`runOnlyOnceByOrg`). The Pull Request comment lists them as already deployed through the promotion branch. |
| Next `sf hardis:project:promotion:create` from `uat`          | A Pull Request another promotion branch already carries to the same target is left out of the choices, so the same story is not shipped twice. `--include-already-promoted` offers it again; the cherry-pick is then empty and the story is simply listed as already in the target branch.                               |

**Custom behaviors are inherited.** If a carried story declares `NO_DELTA`, `PURGE_FLOW_VERSIONS`, `DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT` or `FLOW_DELETE_INTERVIEWS` in its description, the promotion Pull Request inherits it, and the validation comment says which story it came from. What a story declared, it needs in every org it reaches.

The declared list is taken as is, with two exceptions reported as warnings: a Pull Request number that cannot be found is skipped, and a Pull Request that is not merged is skipped, since its content cannot be in the branch.

___

## After the promotion

- **Retrofit right away.** Once `preprod` (or production) contains the promotion branch, retrofit it into `integration` with a `retrofit/` branch as for a [hotfix](salesforce-ci-cd-hotfixes.md#3-retrofit-in-the-build-stream). The cherry-picked commits then meet their originals at the next `integration -> uat` promotion instead of at the next go-live.
- **Freeze `uat -> preprod` while a promotion branch sits in `preprod`** and has not reached production yet, otherwise unapproved stories ride along. This is the RUN/BUILD rule of the hotfix process.
- `enablePromotionBranches` is read from the **project** configuration (`config/.sfdx-hardis.yml`). sfdx-hardis merges it with the configuration of the branch a job runs on, so setting it in a single branch file would leave the command and the other branches without it.
- A promotion Pull Request that carries another promotion is followed down to the User Stories, however many levels there are: a `preprod -> main` promotion declaring the `uat -> preprod` one reaches the stories that one carried, and their deployment actions, Apex test classes and custom behaviors travel with them.
- A promotion carries **commits**, not Pull Request numbers. On a pipeline where User Stories are merged into `integration` and `integration` is then merged into `uat`, every first-parent commit of `uat` is one of those syncs: they are opened up into the User Story merges they brought in, so each story is a candidate of its own and can be carried alone. What stays grouped is a single commit that really brought several Pull Requests in at once (a squashed sync, an octopus merge, a back-merge from the target branch): promoting one of them carries the others too. The command names them before cherry-picking anything, and declares them all in the Pull Request.
- In the DevOps Pipeline of the VS Code extension, a promoted story leaves the window of the branch it came from and is listed in the branch it reached, so **a Pull Request number appears in a single place in the diagram** (both in the counter on the node and in the list opened by clicking it). The "Show already promoted Pull Requests" toggle brings the other places back when you want to see where a story has been.
- The lists and counters of the DevOps Pipeline leave out the Pull Requests that **move** other Pull Requests: a merge between two major branches, and a promotion Pull Request. Everything that carries its own change stays listed, whatever the branch is named (`feature/`, `fix/`, `retrofit/`, `hotfix/`...). The "Show merge and promotion Pull Requests" toggle at the top of the branch window brings the others back. The rule for major-to-major merges applies to **every** project, promotion branches or not, since such a merge is plumbing in any pipeline; a `promotion/` branch is only treated as a vehicle when the feature is enabled, exactly as the deployment jobs treat it.
- In the window of a branch, tick the User Stories to carry and use the **Create promotion** button: `sf hardis:project:promotion:create` opens with them preselected, and you confirm the selection in the terminal. A story brought into the branch by a promotion is promoted through that promotion and cannot be ticked.
- The deployment jobs still see the stories in the `uat` promotion window: their original merge commits have not reached `preprod`, so their metadata is redeployed as a no-op and their already performed actions are skipped. That is a deployment concern, not a listing one.

A `uat` window that stays full of already-shipped stories is the sign that `uat` is used as the approval gate `preprod` was designed to be. Consider adding an intermediate major branch rather than assembling every version by hand.

___

## Release notes

`sf hardis:doc:release-notes` lists the User Stories a promotion Pull Request carries, not the promotion Pull Request itself: the tickets, the metadata changes, the deployment actions and the contributor counts are those of the stories. A promotion whose declared Pull Requests could not be resolved is kept in the notes, so a change never disappears from them. The same rule applies to the merges between two major branches, which are left out whether or not the project uses promotion branches. Pass `--include-promotions` to list both kinds next to the stories they carry.

___

## Limits

- A promotion is always assembled **from a major branch**: you cannot pass a promotion branch as `--source-branch`. A promotion carrying another promotion is fine, and the deployment jobs follow the declarations down as many levels as there are.
- Custom behaviors are inherited on the promotion Pull Request only. On the next `preprod -> main` promotion, keywords are read from that Pull Request's description, like for any promotion.
- `sf hardis:work:save` warns when run on a promotion branch: its cleaning and manifest updates are meant for User Story branches.

___

## Pull Request description cache

Azure DevOps truncates the description of a Pull Request returned by its **list** API at 400 characters, with no marker saying so. The `promotionPullRequests` declaration of a promotion branch sits below the navigation block and the introduction, so on a promotion carrying more than a story or two it falls past that cut: sfdx-hardis and the VS Code extension both have to read each such Pull Request again through the single Pull Request API, which returns the whole description.

That is one extra API call per Pull Request with a long description, on every job and every refresh of the DevOps Pipeline. On a repository with a long history it dominates the run.

The description of a Pull Request that is **merged or abandoned** no longer moves, so it is cached locally:

|        |                                                                                                               |
|--------|---------------------------------------------------------------------------------------------------------------|
| Where  | `~/.sfdx/sfdx-hardis-pr-cache/<provider>__<repository>.json`, outside the repository so it is never committed |
| Key    | the normalized git remote URL of the working copy, which is what the CLI and the extension agree on           |
| What   | the full description, the terminal state it was in, and when it was cached                                    |
| Shared | a cache warmed by a CI job or a local command is read by the VS Code extension, and the other way round       |

The rules that keep it honest:

- **An open Pull Request is never cached**, in either direction: its description is exactly what people are still editing.
- An entry is used only when the Pull Request is **still in the state it was cached in**. Bitbucket reopens a declined Pull Request and Azure DevOps reactivates an abandoned one, so the state seen right now always wins.
- An entry **expires after 90 days**, because a merged description can still be edited by hand.
- A repository keeps at most **5000 entries**, the oldest going first.
- The file is merged and rewritten atomically, so a CI job and the extension writing at the same time cannot lose each other's entries.

Set `NO_CACHE=true` or `SFDX_HARDIS_NO_PR_CACHE=true` to bypass it entirely, and delete `~/.sfdx/sfdx-hardis-pr-cache/` to start again.

> Measured on a four level pipeline of 23 Pull Requests: `sf hardis:project:promotion:list-candidates` went from **74.6 s** to **40.6 s** on the second run, with identical output. The gain grows with the number of Pull Requests that carry a long description.
