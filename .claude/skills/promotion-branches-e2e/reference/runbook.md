# Promotion branches: end to end test runbook

How to rebuild, from nothing, a four level pipeline that exercises every path of the promotion
branches feature (`enablePromotionBranches`, `sf hardis:project:promotion:create`) against a real
Salesforce org, and how to read the result. Roughly 45 minutes end to end.

Paths below are written relative to this skill directory:
`.claude/skills/promotion-branches-e2e/`.

___

## 0. What you need

- A Salesforce org you can deploy to, already authenticated: `sf org login web --alias promo-e2e`.
  The four pipeline levels can all point at it.
- `gh` authenticated on an account that can create private repositories.
- A local sfdx-hardis working copy on the branch to test. Every command below calls `bin/dev.js`
  from it, so no `sf plugins install` is needed.
- A local vscode-sfdx-hardis working copy on the matching branch, compiled (`yarn compile`), for the
  diagram check of section 7bis.
- Bash: Git Bash on Windows, bash on macOS and Linux. On Windows, clear `NODE_OPTIONS` for every CLI
  call (VS Code sets an inspector bootloader that keeps node alive after the command ends). The
  library does it for you.

### On a new computer

Everything the run needs is in this skill and in the `.env` at the root of the sfdx-hardis working
copy (git-ignored). `reference/env.example` lists every variable, what it is for and where to get it.

1. Copy the `.env` of the computer that already runs the test to the root of the working copy (or
   copy `reference/env.example` there and fill it).
2. Do the logins `.env` cannot carry: `gh auth login`, `glab auth login --hostname <GITLAB_E2E_HOST>`,
   `sf org login web --alias <E2E_ORG>` (and the Dev Hub when it is another org).
3. `yarn install` in the sfdx-hardis working copy; clone vscode-sfdx-hardis next to it, on the
   matching branch, then `yarn install && yarn compile` there.
4. `bash .claude/skills/promotion-branches-e2e/scripts/preflight.sh` (`--provider <p>` for one
   provider). It is read-only, prints OK / MISSING / WARN per item, and the command that fixes each
   MISSING. Run it until nothing is MISSING.

### Settings

Every script and library sources `scripts/env-lib.sh`: a variable comes from the environment, else
from `.env`, else from a default derived from where the skill sits. No path of a computer is written
anywhere:

| Variable        | Default                                                                                         |
|-----------------|-------------------------------------------------------------------------------------------------|
| `ORG`           | `E2E_ORG` of `.env`                                                                             |
| `DEV`           | `<working copy>/bin/dev.js` (`git rev-parse --show-toplevel` of the skill)                      |
| `EXT`           | `<working copy>/../vscode-sfdx-hardis`                                                          |
| `WORK`          | `<temp>/promo-e2e-<provider>`; real CI `promo-e2e-ci-<provider>`; backpromote `promo-e2e-bp-<provider>` |
| `LOGS`, `EXPECT`| `<WORK>-logs`, `<WORK>-expect`                                                                  |
| `<temp>`        | `E2E_TMP`, else `TMPDIR`, else `TEMP`, else `/tmp` (through `cygpath -m` on Windows, so bash, node and python read the same path) |
| `DEVHUB`        | `ORG`; `DEVORG` and `DEVORG2`: `promo-e2e-dev` and `promo-e2e-dev2` (section 6bis)              |
| `API`           | `67.0`                                                                                          |

`WORK` must not exist when a run starts: remove the folders of the previous run, or export `WORK` and
`LOGS`. In a git worktree, `.env` and the extension are looked for next to the main working copy.

For the commands of this runbook typed by hand, load the same settings in the shell first:

```bash
export PROVIDER=github                       # or gitlab, azure, bitbucket
source .claude/skills/promotion-branches-e2e/scripts/env-lib.sh && e2e_defaults "promo-e2e-$PROVIDER"
export REPO="youruser/sfdx-hardis-promo-e2e-<n>"   # GitHub: private test repository, always a NEW one
mkdir -p "$LOGS"
```

> Backpromote (Beta) refuses production orgs and the orgs of the major branches, so section 6bis
> needs a **scratch org** (or a developer sandbox). A Developer Edition org with Dev Hub enabled
> creates it; `sf org list` shows `isDevHub`.

## 1. The job simulators

GitHub Actions is not needed: the git provider resolves the Pull Request from the environment, so
running the CLI locally with the right variables reproduces a real job exactly.

```bash
source .claude/skills/promotion-branches-e2e/scripts/e2e-lib.sh
```

It defines:

| Function                                           | What it reproduces                                                                    |
|----------------------------------------------------|---------------------------------------------------------------------------------------|
| `e2e_check <pr> <target> <label>`                  | The validation job: checks out `refs/pull/<pr>/merge` and runs `deploy:smart --check` |
| `e2e_deploy <target> <label>`                      | The deployment job: checks out the target branch and runs `deploy:smart`              |
| `e2e_promote <source> <prs> <label> [extra flags]` | `promotion:create --agent` from the source branch                                     |
| `e2e_release_notes <label> [extra flags]`          | `doc:release-notes --mode post` on the last merge of `main`                           |
| `e2e_grep <logfile>`                               | The lines worth reading in a job log                                                  |
| `pipeline_check <label> [expectations]`            | What the vscode-sfdx-hardis DevOps Pipeline shows at this point of the run            |

`pipeline_check` is provided by all four libraries and always calls the same
`scripts/check-pipeline.cjs`: see section 4bis.

On GitLab, source `scripts/e2e-lib-gitlab.sh` instead: `gl_check`, `gl_deploy`, `gl_promote`,
`gl_release_notes`, plus `gl_mr_create` and `gl_mr_merge` to open and merge a merge request. It
needs `PROJECT_ID`, `PROJECT_PATH`, `GL_HOST` and `GL_TOKEN` where the GitHub library needs `REPO`.
Section 8 holds what is different on GitLab.

On Azure DevOps, source `scripts/e2e-lib-azure.sh`: `az_check`, `az_deploy`, `az_promote`,
`az_release_notes`, plus `az_pr_create` and `az_pr_merge`, and the merge-ref wait. It needs
`AZ_ORG`, `AZ_PROJECT`, `AZ_REPO_NAME`, and `AZ_TOKEN` (default `AZURE_PERSONAL_ACCESS_TOKEN`);
`AZ_REPO_ID` is read from the API by name when empty. Section 8bis holds what is different on Azure
DevOps.

On Bitbucket Cloud, source `scripts/e2e-lib-bitbucket.sh`: `bb_check`, `bb_deploy`, `bb_promote`,
`bb_release_notes`, plus `bb_pr_create`, `bb_pr_merge`, `bb_pr_decline` and `bb_remote_url`. It needs
`BB_WORKSPACE` and `BB_REPO`; `BB_TOKEN` and `BB_EMAIL` default to `ATLASSIAN_TOKEN` and
`ATLASSIAN_EMAIL`. Section 8ter holds what is different on Bitbucket.

The scripted sections do not call these names: they call the provider neutral `p_*` functions of
`scripts/promotion-provider.sh`, which maps them for `PROVIDER=github|gitlab|azure|bitbucket`
(section 6ter).

Each writes `$LOGS/<label>.log` and echoes the exit code.

## 2. Build the repository

Four major branches, all deployed to the same org.

`scripts/build-repo.sh` writes all of it:

```bash
WORK="$WORK" API=67.0 bash .claude/skills/promotion-branches-e2e/scripts/build-repo.sh
```

It refuses to run on an existing `$WORK`, on purpose: a rerun on a previous tree is exactly the
artefact this test must not have. What it writes, and why:

`sfdx-project.json` with a single `force-app` package directory, then:

`config/.sfdx-hardis.yml`

```yaml
projectName: sfdx-hardis-promo-e2e
developmentBranch: integration
useDeltaDeployment: true
testLevel: NoTestRun
enablePromotionBranches: true
enableDeploymentApexTestClasses: true
enableDeltaDeploymentBetweenMajorBranches: true
```

> `enableDeploymentApexTestClasses` without `enableDeltaDeploymentBetweenMajorBranches` is refused
> by `deploy:smart`, on purpose: test classes would be missing in delta deployments between major
> branches.

`config/branches/.sfdx-hardis.<branch>.yml`, one per branch:
`integration` -> `mergeTargets: [uat]`, `uat` -> `[preprod]`, `preprod` -> `[main]`, `main` -> `[]`.

> Name the development branch `integration`, not `uat`. A branch window holds the stories merged
> into the branch **and** those that arrived through its child branches, so `uat` and `preprod` end
> up holding stories whose `targetBranch` is `integration`. A pipeline with no child branch hides
> every bug that depends on that.

`.gitignore` must hold `config/user/` (sfdx-hardis writes a local user config there, and
`promotion:create` refuses to run on a dirty tree).

> Leave `hardis-report/` **out** of `.gitignore` on purpose: a project that never added it is the
> case where the reports sfdx-hardis writes inside the repository can be mistaken for the user's
> own changes, both by the cleanliness check and by the empty-cherry-pick detection.

Sources:

- `force-app/main/default/classes/PromoE2EAlphaTest.cls` and `PromoE2EBetaTest.cls`: trivial
  `@isTest` classes, so `deploymentApexTestClasses` can name classes that really exist in the org.
- `force-app/main/default/labels/CustomLabels.labels-meta.xml` with one label: the **shared** file
  used later to produce a real cherry-pick conflict.
- `NOTES.md` at the root: a file **outside** `force-app` and `manifest`, used for the conflict that
  the marker gate must still catch.
- `manifest/package.xml` covering `CustomLabel`, `ApexClass` and `StaticResource`.

Then:

```bash
git add -A && git commit -qm "chore: base project"
gh repo create "$REPO" --private --source=. --remote=origin --push
git branch preprod && git branch uat && git branch integration
git push -q origin preprod uat integration
sf project deploy start --source-dir force-app --target-org "$ORG" --ignore-conflicts
```

> Never merge one major branch into another to propagate a base change: fast-forwarding `main`
> from `integration` silently ships every story. Commit the change on `main` and reset the others
> to it.

## 3. The User Stories

Each story adds **its own static resource** (never a shared file, so unrelated stories cannot
conflict), plus a `scripts/actions/.sfdx-hardis.<PR>.yml` holding its deployment actions. That file
travels with the cherry-picked commit, which is one of the things being tested.

| Story | Branch                       | Target      | Actions                   | Test classes        | Custom behavior          |
|-------|------------------------------|-------------|---------------------------|---------------------|--------------------------|
| S1    | `feature/E2E-101-alpha`      | integration | pre command + post manual | `PromoE2EAlphaTest` | -                        |
| S2    | `feature/E2E-102-beta`       | integration | post command              | -                   | `NO_DELTA`               |
| S3    | `feature/E2E-103-gamma`      | integration | pre command               | `PromoE2EBetaTest`  | `PURGE_FLOW_VERSIONS`    |
| S4    | `feature/E2E-201-delta`      | uat         | pre command + post manual | `PromoE2EAlphaTest` | -                        |
| S5    | `feature/E2E-202-epsilon`    | uat         | post command              | -                   | -                        |
| S6    | `feature/E2E-301-hotfix`     | preprod     | pre command + post manual | `PromoE2EBetaTest`  | `FLOW_DELETE_INTERVIEWS` |
| S7    | `feature/E2E-302-hotfix-two` | preprod     | post command              | -                   | -                        |

S7 exists for the second go-live of section 4: promoted to `main` on its own, it makes the first
go-live promotion (P4) leave every window, which is the situation of issue #2260.

`scripts/stories.sh` creates the branches and the action files: `story_branch <branch> <target>
<resource>` then, once the Pull Request exists, `story_actions <branch> <number> <kind>`. Opening
the Pull Request is provider specific and stays with the caller.

Give **S1 two separate `yaml` blocks** in its description, both naming `deploymentApexTestClasses`
with a different class: the union of the two must be selected. A second block repeating a key used
to replace the first one, which silently dropped the classes declared above it.

The Pull Request description carries the test classes and the keyword:

````markdown
Story S1 alpha, build stream.

```yaml
deploymentApexTestClasses:
  - PromoE2EAlphaTest
```
````

`NO_DELTA`, `PURGE_FLOW_VERSIONS` and `DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT` are recognized
anywhere in the description. **`FLOW_DELETE_INTERVIEWS` is not**: interview deletion is
irreversible, so it only counts on a line of its own (or as a bullet, or a ticked checkbox). Put it
on its own line or the inheritance test will look broken when it is in fact correct.

Create each story branch from its target, push, open the Pull Request, then add the actions file as
a second commit on the same branch.

## 4. The run

Merge with `gh pr merge <N> --merge` every time: **never squash**, the `-x` trailers of the
cherry-picks must survive.

```bash
# BUILD stream into integration
for pr in 1 2 3; do e2e_check $pr integration "check-pr$pr"; done
for pr in 1 2 3; do gh pr merge $pr --repo "$REPO" --merge --delete-branch=false
                    e2e_deploy integration "deploy-integration-pr$pr"; done

# The pipeline before anything is promoted: the three stories wait in integration, uat is empty,
# and no promotion is drawn on the integration -> uat arrow (section 4bis)
pipeline_check "pipeline-before-p1" "$EXPECT/before-p1.json"

# P1: integration -> uat carrying S1 and S3 only
e2e_promote integration 1,3 "promotion-integration-uat"   # creates Pull Request P1

# The promotion exists but is not merged: it is drawn ON the integration -> uat arrow, it has no
# branch node of its own, and the three stories are still listed in integration
pipeline_check "pipeline-p1-open" "$EXPECT/p1-open.json"
e2e_check <P1> uat "check-promotion-uat"
gh pr merge <P1> --repo "$REPO" --merge --delete-branch=false
e2e_deploy uat "deploy-uat-promotion"

# After the merge: S1 and S3 are listed in uat, the branch they reached, and gone from integration,
# which keeps S2 alone. The arrow is empty again
pipeline_check "pipeline-after-p1" "$EXPECT/after-p1.json"

# Stories validated directly in uat
for pr in 4 5; do e2e_check $pr uat "check-pr$pr"; done
for pr in 4 5; do gh pr merge $pr --repo "$REPO" --merge --delete-branch=false
                  e2e_deploy uat "deploy-uat-pr$pr"; done

# P2: uat -> preprod carrying S4 only
e2e_promote uat 4 "promotion-uat-preprod"
e2e_check <P2> preprod "check-promotion-preprod"
gh pr merge <P2> --repo "$REPO" --merge --delete-branch=false
e2e_deploy preprod "deploy-preprod-promotion"

# P3: uat -> preprod carrying ONE of the stories that reached uat through the P1 promotion.
# The merge of P1 into uat only moves other merges, so it is opened up into the commits it brought
# in: S1 and S3 are two candidate rows of their own, not one row labelled "#3, #1". Promoting 3
# carries S3 alone and leaves S1 waiting in uat.
# Not <P1>: a promotion Pull Request is a vehicle, it is never a candidate, and passing its number
# is answered with "not among the Pull Requests waiting for promotion".
pipeline_check "pipeline-before-p3" "$EXPECT/before-p3.json"
e2e_promote uat 3 "promotion-uat-preprod-nested"
# Assert here, before going on: the candidate table has a row "#1" and a row "#3", the branch
# cherry-picks one commit, and the summary declares #3 only.
e2e_grep "$LOGS/promotion-uat-preprod-nested.log"

# RUN stream: hotfix straight into preprod
e2e_check 6 preprod "check-pr6-hotfix"
gh pr merge 6 --repo "$REPO" --merge --delete-branch=false
e2e_deploy preprod "deploy-preprod-pr6"

# P4: preprod -> main carrying the stories that reached preprod through P2 and P3, AND the hotfix.
# The merges of P2 and P3 into preprod are vehicles too, so the candidates are the stories under
# them (#4 carried by P2, #3 carried by P3) and #6, never the promotion numbers themselves.
e2e_promote preprod 4,3,6 "promotion-preprod-main"
e2e_check <P4> main "check-promotion-main"
gh pr merge <P4> --repo "$REPO" --merge --delete-branch=false
e2e_deploy main "deploy-main-promotion"

# The go-live: every story that was promoted is listed in main, none of them twice
pipeline_check "pipeline-after-golive" "$EXPECT/after-golive.json"

# Release notes of the go-live, then the same with the vehicles
e2e_release_notes "release-notes"
e2e_release_notes "release-notes-all" --include-promotions

# Second go-live: S7 merged into preprod, then P5 = preprod -> main carrying S7 only. P4 is now in
# no window (main shows the latest go-live, preprod was never merged into main directly), and the
# stories it carried must stay out of preprod and uat all the same (issue #2260)
e2e_check 7 preprod "check-pr7-hotfix"
gh pr merge 7 --repo "$REPO" --merge --delete-branch=false
e2e_deploy preprod "deploy-preprod-pr7"
e2e_promote preprod 7 "promotion-preprod-main-two"   # S3, S4 and S6 are skipped as already promoted
e2e_check <P5> main "check-promotion-main-two"
gh pr merge <P5> --repo "$REPO" --merge --delete-branch=false
e2e_deploy main "deploy-main-promotion-two"
pipeline_check "pipeline-after-second-golive" "$EXPECT/after-second-golive.json"

# Retrofit main into the BUILD stream
git checkout -q integration && git pull -q origin integration
git checkout -q -b retrofit/from-main
git merge origin/main -m "chore: retrofit main into the BUILD stream"
git push -q -u origin retrofit/from-main
gh pr create --repo "$REPO" --base integration --head retrofit/from-main \
  --title "Retrofit main into integration" --body "..."
e2e_check <R> integration "check-retrofit"
gh pr merge <R> --repo "$REPO" --merge --delete-branch=false
e2e_deploy integration "deploy-integration-retrofit"
```

## 4bis. What the DevOps Pipeline must show along the way

A promotion is only half done when the job log is right: the release manager reads the result in
the **DevOps Pipeline** of vscode-sfdx-hardis, and that view has its own way of being wrong. A
story can be carried out of a branch and listed in neither, a counter bubble can disagree with the
list under it, a promotion can be drawn as a feature branch of its own instead of on the arrow of
its step. None of that shows up in a log.

`scripts/check-pipeline.cjs` drives the extension's own `PipelineDataProvider`, so
`listPullRequestsInBranchSinceLastMerge`, the promotion expansion, the single-place invariant and
the mermaid builder all run exactly as they do in the webview, against the real repository. It then
reads the counter bubbles and the merge edges back out of the mermaid it produced, so what it
asserts is the diagram itself.

```bash
# EXT (default ../vscode-sfdx-hardis) and EXPECT (default <WORK>-expect, one small JSON per checkpoint)
# come from env-lib.sh
(cd "$EXT" && yarn compile)                    # tsc layout, so the script can require the modules
pipeline_check "pipeline-before-p1" "$EXPECT/before-p1.json"
```

An expectations file names only what that point of the run pins down:

```json
{
  "label": "before the integration -> uat promotion",
  "windows": { "integration": [1, 2, 3], "uat": [], "preprod": [], "main": [] },
  "arrows": { "integration>uat": null },
  "noFeatureNodeFor": []
}
```

`windows` is the User Stories a branch node lists, order free. `arrows` is the number of the open
Pull Request drawn on a merge edge, `null` for "nothing drawn there". `counters` pins a counter
bubble when it must be checked against something other than the list. `noFeatureNodeFor` names a
branch that must not get a node of its own. `promotionSteps` (`["uat>preprod"]`) pins the steps the
pipeline offers **Create promotion** on, which is how the restricted `allowedPromotionSteps` case of
section 6 is checked in the view: the pipeline reads the config from the working tree, so the
narrowed file does not have to be committed for that half of the case.

Three things are asserted at every checkpoint, expectations or not: a Pull Request number is listed
in one branch and one only, every counter bubble equals the length of the list under it, and the
diagram parses.

| Checkpoint                     | When                                                        | What it proves                                                                                                                                                                                                                        |
|--------------------------------|-------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `pipeline-before-p1`           | after the BUILD stream is merged, before P1                 | the stories wait in the branch they were merged into, the downstream branches are empty, and no promotion is drawn on any arrow                                                                                                       |
| `pipeline-p1-open`             | after `promotion:create`, before the merge                  | the open promotion is drawn **on the `integration -> uat` arrow**, gets no branch node of its own, and takes nothing out of `integration` yet: a promotion only moves a story once it is merged                                       |
| `pipeline-after-p1`            | after the merge and the deployment                          | S1 and S3 are listed in `uat`, gone from `integration`, which keeps S2 alone, and the arrow is empty again                                                                                                                            |
| `pipeline-before-p3`           | before promoting a story that arrived through P1            | a story a promotion carried is offered by the branch it reached, so what the pipeline lists and what `promotion:create` offers are the same set                                                                                       |
| `pipeline-after-golive`        | after the `preprod -> main` promotion is merged             | every promoted story is listed in `main`, none of them twice, and the counters of the branches it left went down                                                                                                                      |
| `pipeline-after-second-golive` | after a second `preprod -> main` promotion carrying S7 only | P4 is in no window any more, and S3, S4, S6 still come back in neither `preprod` nor `uat`: `uat` lists S1 and S5, `main` lists S7. The merged promotions of each step are read from the provider, not from the windows (issue #2260) |

The extension needs its provider token, which it reads from a secret named after the remote host:
dots replaced by underscores, uppercased, plus `_TOKEN`. On `gitlab.hardis-group.com` that is
`GITLAB_HARDIS-GROUP_COM_TOKEN`, a name a shell cannot export, so the script takes the token in
`PROVIDER_TOKEN` and files it under the right name itself. `pipeline_check` passes the token the
rest of the library is already using.

> The check builds a **cold** cache on every call (an in-memory `Memento`), because a stale answer
> here would look exactly like the defect being hunted. Do not add a persistent store to it.

## 4ter. What the single Pull Request modal shows, merged Pull Requests included

The DevOps Pipeline opens a modal on one Pull Request with four tabs: **Deployment Actions**,
**Validation**, **Code Quality** and **Deployment**. A comment can exist on the provider and still not
show there, and nothing else in this runbook would notice: the job logs and the comment audit (5bis)
read the provider, never the modal. Merged Pull Requests are the case to watch: the modal of a story
opened from the branch it reached, weeks after its merge.

The extension reads none of these comments itself. For the three run tabs and the status column of
Deployment Actions it runs `sf hardis:project:action:list --with-status --pr-ids N --with-workflows
--workflow-pr-ids N --json`, with **only the provider token** in the environment
(`collectProviderCredentialEnvVars`: `GITHUB_TOKEN`, `CI_SFDX_HARDIS_GITLAB_TOKEN`...; no
`GITHUB_REPOSITORY`, no `CI_PROJECT_ID`). The action list of Deployment Actions comes from its own
`completePullRequestsWithActions(..., { fetch: true })`: the actions file of the source branch of an
open Pull Request, of the target branch of a merged one.

`scripts/check-pr-modal.cjs` makes those same calls for every open and merged Pull Request of the
repository and compares them with the provider:

```bash
PROVIDER=github REPO="$REPO" WORK="$(cygpath -m "$WORK")" DEV="$DEV" EXT="$EXT" \
  node .claude/skills/promotion-branches-e2e/scripts/check-pr-modal.cjs --json "$(cygpath -m "$LOGS")/pr-modal.json"
# GitLab: PROVIDER=gitlab GL_HOST GL_TOKEN PROJECT_ID instead of REPO
# Azure DevOps: PROVIDER=azure AZ_ORG AZ_PROJECT AZ_REPO_ID AZ_TOKEN instead of REPO
# Bitbucket: PROVIDER=bitbucket BB_WORKSPACE BB_REPO BB_EMAIL BB_TOKEN instead of REPO
# or, with promotion-provider.sh sourced for any of the four:
p_pr_modal_check --json "$(cygpath -m "$LOGS")/pr-modal.json"
```

The comments are read the way the CLI reads them: GitHub issue comments, GitLab notes without the
system ones, the comments of every Azure DevOps thread (deleted threads and deleted comments left out:
`getThreads` still returns them), the Bitbucket Pull Request comments (`content.raw`, deleted ones left
out). The token is passed the way the extension passes it: `GITHUB_TOKEN`,
`CI_SFDX_HARDIS_GITLAB_TOKEN`, `CI_SFDX_HARDIS_AZURE_TOKEN` plus `SYSTEM_ACCESSTOKEN`, or
`CI_SFDX_HARDIS_BITBUCKET_TOKEN` plus `CI_SFDX_HARDIS_BITBUCKET_EMAIL`, and the CLI finds the
repository from the git remote.

| Tab                | Expected                                                                                                                                                                                                                                    |
|--------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| all three run tabs | the CLI answers, with an array for the Pull Request. No answer, or no entry for it, **hides** the three tabs instead of showing them empty, so a provider read that failed looks like "nothing to show"                                     |
| Validation         | one run per comment whose message key starts with `deployment-check-`, with the status of its `run-summary` marker when it has one                                                                                                          |
| Deployment         | one run per comment whose message key starts with `deployment-` (not `-check-`), same status rule                                                                                                                                           |
| Code Quality       | one run per MegaLinter comment (`<!-- megalinter:` or its title). The simulators post none, so it is only exercised by the CI section                                                                                                       |
| Deployment Actions | every cell of the "Status by org" table of the Deployment Actions comment is a status of the CLI (action id, org branch); the cells of the target branch are the pills of the modal; the list of a story equals the ids of its actions file |

It prints one line per Pull Request, with a note for a Pull Request merged into a major branch with no
deployment comment at all (a job side gap, not a modal one: section 6sexies merges stories it never
deploys on purpose). One CLI start costs 20 to 40 seconds here, so run it once, at the end of the
sections that share the repository, and on the CI repository of 6quinquies, whose comments come from
real jobs. What it does not cover: the rendering of the tabs (the LWC unit tests), and the modal of a
promotion or major-to-major Pull Request, whose action list is assembled from the stories it carries.

## 5. What to assert in each log

| Job                                            | Assertion                                                                                                                                                                                                                                                                                            |
|------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| feature branch validation / deployment         | `Pull Request scope: 1 Pull Request(s) (#N)` and nothing else                                                                                                                                                                                                                                        |
| a Pull Request declaring `NO_DELTA`            | `Delta deployment has been disabled for this Pull Request`, `Deployment mode: FULL`                                                                                                                                                                                                                  |
| a Pull Request declaring `PURGE_FLOW_VERSIONS` | an extra pre-deploy action `Purge Flow Versions (added from PR config)`                                                                                                                                                                                                                              |
| any validation job                             | manual actions are `Skipping ...: deployment-only action`, command actions run                                                                                                                                                                                                                       |
| promotion validation / deployment              | `Promotion branch <name> (Pull Request N): X Pull Request(s) declared in its description`, then `Pull Request scope` = declared + the promotion itself                                                                                                                                               |
| promotion carrying a story with a keyword      | `Inherited <KEYWORD> from carried Pull Request(s) #N`, and **no** keyword of a story that was left behind                                                                                                                                                                                            |
| promotion carrying test classes                | `Test classes selected from PRs:` lists the union of the carried Pull Requests, `Final test level: RunSpecifiedTests`                                                                                                                                                                                |
| promotion deployment                           | the "Deployment Actions" comment of each **story** Pull Request gains a column for the target org branch, not the promotion Pull Request                                                                                                                                                             |
| promotion carrying a promotion                 | the story of the inner promotion is in the scope with its actions and test classes: `Promotion Pull Request N adds X carried Pull Request(s)` appears once per level                                                                                                                                 |
| `promotion:create` / `list-candidates` listing | **one candidate row per User Story**, whatever brought it into the source branch. A sync merge (`integration -> uat`) and a promotion merged into its target are opened up into the commits they brought in, so no row groups a whole promotion window, and each row names its own Pull Request only |
| retrofit validation / deployment               | the go-live promotion is expanded, then `Pull Request N was already deployed through promotion branch(es) ...` for each story already shipped                                                                                                                                                        |
| release notes of the go-live                   | `hardis-report/release-notes/main-<date>/release-notes-main-<date>.md` lists the **User Stories**, not the promotion Pull Requests: the Pull Request count, the contributor counts and the ticket rows must name the stories only. With `--include-promotions`, the vehicles are listed next to them |

## 5bis. Auditing the Pull Request comments

The job logs say what the command decided; they do not say what the reviewer ends up reading.
`scripts/audit-pr-comments.cjs` checks the comments themselves, and it is where three defects of
the 2026-09-08 runs came from. Each `e2e-lib-*.sh` provides `dump_pr_comments`, which writes the
provider agnostic shape the auditor reads:

```bash
dump_pr_comments "$LOGS/comments.json"
node .claude/skills/promotion-branches-e2e/scripts/audit-pr-comments.cjs \
  "$LOGS/comments.json" "$LOGS/comments-expect.json"
```

The expectations file is optional and only says what each Pull Request should have reached:

```json
{ "1": { "kind": "story", "manualActions": ["e2e-manual-1"] },
  "7": { "kind": "promotion", "carries": [1, 3] } }
```

`kind` is `story`, `promotion`, or `promotion-not-run` for a promotion that was assembled to prove
the supersede path and never validated. Everything else is checked without being told: one comment
per kind (a re-run updates in place, it never appends a second one), no leaked `undefined`, `null`,
`[object Object]` or uninterpolated `{{placeholder}}`, a navigation block that links to comments of
**this** Pull Request, one column and one pending checkbox per org branch, no manual action left
`skipped`, no duplicated action row, and a promotion that names every story it carries.

Run it at the end of the run, and read its findings against what the run did: a comment written by
a job that ran BEFORE a fix landed keeps its old text until a job touches that Pull Request again,
and the flag-off passes deliberately run the pre-fix `origin/main` CLI.

## 5quater. Looking at the comments as the provider draws them

The audit of 5bis reads the markdown source of a comment. It cannot see what the provider makes of
it: a table left as rows of pipes, a `<details>` block printed as text, a checkbox drawn as `[ ]`,
a banner image that does not load, a table wider than the comment. Each provider has its own
markdown, and the same source does not draw the same way on the four.

`scripts/check-comments-visual.cjs` opens one comment of every type the run produced, the longest
of each, takes a picture of it as shown and another one with every folded section opened, and
compares its DOM with its source:

```bash
dump_pr_comments "$LOGS/comments.json"
node .claude/skills/promotion-branches-e2e/scripts/check-comments-visual.cjs \
  "$(cygpath -m "$LOGS")/comments.json" "$(cygpath -m "$LOGS")/visual"
# GitHub: REPO in the environment; GitLab: GL_HOST, GL_TOKEN and PROJECT_PATH
# --per-type 2 for two comments of each type, --only validation for one family
```

| Type                                   | What it is                                                              |
|----------------------------------------|-------------------------------------------------------------------------|
| `validation-success`, `-failed`        | the comment of the validation job, by verdict                           |
| `...+manual`                           | the same carrying manual actions and their checkboxes (the gate)        |
| `...+conflict-markers`                 | the validation stopped by the marker guard                              |
| `deployment-success`, `-failed`        | the comment of the deployment job, with `+manual` too                   |
| `deployment-actions`, `+manual`        | the Deployment Actions comment and its "Status by org" table            |
| `backpromotes`                         | the Backpromotes history comment (backpromote repository)               |
| `code-quality`                         | a MegaLinter comment, when a job posted one                             |
| `promotion-description`, `+conflicts`  | the description of a promotion Pull Request                             |
| `other-<message key>`                  | any other sfdx-hardis comment                                           |

A type the run did not produce is not checked: say so in the report (a run with no failed
validation has no `validation-failed` picture).

How the comment is drawn, by provider:

| Provider        | `--render` | How                                                                                                                              |
|-----------------|------------|----------------------------------------------------------------------------------------------------------------------------------|
| Azure DevOps    | `page`     | the real Pull Request page, in a Chrome with remote debugging, logged in. Azure has no markdown API                               |
| Bitbucket Cloud | `page`     | the same                                                                                                                         |
| GitHub          | `api`      | the HTML of `POST /markdown` (the renderer of the comments), in a headless Chrome. No session. `--render page` works when logged in |
| GitLab          | `api`      | the HTML of `POST /api/v4/markdown` with the project, in a headless Chrome. No session                                           |

The Chrome of `--render page` is one started for the test, never the user's own:

```bash
chrome --remote-debugging-port=9222 --user-data-dir=<a folder of its own> --no-first-run
```

Then the person logs in to Azure DevOps and Bitbucket in it, once: the profile keeps the sessions.
The script only opens Pull Request pages of the test repositories and reads them. `E2E_CDP_URL`
(or `--cdp`) when the port is another one. The window stays open during the run.

Each line is `V | OK / WARN / FAIL | type | Pull Request | picture | what is wrong`. FAIL: the
comment is not on the page, markdown or HTML source is left as text outside code blocks, fewer
tables, folded sections or checkboxes drawn than the source holds, an image not loaded. WARN: a
table or a code block wider than the comment.

**Then read every picture.** The DOM check says the markup was understood, not that the comment
reads well. In each picture, folded and unfolded:

- the banner image is there and the verdict is the first thing read;
- every table has its header row, no column is squeezed to one word per line, no cell is empty that
  should not be;
- status icons and emoji are drawn, not printed as `:name:`;
- checkboxes are boxes, on the line of their action;
- folded sections show their summary line folded, and their content once opened;
- code and command output sit in a code block, long lines do not push the comment wider;
- nothing overlaps, nothing is cut at the right edge;
- the navigation line links the other comments and marks the current one.

Traps:

- **A provider page keeps bars stuck to the top and paints only what its window shows.** The script
  hides the fixed and sticky elements before the picture and makes the window as tall as the
  comment: without the first, the top of the comment is covered; without the second, the bottom of
  a long unfolded comment is blank (Azure DevOps, 2026-10-08).
- **A comment is found by the words of its source**, among the containers a provider draws
  comments in (`.markdown-content` on Azure DevOps). Looking for whole sentences fails: a provider
  splits a sentence across elements and pads its emoji.
- **`--render api` draws the markup of the provider in a plain frame**, not in its page: it proves
  the markdown, the tables and the folds, not the width of the real comment column.
- **Not logged in looks like "comment not found"**: the line names the page that was reached.

## 5ter. Deployment action state from the git provider

Check the deployment action state from the git provider too:

```bash
gh api "repos/$REPO/issues/1/comments" --jq '.[] | select(.body | contains("Deployment Actions")) | .body'
```

The "Status by org" table must have one column per org branch the story reached, and one
pending manual checkbox per org branch.

## 6. Edge cases to run at the end

| Case                                   | How                                                                                                                                                                           | Expected                                                                                                                                                                                                                                                                                                                                                                                                  |
|----------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Already promoted                       | `e2e_promote uat 4 ...` after the `uat -> preprod` promotion is merged                                                                                                        | the candidate table shows `Already promoted by promotion/uat/preprod/...`, a warning names `--include-already-promoted`, no branch created                                                                                                                                                                                                                                                                |
| Empty cherry-pick                      | same with `--include-already-promoted`                                                                                                                                        | `Nothing to cherry-pick ...: this change is already in the target branch`, branch undone, tree clean, **exit 0**. Not a conflict                                                                                                                                                                                                                                                                          |
| Empty cherry-pick, dirty report folder | the same while `hardis-report/` is untracked                                                                                                                                  | identical result: the cleanliness check and the emptiness test must both ignore the report directory                                                                                                                                                                                                                                                                                                      |
| Conflict, agent default                | two stories on the shared `CustomLabels` file merged into integration, promote only the second                                                                                | `Cherry-pick conflict on #N (...): the promotion has been undone`, no leftover branch                                                                                                                                                                                                                                                                                                                     |
| Conflict, kept                         | same with `--on-conflict commit-with-markers`                                                                                                                                 | Pull Request created, `hardis-report/promotion-conflicts-prompt-*.md` written, prompt embedded in the description                                                                                                                                                                                                                                                                                         |
| Conflict, kept for all                 | two conflicting stories in the same promotion, no `--on-conflict`, answer "commit this and every following conflict" at the first one                                         | the second conflict is not asked about: the log holds `Applying the conflict handling chosen earlier: commit-with-markers` and both stories are committed with their markers                                                                                                                                                                                                                              |
| Conflict prompt commit message         | read `hardis-report/promotion-conflicts-prompt-*.md` of the run above                                                                                                         | the prompt asks for a commit message whose body carries one line per conflicting file, naming the story, what the target side had, what the story added and what was kept                                                                                                                                                                                                                                 |
| No provider connection                 | unset the provider token, take the GitHub CLI off `PATH`, and run `promotion:create`                                                                                          | since #2236 the command stops with exit 1 and "Promotion branches need the git provider connection", before any branch is created or pushed. The scripted case 35 asserts this                                                                                                                                                                                                                            |
| Pull Request creation refused          | a connected provider that refuses the creation (point the token at a project the branch is not in). Not scripted: the GitHub harness cannot provoke it                        | the branch is still pushed, the warning names **the reason the provider gave** (not "no token"), and a link to the provider's own "new Pull Request" form is printed with the source branch, the target branch, the title and the description already filled in (the branches and the title only when the description is too long for a URL)                                                              |
| Deployment from a promotion branch     | run `deploy:smart` (no `--check`) with the promotion branch checked out, as a push pipeline of that branch would                                                              | the command stops with an error naming the branch and the CI setting to fix (`DEPLOY_BRANCHES` on GitLab). With `--check` it runs normally, and so does a deployment of the target branch after the merge                                                                                                                                                                                                 |
| Marker guard                           | validate that Pull Request                                                                                                                                                    | job fails: `still contains git conflict markers in N file(s): ...`, **and the validation comment of the Pull Request says so**: failure banner, branch, count and the list of files to fix. A red job with no comment is a defect                                                                                                                                                                         |
| Marker guard, solved                   | solve as the prompt says, push, validate again                                                                                                                                | job passes                                                                                                                                                                                                                                                                                                                                                                                                |
| Conflict outside force-app             | make two stories diverge on `NOTES.md` (both sides must hold the file with different content, otherwise git leaves no marker)                                                 | the marker gate still catches it and names `NOTES.md`                                                                                                                                                                                                                                                                                                                                                     |
| Feature off                            | set `enablePromotionBranches: false` in the checked-out tree and validate a promotion Pull Request                                                                            | one informational line, scope = the Pull Request alone, everything else unchanged                                                                                                                                                                                                                                                                                                                         |
| Hand-named branch                      | branch `promotion/hand-made-by-a-human` with a `promotionPullRequests` block in its description                                                                               | warning `starts with promotion/ but does not follow the promotion branch naming ...`, treated as a feature branch, declaration ignored                                                                                                                                                                                                                                                                    |
| Retargeted promotion                   | open a `promotion/uat/preprod/...` branch against `main`                                                                                                                      | treated as an ordinary branch, scope is the Pull Request alone, with a warning naming the mismatch. **The declared stories must not run their actions against production**                                                                                                                                                                                                                                |
| Grouped merge commit                   | promote a candidate whose label lists several numbers (`#7, #6, #4 ...`)                                                                                                      | the command names the numbers nobody asked for **before** cherry-picking, and declares them all                                                                                                                                                                                                                                                                                                           |
| Unreadable declaration                 | declare a Pull Request number that does not exist                                                                                                                             | warning and skip, not a failure                                                                                                                                                                                                                                                                                                                                                                           |
| Story brought in by a sync merge       | merge `integration` into `uat` with an ordinary merge (never a promotion), then `promotion:create --source-branch uat`                                                        | the candidate table has one row per story of the sync, each naming its own Pull Request. **Never one row for the whole window**: promoting one story must not carry the others. Check the assembled branch holds one cherry-pick and the description declares one number                                                                                                                                  |
| Story brought in by a promotion        | after P1 (`integration -> uat`) is merged, `promotion:create --source-branch uat`                                                                                             | same: S1 and S3 are two rows, promoting `3` carries S3 alone and leaves S1 offered in the next run                                                                                                                                                                                                                                                                                                        |
| Two levels of vehicle                  | merge a promotion into `integration`, then merge `integration` into `uat` with an ordinary merge, then promote from `uat`                                                     | the stories under the inner promotion are candidates of their own: the split runs again over what it produced. The row must name the story, never the promotion or the sync                                                                                                                                                                                                                               |
| Vehicle boundary                       | the same run                                                                                                                                                                  | the merge that follows an opened-up vehicle does not swallow it: no candidate row lists the Pull Request numbers of the stories the vehicle carried on top of its own                                                                                                                                                                                                                                     |
| Back-merge from the target branch      | merge `preprod` into `uat` (a major branch merged backwards), then promote from `uat`                                                                                         | the back-merge stays a single row instead of becoming a page of stories already delivered: its commits sit before the merge base, outside the window being listed. On every provider that row is labelled `-`, not with the Pull Request number of the back-merge: its source branch is a major branch, so `dropVehiclePullRequests` takes the number off a vehicle                                       |
| Octopus merge                          | `git merge -m "sync" origin/integration origin/preprod` on `uat`, then promote from `uat`                                                                                     | the merge is left whole: opening up a merge with more than two parents would lose every side but the second one                                                                                                                                                                                                                                                                                           |
| Promotion that cannot be opened up     | the octopus case above, when one of its sides is a promotion branch                                                                                                           | the declaration of the promotion is expanded into the stories it names, then the vehicle number is dropped: the row lists those stories (`#32, #23`) and never the promotion number. Promoting the row carries them all, which the command says before cherry-picking                                                                                                                                     |
| Sync merge inside a story              | merge the major branch into a feature branch, then merge that feature branch                                                                                                  | the candidate lists the story only: the major branch's own Pull Request must not be offered, declared or have its actions run                                                                                                                                                                                                                                                                             |
| Supersede a promotion                  | assemble a promotion, then assemble another one from the same source with the same stories                                                                                    | the confirmation names the open promotion, then the candidate list offers those stories again with no "Already promoted by" mark, and `--include-already-promoted` is not needed                                                                                                                                                                                                                          |
| Branch merged twice                    | merge a feature branch, push a fix on it, merge it again, then promote                                                                                                        | the candidate lists the Pull Request once, never once with its number and once as a "-" row                                                                                                                                                                                                                                                                                                               |
| Full merge after a partial promotion   | promote some stories of a branch, then open an ordinary merge of the whole branch into the same target                                                                        | the stories already promoted are named `already deployed through promotion branch(es)` and their actions skipped, the ones never promoted arrive for the first time and run theirs. Afterwards nothing is left waiting for promotion: the merge base moved                                                                                                                                                |
| Restricted promotion steps             | narrow `allowedPromotionSteps` to the single `uat -> preprod` entry **and commit it on the source branch**, then try `--source-branch integration` and `--target-branch main` | both are refused naming the allowed steps, `--source-branch uat` still works, and the DevOps Pipeline shows **Create promotion** on `uat` only. The config has to be committed: an uncommitted edit makes the cleanliness check fail first, and the tree that counts is the one of the branch `promotion:create` checks out, not the one you edited. Restore the three entries before the rest of the run |
| Promotion steps not declared           | remove `allowedPromotionSteps` from `config/.sfdx-hardis.yml` and run `promotion:create`                                                                                      | the command stops asking for the list and linking to the doc page, before listing anything. Put it back afterwards                                                                                                                                                                                                                                                                                        |
| Two yaml blocks with the same key      | a description declaring `deploymentApexTestClasses` in two separate blocks                                                                                                    | the union of both is selected, the second block does not replace the first                                                                                                                                                                                                                                                                                                                                |
| A committed conflict prompt report     | commit `hardis-report/promotion-conflicts-prompt-*.md` on the promotion branch                                                                                                | the marker gate stays silent: it matches `<<<<<<< ` at the start of a line, and the report only mentions the markers inline                                                                                                                                                                                                                                                                               |
| Single place in the diagram            | section 7bis                                                                                                                                                                  | each promoted number appears in one branch only                                                                                                                                                                                                                                                                                                                                                           |
| Pipeline before and after a promotion  | section 4bis, `pipeline_check` around every promotion operation                                                                                                               | the open promotion is drawn on the arrow of its step and takes nothing out of the source branch until it is merged; afterwards the stories are listed in the branch they reached, the counter bubbles follow, and no story is listed in two branches or in none                                                                                                                                           |
| Counter bubble against its own list    | every `pipeline_check`, no expectations needed                                                                                                                                | the number on a branch node equals the number of User Stories the modal lists under it                                                                                                                                                                                                                                                                                                                    |

## 6bis. Backpromote (Beta)

`hardis:work:backpromote` deploys into a developer's own org what was merged in `integration` since
the last backpromote of that org, with the deployment actions of the merged Pull Requests. It is
tested here on the same repository against **scratch orgs**: a backpromote refuses production orgs
and the orgs of the major branches, which is what `$ORG` is.

What each org already received is **not stored locally**: every Pull Request of a backpromote window
gets a "Backpromotes" comment (`<!-- sfdx-hardis backpromotes -->`) with one row per sandbox name and
org id, and one row per deployment action run there. The command refuses to run without a git
provider token. The default start is the Pull Request merged right after the newest one holding a row
for the sandbox; `--from-pull-request` picks another start. The deployment runs from the branch
`backpromote/integration/<sandbox name>`, which the command checks out and stays on.

It runs after section 4, or on its own right after sections 2 and 3 once the BUILD stream merges of
section 4 are done (`#1`, `#2`, `#3` merged into `integration`).

### Running it on GitHub, GitLab, Azure DevOps or Bitbucket Cloud

The steps below are scripted, provider agnostic, in `scripts/backpromote-setup.sh` and
`scripts/backpromote-steps.sh`. Each provider library defines the hooks `bp_provider_env` (the
variables the CLI reads outside CI), `bp_open` and `bp_merge` (a Pull Request into `integration`) and
`dump_pr_comments`, and sources `scripts/e2e-lib-backpromote.sh`, which holds `e2e_backpromote`,
`e2e_backpromote_json`, `e2e_backpromote_nogit_json`, `backpromote_check`, `backpromote_comment`,
`backpromote_comments_check` and `backpromote_reset_org`.

```bash
# after build-repo.sh and the push of main, integration, uat and preprod to a NEW repository
export PROVIDER=github                                    # or gitlab, azure, bitbucket: picks the library (BP_PROVIDER_LIB)
# plus the repository variables of that library; ORG, DEVHUB, DEVORG, DEVORG2, WORK, LOGS, DEV and
# API come from .env and env-lib.sh (WORK: <temp>/promo-e2e-bp-<provider>)
bash .claude/skills/promotion-branches-e2e/scripts/backpromote-setup.sh   # stories, scratch orgs, developer branch
bash .claude/skills/promotion-branches-e2e/scripts/backpromote-steps.sh   # B0 to B16, C1 to C4, summary
```

Pull Request numbers differ from one provider to the other: the expectation files use `{{S1}}`,
`{{S2}}`..., `{{SANDBOX}}` and `{{BRANCH}}`, replaced by the `BP_VAR_*` variables the steps script
exports. Every number it opens is appended to `$LOGS/bp-vars.sh` as it goes, so a step that failed
can be rerun by hand: source the provider library, `$LOGS/bp-vars.sh`, and call the
`e2e_backpromote_json` / `backpromote_check` pair of that step again. The run state lives in the
Pull Request comments and in the org, not in the shell, so a rerun starts from where the last call
left it. The scratch orgs get the sandbox name `devorg1` with `--sandbox-name` (a scratch org username
gives no readable name, the org id would be used). The two scratch orgs are created once from the Dev
Hub and reset to the base project by the setup of the next run (a developer Dev Hub creates 6 scratch
orgs a day): run the providers one after the other, never in parallel.

### Steps

Each step starts from the state the previous one left. `bp-*.json` is the `--json` document of the
call, asserted with `backpromote_check` against `reference/backpromote/<file>`.

| Step                                    | What                                                                                                                                                                   | Expected                                                                                                                                                                                                                                                                                                                                                                                     |
|-----------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| B0 No token                             | `--plan` and `--auto` with no provider variable                                                                                                                        | `no-token.json`: `blocked` on the `gitProvider` check; the run exits 1 with the same message, before listing anything                                                                                                                                                                                                                                                                        |
| B1 Org of a major branch                | `targetUsername: <DEVUSER>` added to `config/branches/.sfdx-hardis.uat.yml` (not committed), `--plan`                                                                  | `refused-major-org.json`: `blocked`, check `targetOrg` names `uat`                                                                                                                                                                                                                                                                                                                           |
| B1c Parent branch not allowed           | `--plan --parent-branch feature/E2E-105-apex`                                                                                                                          | `refused-parent.json`: `blocked`, check `parentBranch` says "not an allowed parent branch" (only `developmentBranch` and `availableTargetBranches`)                                                                                                                                                                                                                                          |
| B2 Developer Edition org                | `--plan --target-org "$ORG"`                                                                                                                                           | `developer-edition.json`: `ok`, org type `developer`. Since #2239 a Developer Edition org is a dev environment and is accepted. `refused-production.json` (`blocked`, "production") still describes a real production org, which this harness does not have: not covered                                                                                                                     |
| B3 First plan                           | `--plan`, then `--plan --from-pull-request $S1 --run-id <runId>` with `SFDX_HARDIS_PROGRESS_FILE`                                                                      | `plan-first.json`: `ok`, org type `scratch`, `scan.found` false, nothing selected, no window, `S1` `S2` `S3` not backpromoted. `plan-from-s1.json`: window from `S1`, the three resources, the four actions not run yet, every file `missingInOrg`. The progress file holds `history`, `delta`, `retrieve`. The checkout is untouched and clean                                              |
| B4 Run from S1                          | `--auto --from-pull-request $S1 --run-id <runId>`                                                                                                                      | `run-1.json`: `ok`, 3 deployed, `e2e-pre-S1`, `e2e-post-S2`, `e2e-pre-S3` run, `e2e-manual-S1` pending, nothing excluded, comments on `S1` `S2` `S3`, checkout on `backpromote/integration/devorg1` (original `feature/E2E-401-dev`), branch not pushed (no merge). The org holds `E2E_S1..S3`. C1: each Pull Request has one Backpromotes comment with one complete row and its action rows |
| B5 Up to date, manual action            | `--plan`, then `--confirm-action e2e-manual-$S1`                                                                                                                       | `plan-up-to-date.json`: `nothingToDo`, `scan.found` true, the three rows set. `confirm.json`: mode `confirm`. C2: the action row of `e2e-manual-S1` is `success` (one row)                                                                                                                                                                                                                   |
| B6 New story                            | `S4` merged, `--plan`, then `--auto --run-id`                                                                                                                          | `plan-s4.json`: `S4` selected by default, window from `S4`, one item. `run-s4.json`: 1 deployed, comment on `S4`                                                                                                                                                                                                                                                                             |
| B7 Overwrite                            | `E2E_S2` changed in the org, `S5` changes it in integration, `--plan`, then `--auto --on-diff "<S2 file>=git"`                                                         | `plan-diff.json`: the file is `different` (or `pendingInOrg`), three-way (the sandbox has a history), the three versions exist in the cache. `run-overwrite.json`: 1 deployed; the org body is the git version                                                                                                                                                                               |
| B8 Keep org version, then it comes back | `E2E_S3` changed in the org, `S6` changes it, `--auto --on-diff "<S3 file>=org"`, then `--plan`, then `--auto --on-diff "<S3 file>=git"`                               | `run-keep-org.json`: 0 deployed, `E2E_S3` left out as `keptOrg`. C3: the row of `S6` is `partial` with `StaticResource:E2E_S3 (org version kept)`. `plan-left-out.json`: `S6` is the start again, `E2E_S3` flagged `excludedLastTime`. `run-left-out.json`: 1 deployed, the org body is the git version                                                                                      |
| B9 Agent protocol                       | `E2E_S1` changed in the org, `S7` changes it, `--agent --on-diff "<S1 file>=merge"`, solve the markers keeping both lines, run again with `--run-id`                   | `agent-waiting.json`: exit 0, `waitingForMerges`, the file prepared with markers (`<<<<<<<` and `|||||||`: `git merge-file --diff3`, so the base side is visible), prompt file. `agent-done.json`: `ok`, 1 deployed, branch pushed with the merge (`pendingMerges` names the file); the org body holds both lines                                                                            |
| B10 Panel protocol                      | `E2E_S2` changed in the org, `S8` changes it, `--plan`, `--prepare --run-id --on-diff "<S2 file>=merge"`, `--auto` with the markers still there, solve, `--auto` again | `prepare.json`: mode `prepare`, prepared with markers, on the backpromote branch. `conflicts-remaining.json`: exit 1, `conflictsRemaining`, nothing deployed (the org body is untouched). `run-after-merge.json`: `ok`, 1 deployed, pushed; both lines in the org                                                                                                                            |
| B11 Deletion                            | `S9` removes `E2E_S4`, `--plan`, `--auto --skip-destructive`, then `--auto --from-pull-request $S9`                                                                    | `plan-deletion.json` lists the deletion. `run-skip-destructive.json`: 0 deleted, `E2E_S4` left out; still in the org. `run-delete.json` (a redeploy of an already backpromoted Pull Request): 1 deleted; gone from the org                                                                                                                                                                   |
| B12 Excluded item comes back            | `S10` adds `E2E_S5` and `E2E_S6`, `--auto --exclude-metadata StaticResource:E2E_S6`, `--plan`, `--auto`                                                                | `run-exclude.json`: 1 deployed, `E2E_S6` excluded. `plan-excluded-last-time.json`: `S10` is the start again, `E2E_S6` flagged. `run-excluded-back.json`: nothing excluded; `E2E_S6` in the org                                                                                                                                                                                               |
| B13 Dirty tree                          | on `feature/E2E-401-dev` with `NOTES.md` modified, `S11` merged, `--plan`, `--auto`                                                                                    | `plan-dirty.json`: `checkout.clean` false naming `NOTES.md`. `run-dirty.json`: `stashed` true, on the backpromote branch; `git stash list` holds `sfdx-hardis backpromote <runId> from feature/E2E-401-dev`; `git stash pop` on the developer branch brings `NOTES.md` back                                                                                                                  |
| B14 Refreshed sandbox                   | `$DEVORG2` with the same `--sandbox-name devorg1`, `--plan`, `--auto --from-pull-request $S1`                                                                          | `plan-refresh.json`: `scan.found` false, `S1` `S2` `S3` flagged `beforeRefresh`, nothing selected. `run-refresh.json`: the actions run again (another org id). C4: `S1` `S2` `S3` keep one comment each, now with two sandbox rows, and `e2e-pre-S1` has two action rows                                                                                                                     |
| B15 Scan limit                          | `--plan --sandbox-name never-seen --scan-limit 2`                                                                                                                      | `plan-scan-limit.json`: `scan.read` 2, `found` false, `hasMore` true                                                                                                                                                                                                                                                                                                                         |
| B16 Reset                               | `--reset --auto`                                                                                                                                                       | `reset.json`: mode `reset`; the branch is gone from origin                                                                                                                                                                                                                                                                                                                                   |
| B17 Terminal prompts                    | `node "$DEV" hardis:work:backpromote --target-org "$DEVORG"` by hand                                                                                                   | the parent branch (when several are allowed), the start Pull Request, one multiselect of the items and deletions, one decision per file that differs (Overwrite / Keep org version / Merge, or for all remaining), the actions, the manual actions after the run. Not scriptable: say "not covered" when skipped                                                                             |

### What the VS Code panel adds

The Backpromote (Beta) panel of vscode-sfdx-hardis reads the same `--plan --json` document, calls
`--prepare` when the user clicks Merge on an item line, opens the VS Code merge editor on the three
versions the plan gives, and runs `--auto --run-id ... --json` in the background with the progress
file. Its command builder, its greying rules and its marker watch are covered by the extension's unit
tests, and its extension side by `yarn test:ui` against a mocked CLI; this run does not click the
panel. Say so in the report.

### Traps

- **The sandbox name of a scratch org is its org id.** `--sandbox-name devorg1` keeps the branch
  name and the expectations readable; the panel never passes it.
- **A partial row keeps its Pull Request as the default start.** When the newest backpromoted Pull
  Request is `partial`, it is selected again (B8, B12): what it already deployed is deployed again,
  which changes nothing in the org, and the left-out items come back.
- **`git merge-file` conflicts on adjacent lines.** Two changes on consecutive lines with no context
  between them are a conflict for git, even when the lines differ: the story resources are one line,
  so every "both sides changed" case is a conflict, which is what B9 and B10 need.
- **The retrieve preview may not flag a change deployed from this project.** Deploying the changed
  file with `sf project deploy start` from `$WORK` updates the local tracking, so the plan reports
  `different` rather than `pendingInOrg`: the expectations accept both.
- **The sandbox versions are retrieved into a blank sfdx project.** `sf project retrieve start
  --output-dir` refuses a folder outside the project and drops what `.forceignore` excludes inside
  it: the run writes a two-file sfdx project in the temporary folder (`createRetrieveProject`, no `sf project generate` call since 2026-09-13) and
  retrieves there in source format. A `missingInOrg` status for an item that exists in the org
  means that step went wrong.
- **A `--json` run prints nothing on stdout but the document, and nothing at all on stderr.** oclif
  silences `uxLog` when `--json` is passed, so `$LOGS/<label>.log` is empty: the lines of the run
  (the deployment actions among them) are in the sfdx-hardis command log,
  `hardis-report/commands/<timestamp>-hardis-work-backpromote.log`, which is written either way.
- **`hardis-report/` is not gitignored in this project, and every command writes its log there**, so
  `git status --porcelain` is never empty after a backpromote. The command itself ignores the report
  directory when it decides whether the tree is clean (`userChangesOutsideReports`), and the harness
  has to do the same: `git status --porcelain -- . ':(exclude)hardis-report' ':(exclude)hardis-report/**'`.
- **The source format renames the content file of a StaticResource.** The org version of
  `E2E_S2.resource` comes back as `E2E_S2.txt`, named after its `contentType`. A run that sees
  `missingInOrg` for an item that is in the org is looking at that, and the CLI falls back to a
  match by folder and name without the extension. The same trap will bite any other type whose
  retrieved file name differs from the one the repository holds.
- **`SELECT Body FROM StaticResource` gives the REST path of the blob, never its content.** Decoding
  it as base64 produces binary noise. Fetch it: `curl -H "Authorization: Bearer $(sf org auth
  show-access-token ...)" "<instanceUrl><the Body value>"`.
- **The developer branch is cut before the stories are merged**, so `git ls-files` finds none of
  their files while it is checked out. Resolve the story file paths from `origin/integration`, never
  from the working tree: an empty path silently turns `--on-diff "$FILE=git"` into `--on-diff "=git"`,
  the command refuses it, and every later step fails for the wrong reason.
- **A backpromote leaves a history in the Pull Request comments of the repository.** Rerunning
  section 6bis on the same repository with the same `--sandbox-name` makes B3 start from a sandbox
  that is already up to date: rerun it on a **new** repository, and reset the scratch orgs with
  `backpromote_reset_org` (the setup does both).
- **Never `source backpromote-steps.sh`.** It is a script, not a library: sourcing it runs the whole
  section again against whatever state the repository and the orgs are in.
- **sfdx-git-delta runs one at a time.** Parallel runs fail on `could not lock config file .git/config`.
- **GitLab and Azure DevOps know a pushed commit a few seconds later.** The deployment actions file is
  pushed right after the Pull Request is opened: `bp_merge` waits until the provider reports that commit
  as the head of the Pull Request, otherwise the merge leaves the actions out.

## 6ter. Scripted runs and timings

Sections 3, 4 and 4bis are scripted in `scripts/promotion-run.sh`, section 6 in
`scripts/promotion-edge.sh` (groups `g1` to `g6`, in that order, after `promotion-run.sh`). They,
`deployment-actions-run.sh` and `identical-actions-run.sh` run on the four providers through
`scripts/promotion-provider.sh`, which picks the library with `PROVIDER=github|gitlab|azure|bitbucket`:

```bash
export PROVIDER=github REPO=<owner/name>   # GitLab: PROJECT_ID PROJECT_PATH GL_HOST GL_TOKEN (8),
                                           # Azure DevOps: AZ_REPO_NAME (8bis), Bitbucket: BB_REPO (8ter)
# ORG, WORK, LOGS, EXPECT, DEV, API and EXT come from .env and env-lib.sh
bash .claude/skills/promotion-branches-e2e/scripts/promotion-run.sh       # results-section4.txt
bash .claude/skills/promotion-branches-e2e/scripts/promotion-edge.sh g1 g2 g3 g4 g5 g6   # results-section6.txt
bash .claude/skills/promotion-branches-e2e/scripts/deployment-actions-run.sh   # results-section6quater.txt
bash .claude/skills/promotion-branches-e2e/scripts/identical-actions-run.sh    # results-section6sexies.txt
```

The functions the sections call (`p_check`, `p_deploy`, `p_promote`, `p_release_notes`, `p_open`,
`p_merge`, `p_close`, `p_body`, `p_set_body`, `p_cli`, `p_list_candidates`, `p_promote_no_provider`,
`p_wait_merge_ref`, `p_check_edited`, `p_deploy_branch`, `p_pr_modal_check`, plus `dump_pr_comments`
and `pipeline_check` of each library) exist for the four providers, with the same meaning: a merge
is always a merge commit, `p_open` prints the number, `p_merge` prints `merged` once the provider
says so. Nothing in the section scripts tests `PROVIDER` itself. The drafts of section 6quater are
drafts by title (`draft` in it), which every provider reads the same way, so no provider draft API is
needed.

Every Pull Request number they get is appended to `$LOGS/promo-vars.sh`, so a group can be rerun on
its own after a fix.

Every job simulator (`*_check`, `*_deploy`, `*_promote`, `*_release_notes`, `p_list_candidates`) and
every backpromote call appends one line to `$LOGS/timings.tsv` (label, kind, milliseconds, exit code,
start, end). The backpromote calls also get `SFDX_HARDIS_PROGRESS_FILE=$LOGS/progress/<label>.jsonl`
unless the caller set one. Then:

```bash
node .claude/skills/promotion-branches-e2e/scripts/timing-report.cjs "$(cygpath -m "$LOGS")" --title GitHub --json "$(cygpath -m "$LOGS")/timing.json"
```

prints the median and worst time per kind of call, per backpromote step, and the slowest calls.
Read the numbers with these in mind:

- **Use `bin/run.js` with a fresh `yarn compile` for timings**, not `bin/dev.js`: `dev.js` compiles
  TypeScript on the fly and adds seconds to every call that a user never pays.
- **`startup` is 7 to 8 seconds on Windows** for every call (node, oclif and the command imports),
  before the first progress line. It is the floor of any backpromote call.
- **Every Salesforce CLI child process costs 7 to 15 seconds on Windows**, whatever it does: the
  `delta` step is mostly `sf sgd:source:delta`, the `retrieve` step `sf project retrieve start`, and the
  `compare` step of a run whose delta and retrieve came from the caches is the wait for the
  `sf project retrieve preview` started in parallel. The git provider calls (history, actions,
  comments) take one to three seconds on GitHub and on GitLab alike.
- **A retrieve can wait minutes on the Salesforce side** (121 seconds for one static resource on
  2026-09-13): one slow call is the org, not the code, when the same step took 17 seconds before and
  after it.
- Never time two runs at once: they share the CPU, the scratch orgs and the target org.

## 6quater. Deployment actions: gate, recovery, mark as done, forecast

`scripts/deployment-actions-run.sh` runs after `promotion-run.sh` (and `promotion-edge.sh` when you
run it), on the same repository. It adds two stories, then asserts every job log and, through
`scripts/check-action-status.cjs`, the JSON of `sf hardis:project:action:list --with-status`:

| Story | Branch                     | Target      | Actions (`story_actions` kind)                                                                                                          |
|-------|----------------------------|-------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| S8    | `feature/E2E-401-recovery` | integration | `recovery`: pre-deploy manual, post-deploy command failing until `e2e-recovery-ok.txt` exists, the command after it, post-deploy manual |
| S9    | `feature/E2E-402-draft`    | integration | `pre-manual`: a pre-deploy manual action, on a Pull Request with "draft" in its title                                                   |

```bash
export PROVIDER=github REPO=<owner/name>               # the repository variables of the provider, see 6ter
export DEV_ORG=<scratch org username>                   # optional: group D
bash .claude/skills/promotion-branches-e2e/scripts/deployment-actions-run.sh   # results-section6quater.txt
```

| Group | Checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
|-------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| A     | The validation of S8 **stops** (exit 1) right after its pre-deployment actions, before the deployment check, naming the manual action and the `set-status` command; `set-status --org-branch integration` marks it with a "Manual action marked as done by" note; the validation run again skips it and passes; S9 (draft in the title) only warns                                                                                                                                            |
| B     | The deployment of S8 fails on the flaky action and records it `failed`, the two after it `not-run`; `action:run --next all` retries it and runs the stopped ones (note "Run locally by"); `set-status` closes the post manual step; in agent mode a retry in `preprod`, where nothing failed, is refused                                                                                                                                                                                      |
| C     | `set-status --org-branch uat` marks the pre manual action done **ahead** ("before any deployment to uat"); with P6 (integration -> uat, S8 alone) open, `--forecast uat --from-branch integration` names P6, carries S8 and not S2, and forecasts done / runs at deployment / after the merge (post-deployment manual) / not in this promotion; the validation and the deployment of P6 skip the action marked ahead; after the merge the forecast has no promotion and the commands are done |
| D     | With `DEV_ORG`: `action:run --all --dev-org` in a developer org records `dev-sandboxes` and the Backpromotes rows of S8; a second run skips what is "already done in this org"; `--dev-org` refuses the org of a major branch                                                                                                                                                                                                                                                                 |

Traps:

- **The flaky command reads a file of the working copy**, `e2e-recovery-ok.txt`, untracked on
  purpose: `git checkout -f` keeps it, so every job after the retry finds it. Delete it to replay B.
  The script lists it in `.git/info/exclude`: untracked and not excluded, it makes
  `promotion:create` refuse the working copy as not clean (C2).
- **The flaky command is one file per story** (`scripts/e2e/flaky-<pr>.cjs`): a shared file is
  committed by the first story only, and a promotion carrying a later one deploys a command whose
  script never reached the branch.
- **The section declares the org of each major branch** (`targetUsername`, `instanceUrl`, one
  commit on integration), like a real project: without it `--dev-org` cannot tell a major org (D4),
  and `action:run --org-branch` has nothing to check `--target-org` against.
- **`DA_RUN=<n>` replays the section on the same repository** with story branches of their own:
  `DA_RUN=2 bash deployment-actions-run.sh`.
- **B6 passes `--allow-branch-mismatch`**: in agent mode a retry in preprod from the integration
  checkout is refused for the branch first, before the check B6 is about.
- **`p_cli` runs a command the way a person does**, with the provider token and no `CI`: the notes
  then say "Run locally by", and `--agent` is what keeps the commands from prompting.
- The Mark as done buttons, Run in another org and the Next promotion switch of the VS Code panel
  run these same commands (`set-status`, `action:run --select-org`, `action:list --forecast`), but
  the prompts of `--select-org` are not scripted: only the agent paths are.

## 6quinquies. The same features through real CI jobs (GitHub Actions, GitLab CI, Azure Pipelines, Bitbucket Pipelines)

Every other section runs the CI jobs with the simulators of section 1. This one runs them in the CI
of the provider, with the CI files a project gets from `defaults/ci`, in a repository of its own.
`scripts/ci-workflows-run.sh` holds the scenario (W0 to W9, X1, X2) and calls nothing provider
specific but the `ci_*` functions of `scripts/ci-provider-<provider>.sh` (create the repository,
wait for a validation or a deployment job, re-run it, tick a checkbox, read the comments). Its
assertions are the ones of `section-lib.sh`, the same on every provider.

| Provider            | `PROVIDER`  | Status                                                                                                                         |
|---------------------|-------------|--------------------------------------------------------------------------------------------------------------------------------|
| GitHub Actions      | `github`    | run live (2026-10-04, 2026-10-07)                                                                                              |
| GitLab CI           | `gitlab`    | built 2026-10-08, files validated by the CI lint API, never run live yet                                                       |
| Azure Pipelines     | `azure`     | built 2026-10-08, files checked as YAML only (no pipeline existed in the project to preview against), never run live yet       |
| Bitbucket Pipelines | `bitbucket` | built 2026-10-08 with a fallback to the job simulator once the build minutes are used up; file valid against Atlassian's schema, never run live yet |

Every job writes how it ran in `$LOGS/<label>.mode` ("real CI", or "simulated (build minutes used
up)" on Bitbucket), each result line carries it in brackets, and `$LOGS/ci-jobs.tsv` lists the jobs
with the seconds they waited in the queue apart from the seconds they ran. Copy that column into
the report table: a simulated job proves the CLI, not the CI file.

The start is the same on the four providers, nothing else to export when `.env` is filled:

```bash
PROVIDER=<github|gitlab|azure|bitbucket> nohup bash .claude/skills/promotion-branches-e2e/scripts/ci-workflows-run.sh \
  >"${TMPDIR:-${TEMP:-/tmp}}/promo-e2e-ci-$PROVIDER.out" 2>&1 & disown
```

`WORK` and `LOGS` default to `<temp>/promo-e2e-ci-<provider>` and `-logs` (the script stops when
`WORK` exists), and the repository name is picked one past the highest existing one.

A new provider adds `ci-provider-<provider>.sh` (the interface is in the header of
`ci-provider-github.sh`) and a writer in `ci-workflows-prepare.cjs`; the scenario does not change.

### GitHub Actions

```bash
export PROVIDER=github
export REPO=<owner/name>                   # optional: default <GH_E2E_OWNER or the gh login>/sfdx-hardis-promo-e2e-ci-<n>
export SFDX_HARDIS_BRANCH=<branch>         # pushed to hardisgroupcom/sfdx-hardis; default: current
bash .claude/skills/promotion-branches-e2e/scripts/ci-workflows-run.sh   # results-section6quinquies.txt
```

To prove a published release (a beta for instance) rather than a branch, run the jobs in its image
and skip the link step: W0 then asserts the version the job prints.

```bash
export SFDX_HARDIS_BRANCH=- SFDX_HARDIS_IMAGE=ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:beta
export SFDX_HARDIS_VERSION=8.14.1-beta202610062235.0   # npm view sfdx-hardis@beta version
```

Read the version the image really holds before trusting it: its config blob carries
`ARG SFDX_HARDIS_VERSION=...` in its history, and an image built before npm served the beta holds
the previous one.

`scripts/ci-workflows-prepare.cjs` changes two things in `check-deploy.yml` and `process-deploy.yml`:
a step before the sfdx-hardis one clones the branch, builds it and runs `sf plugins link`, so the
jobs run the code under test and not the release of the Docker image; and the four
`SFDX_AUTH_URL_<BRANCH>` secrets, set from `sf org display --verbose` of `ORG`, log in without the
JWT connected app a real project uses. Actions stay off while the major branches are pushed, so the
base project is never deployed by CI.

| Check | What                                                                                                                                                                                                                                                                                  |
|-------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| W0    | The job runs sfdx-hardis linked from the branch (`sf plugins` lists it as `(link)`)                                                                                                                                                                                                   |
| W1    | The validation of C1 (`recovery` actions) stops on its pre-deployment manual action; the Pull Request comment says why and shows its checkbox                                                                                                                                         |
| W2    | The checkbox ticked in the comment through the API, **Re-run all jobs**: the job records the action as done and passes                                                                                                                                                                |
| W3    | C2, opened as a GitHub **draft** with no "draft" in its title, is only warned: the draft flag comes from the provider                                                                                                                                                                 |
| W4    | The deployment job after the merge: the flaky command fails and stops the next ones, the manual action done is skipped; statuses read back with `action:list`                                                                                                                         |
| W5    | C3 brings the file the flaky command needs. The promotion integration -> uat (C1, C3) stops in validation until the manual action is done in uat; the forecast says waiting before the merge, after the merge for the post-deployment manual step, runs at deployment for the command |
| W6    | `set-status --org-branch uat` (what **Mark as done in uat** runs), the validation re-run skips it and passes, the forecast says done                                                                                                                                                  |
| W7    | The deployment of the promotion runs the commands with the fix that travelled with it; the post-deployment manual step waits in uat                                                                                                                                                   |
| W8    | A workflow without the `safe.directory` line (a project that copied the templates before it): git refuses the checkout, the job stops and names the line to add                                                                                                                       |
| W9    | C5 and C6 carry the same post-deployment command (section 6sexies). Each merge into integration is a job of its own and runs its copy; the deployment job of the promotion carrying both to uat runs it once, and C6 is `success` in uat with the "Not run twice" note                |
| X1    | `p_pr_modal_check` (section 4ter) on the CI repository: the modal tabs show the comments posted by the real jobs, merged Pull Requests included                                                                                                                                       |
| X2    | `pipeline_check` (section 4bis): uat lists C1, C3, C5 and C6, integration lists nothing (C2 and C4 are closed), no open promotion on the arrows                                                                                                                                       |

W3 also records W3a: the provider itself flags C2 as a draft. W8 is GitHub only (recorded as SKIP
on GitLab, whose template has no `safe.directory` line to remove).

Traps:

- The login of a CI job reads the org of its branch from `config/branches/.sfdx-hardis.<branch>.yml`:
  without `targetUsername` (and `instanceUrl`) it stops with "You may have to define
  targetUsername", which the simulators never show because they pass `--target-org`. The script
  appends both to the four branch configs.
- The auth URL comes from `sf org auth show-sfdx-auth-url`: `sf org display --verbose` now prints
  a redacted placeholder in its place, and secrets set from it make every login fall through to
  JWT. The script refuses a value that does not start with `force://`.
- A rerun keeps its run id: `gh run rerun` then wait on the same id, and `gh run view --log` reads
  the latest attempt.
- A `pull_request` run is listed under the head commit of the Pull Request, a `push` run under the
  merge commit: `gh run list --commit` finds both.
- The link step takes three to four minutes per job (install and `tsc`): the section is about
  30 runs long with W9, so count 70 to 80 minutes (2026-10-04: 72). It runs on GitHub's runners and
  outlives the two-hour limit of a tracked background command: launch it with `nohup ... & disown`
  and wait for its last line with a polling loop.

### GitLab CI

The project is created inside a group whose runners take the jobs: never in a personal namespace,
which has no runner. The host and the group come from the environment, else from the `.env` of the
sfdx-hardis working copy (git-ignored):

```bash
# .env: GITLAB_E2E_HOST=<host>   GITLAB_E2E_GROUP=<group/path>
export PROVIDER=gitlab
export SFDX_HARDIS_BRANCH=<branch>             # default: current; or - with SFDX_HARDIS_IMAGE
# optional: GL_TOKEN (default: glab config get token --host <host>), GITLAB_E2E_PROJECT,
# GITLAB_E2E_CI_TOKEN=project|user, GITLAB_RUNNER_TAG (default ubuntu),
# CI_WAIT_APPEAR_SECONDS (600), CI_WAIT_JOB_SECONDS (3600)
nohup bash .claude/skills/promotion-branches-e2e/scripts/ci-workflows-run.sh >"${TMPDIR:-${TEMP:-/tmp}}/promo-e2e-ci-gitlab.out" 2>&1 & disown
```

What `ci-provider-gitlab.sh` does, in order:

1. Before anything is built (`ci_provider_init`): resolves the group, checks that one of its online
   runners takes jobs tagged `GITLAB_RUNNER_TAG` (the group runners of the test group carry
   `ubuntu`, `centos` and `cloudity` and do not take untagged jobs; the template jobs carry
   `ubuntu`), and picks `sfdx-hardis-promo-e2e-ci-gl-<n>`, one more than the highest of the group.
2. `ci-workflows-prepare.cjs --provider gitlab` writes `.gitlab-ci.yml` with a `before_script` on
   `check_deploy_to_target_branch_org`, `check_deploy_to_current_branch_org` and `deploy_to_org`
   only (clone, build, `sf plugins link`, back to `$CI_PROJECT_DIR`, `sf plugins`), and
   `.gitlab-ci-config.yml` with `DEPLOY_BRANCHES: /^(integration|uat|preprod|main)$/` (the default
   regex has no `uat`) and `USE_SCRATCH_ORGS: "false"` (no Dev Hub: the scratch org jobs would
   fail). `check_quality` stays: its script is `true`, it only pulls the MegaLinter image.
   `--bundle <file>` also writes both files as one document for the CI lint API.
3. Creates the private project: merge commits, never squash, merge not blocked by pipelines.
4. Stores `SFDX_AUTH_URL_INTEGRATION`, `_UAT`, `_PREPROD` and `_MAIN` as project CI/CD variables,
   **not protected** (a protected variable only reaches pipelines of protected branches, and the
   validation job runs in the merge request pipeline of a feature branch), masked when GitLab
   accepts the value, raw (no `$` expansion).
5. Creates a project access token (api, write_repository, Maintainer, 7 days) and stores it as
   `CI_SFDX_HARDIS_GITLAB_TOKEN`, the variable `src/common/gitProvider/gitlab.ts` reads first, as
   a real project does. The commands run locally (set-status, promotion:create, action:list) use
   `GL_TOKEN`, so notes written by the bot are edited by the person and the other way round, which
   GitLab allows a Maintainer or Owner. `GITLAB_E2E_CI_TOKEN=user` stores `GL_TOKEN` instead (when
   the group refuses project access tokens, the script falls back to it on its own and says so).
6. Pushes `main` and the major branches with `-o ci.skip` (no deployment of the base project), the
   token in an `http.extraHeader` of the local clone only (the remote URL stays clean for the
   extension), then lints the CI files through `GET /projects/:id/ci/lint`, include resolved, and
   stops when they are invalid or select no `deploy_to_org`.
7. Waits on real pipelines: the validation is the job `check_deploy_to_target_branch_org` of the
   newest pipeline of `GET /merge_requests/:iid/pipelines` for the head commit, the deployment is
   `deploy_to_org` of `GET /pipelines?ref=<branch>&sha=<merge commit>&source=push`. W2 and W6 retry
   the job (`POST /jobs/:id/retry`, the Retry button). Job traces go to `$LOGS/<label>.log`
   without ANSI colors, carriage returns or `section_start` markers, so the patterns of W0 to W9
   match as on GitHub. A pipeline that never comes, or ends without the job, writes the reason in
   the log and exit code 9.

The ids are in `$LOGS/ci-vars.sh` (`PROJECT_ID`, `PROJECT_PATH`, `GL_HOST`, C1 to C6, CP1, CP2):
source it, then `e2e-lib-gitlab.sh`, to rerun one check by hand. Cleaning it up: section 9.

Expected durations, to confirm on the first run: the link step is three to four minutes on GitHub's
runners and unknown on the group runners (first pull of the sfdx-hardis image, `yarn install`
through the corporate network). About 20 jobs: count 70 to 100 minutes, more when the runners are
busy with other projects. Launch it with `nohup ... & disown`, as on GitHub.

Traps, known before the first run:

- **No merged results pipelines.** The instance is GitLab CE (`GET /version` says
  `enterprise: false`), so a merge request pipeline is a detached pipeline on the head of the source
  branch, not on its merge with the target. The merge-ref lag of section 8 does not bite the real
  jobs; it still bites the local calls of the library.
- **The draft of GitLab is the title.** There is no draft flag to set apart from the `Draft:`
  prefix, so W3 cannot prove, as on GitHub, that the flag alone is read: W3a checks that the API
  says `draft: true`, W3 that the job only warns.
- **Message keys carry the job name** (#2307): the job names of the template are the ones the
  simulators set in `CI_JOB_NAME`, so X1 reads the same keys.
- **Emoji in notes**: the provider file reads every answer through node as UTF-8, never through
  python on stdin (section 8).
- **Auto-cancel of redundant pipelines** (on by default, and the jobs are `interruptible`): the
  pipeline of the first push of a story is cancelled by the push of its actions file. The script
  waits on the pipeline of the last head, never the first.
- **Lint a local include.** `POST /projects/:id/ci/lint` with `content` resolves `include: local`
  against the repository of that project, not against the content: lint the `--bundle` file, or
  lint the pushed files with `GET /projects/:id/ci/lint`, as the script does.

### Azure Pipelines

Built on 2026-10-08, never run live. The organization has the free tier: one Microsoft-hosted
parallel job for private projects and 1800 minutes a month, a job stopped at 60 minutes. The builds
of a run queue one after another, so every wait tolerates the queue.

```bash
# .env: AZ_ORG=<organization>  AZ_PROJECT=<team project>  AZURE_PERSONAL_ACCESS_TOKEN=<PAT>
export PROVIDER=azure
# optional: AZ_REPO_NAME (default sfdx-hardis-promo-e2e-ci-az-<n>), AZURE_E2E_CI_TOKEN=system|pat,
# CI_WAIT_APPEAR_SECONDS (900), CI_WAIT_QUEUE_SECONDS (10800), CI_WAIT_JOB_SECONDS (3600),
# CI_WAIT_REQUEUE_SECONDS (300)
nohup bash .claude/skills/promotion-branches-e2e/scripts/ci-workflows-run.sh >"${TMPDIR:-${TEMP:-/tmp}}/promo-e2e-ci-azure.out" 2>&1 & disown
```

The PAT needs Code (Read, write & manage), Pull Request Threads (Read & write) and Build (Read &
execute). With Security (Manage) too, the run grants the build service its permission by itself.

What `ci-provider-azure.sh` does, in order:

1. Before anything is built (`ci_provider_init`): reads the project id, checks that
   `GET _apis/pipelines` answers (the Build scope), picks `sfdx-hardis-promo-e2e-ci-az-<n>`.
2. `ci-workflows-prepare.cjs --provider azure` writes `azure-pipelines-checks.yml` and
   `azure-pipelines-deployment.yml` at the root of the repository: the templates plus a step
   `E2E ONLY - sfdx-hardis from <branch>` before the sfdx-hardis one (`set -e`, clone, build,
   `sf plugins link`, `sf plugins`), the four `SFDX_AUTH_URL_<BRANCH>: $(SFDX_AUTH_URL_<BRANCH>)`
   lines in its env block (a secret variable never reaches a script unless it is mapped),
   `trigger: none` in the checks file, a CI trigger on the four major branches and `pr: none` in
   the deployment file. These triggers are what the setup comments of the templates ask to set by
   hand in the UI. The MegaLinter job is left out: with one parallel job it would double the queue
   and the minutes. The files are parsed back as YAML and checked before the script ends.
3. Creates the repository, pushes `main` and the major branches. No pipeline exists yet, so nothing
   runs. The PAT sits in an `http.extraHeader` of the clone, the remote URL stays clean.
4. The token of the jobs. `AZURE_E2E_CI_TOKEN=system` (default): the templates pass
   `$(System.AccessToken)` as `SYSTEM_ACCESSTOKEN` and `CI_SFDX_HARDIS_AZURE_TOKEN`
   (`azureDevops.ts` reads `CI_SFDX_HARDIS_AZURE_TOKEN`, then `SYSTEM_ACCESSTOKEN`, then
   `AZURE_DEVOPS_EXT_PAT`). That token is the identity `<project> Build Service (<organization>)`,
   which on 2026-10-08 only has Read and Create tag on the repositories of the test project: it
   cannot post a Pull Request thread. The script reads its descriptor from the access control list
   of the project repositories (`Microsoft.TeamFoundation.ServiceIdentity;<id>:Build:<project id>`;
   the first id is NOT the `instanceId` of `connectionData`) and grants it Contribute and
   Contribute to pull requests on the new repository
   (`POST _apis/accesscontrolentries/<Git Repositories namespace>`). When the PAT may not, it says
   so and goes on: allow it once by hand for all repositories (Project settings > Repositories >
   Security > that identity > Contribute to pull requests: Allow), and every later repository
   inherits it. `AZURE_E2E_CI_TOKEN=pat` stores the PAT as the secret variable
   `CI_SFDX_HARDIS_AZURE_TOKEN` instead and maps it in the YAML: no permission to grant, and the
   comments are the PAT user's.
5. Creates the two pipeline definitions (`POST _apis/pipelines`, configuration `yaml`, the path of
   each file), then puts the four logins on each as secret variables
   (`PUT _apis/build/definitions/<id>`; the values go through a file removed right after).
6. Previews both (`POST _apis/pipelines/<id>/preview`, `previewRun: true`): Azure expands the YAML
   and answers the final document or the error a run would stop on. Nothing is queued.
7. Creates a build validation policy on `integration`, `uat`, `preprod` and `main`
   (`POST _apis/policy/configurations`, type `0609b952-...`, not blocking, queued again on a push to
   the source branch only), so the checks pipeline runs on every Pull Request.
8. Waits. The validation is the build of the checks definition whose `triggerInfo` names the Pull
   Request and its head commit (`pr.number`, `pr.sourceSha`); the deployment is the build of the
   deployment definition on the merge commit. A build of the same Pull Request for an older head is
   cancelled: it would hold the single parallel job. No build after `CI_WAIT_REQUEUE_SECONDS`: the
   policy is queued again (`PATCH _apis/policy/evaluations/<id>`), which is also what W2 and W6 do
   to re-run a validation. Step logs are joined into `$LOGS/<label>.log` without timestamps nor
   colors. Each line says `queued <n>s, ran <n>s`.

The ids are in `$LOGS/ci-vars.sh` (`AZ_REPO_NAME`, `AZ_REPO_ID`, `AZ_CHECK_DEF_ID`,
`AZ_DEPLOY_DEF_ID`). About 20 builds of 8 to 12 minutes, one at a time: count three to four hours,
and 200 to 250 of the 1800 monthly minutes.

What the first live run proved (2026-10-08, `AZURE_E2E_CI_TOKEN=pat`):

- **The preview** validates both generated files, and the PAT creates definitions, sets their
  secret variables, cancels and reads builds.
- **The free parallel job exists**: a build leaves the queue in 6 to 13 seconds and runs 5 to 7
  minutes, link step included (about 80 seconds of `yarn install`).
- **A container job does not run as root, and the image keeps the plugins in a folder of root**
  (`SF_DATA_DIR=/usr/local/lib`): `sf plugins link` answers `EACCES: permission denied, open
  '/usr/local/lib/package.json'`. The link runs through `sudo`, which the image ships for the
  Azure agent, with `HOME=/root`: with the HOME of the step user, root creates `~/.sf` and the next
  `sf` command of the job dies on `EACCES ... .sf/sf-<date>.log`.
- **`triggerInfo` has no `pr.sourceSha`**, and a policy build runs on the merge commit of
  `refs/pull/<id>/merge`. The head a build validates is a parent of that merge commit
  (`GET commits/<sourceVersion>`), which is how `_azci_find_build` matches it.
- **Azure cancels by itself the build of a previous head** ("canceled by
  Microsoft.VisualStudio.Services.TFS") when a push or a re-queue of the policy comes: opening a
  story and pushing its actions file gives two builds, the first one cancelled within seconds. A
  wait that takes the newest build of the Pull Request reads that cancelled one. `_azci_wait_build`
  follows the newer build of the same commit when the one it watches is cancelled.
- **Drafts get their policy build** like any Pull Request.

The system token (`AZURE_E2E_CI_TOKEN=system`, the default of the templates), run on 2026-10-09
once "Contribute to pull requests" was allowed by hand to `<project> Build Service
(<organization>)` (the PAT of `.env` cannot grant it, HTTP 401):

- W0, W1 and W1b pass: the build service posts the comments.
- **W2 fails, and it is a finding of the product, not of the harness.** Azure DevOps answers
  "Only the comment author and project admins can edit a comment" (HTTP 403) to the person who
  ticks the checkbox of a comment the build service wrote, and to `set-status` run by that person,
  which has to update the Deployment Actions comment. Before 2026-10-09 `set-status` said "recorded
  as done" all the same; it now stops with the reason. So with the job token of the templates, the
  manual action gate can only be closed by a project administrator or with the token of the jobs.
  The scenario cannot go past W2 in that mode: W3 to W9 are proven with `AZURE_E2E_CI_TOKEN=pat`,
  where the jobs and the person are the same identity. See the Azure DevOps report for the options.

### Bitbucket Pipelines

Built on 2026-10-08, never run live. The free plan gives the workspace 50 build minutes a month,
less than one run (about 20 jobs of 5 to 8 minutes). The decision: use the minutes while there are
some, then go on with the job simulator.

```bash
# .env: BB_WORKSPACE=<workspace>  BB_PROJECT_KEY=<key>  ATLASSIAN_TOKEN=<token>  ATLASSIAN_EMAIL=<email>
export PROVIDER=bitbucket
# optional: BB_REPO (default sfdx-hardis-promo-e2e-ci-bb-<n>), BB_CI_SIMULATE_ONLY=1,
# BB_CI_PAUSE_SECONDS (90), CI_WAIT_APPEAR_SECONDS (600), CI_WAIT_REQUEUE_SECONDS (240),
# CI_WAIT_QUEUE_SECONDS (1800), CI_WAIT_JOB_SECONDS (3600)
nohup bash .claude/skills/promotion-branches-e2e/scripts/ci-workflows-run.sh >"${TMPDIR:-${TEMP:-/tmp}}/promo-e2e-ci-bitbucket.out" 2>&1 & disown
```

What `ci-provider-bitbucket.sh` does, in order:

1. `ci-workflows-prepare.cjs --provider bitbucket` writes `bitbucket-pipelines.yml`: the template,
   the link commands before `sf hardis:auth:login` in both steps, in the sfdx-hardis image, with a
   cache `sfdxhardislink` on `/tmp/sfdx-hardis` (a later step fetches the branch into the cached
   clone and reuses `node_modules`). The MegaLinter step and its `parallel` block are left out: they
   would cost minutes on every Pull Request. The file is parsed back, checked, and validated against
   `https://api.bitbucket.org/schemas/pipelines-configuration` (Atlassian's JSON schema: it catches
   wrong types, not unknown keys). Bitbucket has no lint API; this happens before the repository
   exists, so no minute goes to a syntax error.
2. Creates the private repository in `BB_PROJECT_KEY`, pushes `main` and the major branches while
   Pipelines is still off (nothing runs), turns Pipelines on (`PUT pipelines_config`), then sets the
   repository variables: `SFDX_AUTH_URL_<BRANCH>`, `CI_SFDX_HARDIS_BITBUCKET_TOKEN` and
   `CI_SFDX_HARDIS_BITBUCKET_EMAIL`, all secured (`bitbucket.ts` reads those two names). The token
   is the one of the person running the test, so the comments of the jobs are theirs and W2 can
   edit them.
3. Waits on the pull request pipeline of the head commit (`target.pullrequest.id`,
   `target.commit.hash`) and on the branch pipeline of the merge commit. A pipeline of the same Pull
   Request for an older head is stopped at once. W2 and W6 start the pipeline again through
   `POST pipelines/` with a `pipeline_pullrequest_target`, as the Rerun button does; the same call
   starts a pipeline that did not come by itself (a draft).
4. **The fallback.** The minutes are used up when a pipeline stays `PAUSED` or `HALTED` for
   `BB_CI_PAUSE_SECONDS` (this pipeline file has no deployment environment and no manual step, so
   nothing else pauses it; Bitbucket then shows "This pipeline was paused because you've reached
   your monthly minutes quota" and never resumes it on its own), when one ends in `ERROR` with a
   message about minutes or quota, or when `POST pipelines/` is refused with such a message. The
   script then stops that pipeline, turns Pipelines off, writes the reason in
   `$LOGS/bb-minutes-gone`, and runs this job and every later one through `bb_check` / `bb_deploy`
   of `e2e-lib-bitbucket.sh` on the same Pull Request or branch. The assertions do not change.
   W0 is recorded SKIP when its job was simulated: the simulator runs the local working copy.
5. The order. On Bitbucket W3 (the draft) runs after W4, so the minutes go first to what only real
   CI proves: the gate and its comment (W1), the checkbox and the re-run (W2), the deployment after
   a merge (W4). With 50 minutes, expect five to seven real jobs.

`BB_CI_SIMULATE_ONLY=1` skips real CI from the start (the minutes are known to be gone): the CI
file is still checked and pushed, every job is simulated.

Unproven until the first run:

- **The exact state of a pipeline out of minutes.** Atlassian documents the message, not the JSON.
  The script reads `state.stage.name`; if the pipeline shows another shape (plain `PENDING` with no
  stage), it waits `CI_WAIT_QUEUE_SECONDS + CI_WAIT_JOB_SECONDS` and ends with code 9: lower
  `CI_WAIT_QUEUE_SECONDS`, note the JSON of `GET pipelines/<uuid>`, and fix `_bbci_wait_pipeline`.
- **The cache.** A cache is saved by the first successful step only and is capped at 1 GB: the
  clone with `node_modules` may be over it, and then every step pays the full link time.
- **Memory.** A step has 4 GB; `tsc` runs with `--max-old-space-size=3072`.
- **Pipelines on a draft**, and `target.commit.hash` being the head of the source branch.
- Creating a repository with this token (see section 8ter), the pipeline scopes of the token.

## 6sexies. Identical deployment actions run once

Issue #2271: when several Pull Requests of one run carry the same action (same type, phase, user and
parameters), the first one runs and the others are recorded as done by it. `scripts/identical-actions-run.sh`
runs after `promotion-run.sh`, on the same repository. It adds eight stories into integration, and
promotes them together to uat (PI). Groups I9 and I10 add three more, promoted on their own (PD, PV):

| Story | Branch                           | Actions (`story_actions` kind)                                            |
|-------|----------------------------------|---------------------------------------------------------------------------|
| SA    | `feature/E2E-501-shared-a`       | `identical`: the shared step, after the deployment                        |
| SB    | `feature/E2E-502-shared-b`       | `identical`                                                               |
| SW    | `feature/E2E-503-shared-twice`   | `identical-twice`: the shared step, another step, the shared step again   |
| SP    | `feature/E2E-504-shared-pre`     | `identical-pre`: the shared step, before the deployment                   |
| SX    | `feature/E2E-505-same-id-a`      | `same-id-a`: the hand-written id `e2e-same-id`, command A                 |
| SY    | `feature/E2E-506-same-id-b`      | `same-id-b`: the same id, command B                                       |
| SF    | `feature/E2E-507-flaky`          | `flaky-uat`: a command failing in uat until `e2e-identical-ok.txt` exists |
| SC    | `feature/E2E-508-shared-c`       | `identical`, after the failure of SF                                      |
| SD    | `feature/E2E-509-shared-d`       | `identical`, next to the same action in the uat branch config (I9)        |
| SG    | `feature/E2E-510-shared-check-g` | `identical-check`: the shared step with context `all` (I10)               |
| SH    | `feature/E2E-511-shared-check-h` | `identical-check` (I10)                                                   |

The shared step is the same command in every story that carries it:
`node -e "require('fs').appendFileSync('e2e-identical-count.txt','r')"`. The size of
`e2e-identical-count.txt` is the number of real runs of a job, whatever its log says.

```bash
export PROVIDER=github ORG REPO WORK LOGS DEV API      # plus GL_* and PROJECT_* on GitLab
export DEV_ORG=<scratch org username>                   # optional: group I7
bash .claude/skills/promotion-branches-e2e/scripts/identical-actions-run.sh   # results-section6sexies.txt
```

| Group | Checks                                                                                                                                                                                                                                                                                                                                                                                                                                  |
|-------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| I1    | Only SW is deployed to integration: the deployment of a feature merge carries that Pull Request alone, and its two shared steps both run (2 runs). One Pull Request is one source: an action written twice in it is meant twice                                                                                                                                                                                                         |
| I2    | PI (integration -> uat) carries the eight stories. `--forecast uat --from-branch integration` gives SB, the first shared step of SW and SC the `identical-action` reason with `identicalTo` SA, and leaves SA, the repeat of SW, SP (other phase) and the two same-id actions on their own                                                                                                                                              |
| I3    | The validation of PI merges nothing (the actions are deployment-only). Its deployment exits 1 on SF and runs the shared step 3 times (SP before the deployment, SA, the repeat of SW): SB and the first step of SW log `Skipping action ... same action as E2E shared step of PR <SA> (#<SA>), run once for this deployment`, both same-id actions run, and SC, met after the failure, logs the same copy line instead of being stopped |
| I4    | The copies are `success` in uat with the note `Not run twice: the identical action "..." of #<SA>`, SF is `failed`, the repeat of SW and both same-id actions are `success`                                                                                                                                                                                                                                                             |
| I5    | `action:run --next all` retries SF in uat once `e2e-identical-ok.txt` exists: `success` with a "Run locally by" note. Nothing waits after it: SC was recorded as a copy, not stopped                                                                                                                                                                                                                                                    |
| I6    | The deployment of uat run again skips everything as `already run in uat`, the copies included, and runs the shared step 0 times                                                                                                                                                                                                                                                                                                         |
| I7    | With `DEV_ORG`: the backpromote plan of the window (`--plan --from-pull-request <SA>`) gives every action its own `key`, the two same-id actions included (`<pr>:post:e2e-same-id`), and the same `identicalTo` as the forecast                                                                                                                                                                                                         |
| I8    | With `DEV_ORG`: the backpromote run of that window (`--auto --run-id <plan>`) gives `actions.byKey` `identical` for SB, the first step of SW and SC, `run` for SA, the repeat of SW, SP and both same-id actions; the shared step runs 3 times, and the copies are `success` rows of the "Backpromotes" comments of SB and SC                                                                                                           |
| I9    | The shared step written twice in `config/branches/.sfdx-hardis.uat.yml` (committed on uat), and a ninth story SD carrying it, promoted alone (PD). The deployment runs the config actions first: both run (one source), SD logs `same action as E2E shared step of the uat config (branch or project config)`; 2 runs, and SD is `success` in uat with a note naming the config. The config commit is reverted afterwards               |
| I10   | SG and SH carry the shared step with context `all`, promoted together (PV). The forecast says `runs-at-validation` for both, SH with the `identical-action` reason. The validation job runs it once for SG and logs the copy line for SH (1 run); the deployment job skips both as `already run in uat` (0 runs)                                                                                                                        |

Traps:

- **Creation order, merge order and Pull Request numbers must agree.** The forecast picks the first
  copy by ascending Pull Request number, the deployment by run order (merge order for a batch,
  declared order for a promotion). The script creates and merges the stories in the same order, so
  I2 and I3 name the same first copy. Merge them in another order and I2 fails, while the product
  is right.
- **The counter and `e2e-identical-ok.txt` are untracked on purpose**, and listed in
  `.git/info/exclude`: untracked and not excluded, `promotion:create` refuses the working copy as
  not clean. Delete `e2e-identical-ok.txt` to replay I3.
- **SF fails in uat only** (`includeTargetBranches: [uat]`): nothing else deploys it, but a later
  section that deploys integration with SF in its scope must not fail on it.
- **Two skip lines, two wordings.** A copy logs `Skipping action <label>: same action as ...`, an
  action already done in the org logs `Skipping <label>: already run in <branch>`, without
  "action". The patterns of I3 and I6 differ on purpose.
- **`IA_RUN=<n>` replays the section on the same repository** with story branches of their own.
- The section scripts share their assertion helpers (`record`, `assert_log`, `job`, `cli`,
  `status_check`, `open_story`) through `scripts/section-lib.sh`.
- Ran green on GitHub and GitLab on 2026-10-04 (twice on GitHub) and again on 2026-10-07.

## 7. Traps met while writing this

- **The Dev Hub has a daily scratch org signup limit, and it resets at midnight in the org's own
  timezone.** `sf limits api display --target-org <dev hub>` shows `DailyScratchOrgs` as
  **remaining**, not as used: a `0` there means no scratch org can be created until the reset, and
  `sf org create scratch` answers `LIMIT_EXCEEDED`. Read that limit **before** deleting the scratch
  orgs of the previous run: deleting one does not give a signup back, and the run of section 6bis
  then has no org to deploy to. The Cloudity developer Dev Hub is on `America/Los_Angeles`, so the
  counter resets at 07:00 or 08:00 UTC.
- **The Dev Hub also caps the ACTIVE scratch orgs, at 3, and the CI of sfdx-hardis uses the same
  Dev Hub.** Every `tests-org` run of a sfdx-hardis Pull Request leaves a one-day
  `CI-hardis-nut-shared-*` scratch org behind. Two of them plus the first developer org make the
  second `sf org create scratch` answer `LIMIT_EXCEEDED ... active scratch org limit`, with
  `DailyScratchOrgs` still at 6 (2026-10-02). `sf limits api display` shows `ActiveScratchOrgs`
  remaining; `SELECT Id, SignupUsername, OrgName FROM ActiveScratchOrg` on the Dev Hub names them,
  and `sf data delete record --sobject ActiveScratchOrg --record-id <id>` frees the slot of a CI org
  whose run is over. Check it before `backpromote-setup.sh`: the setup merges its stories before it
  creates the orgs, so a failure there costs a repository.
- **The simulators run the TypeScript sources as they are on disk** (`bin/dev.js`). A source file
  saved half way through a fix, while a section runs, fails the job that starts at that moment with
  `command hardis:project:deploy:smart not found` and exit code 2 (2026-10-09, check A5 on GitHub).
  Fix the product between two sections, or make each save a file that compiles, and replay the
  section of a check that ended with exit 2 (`DA_RUN=2`, `IA_RUN=2`) before calling it a finding.
- **A workstation short on memory fails jobs in ways that look like product defects.** Each job
  starts several node processes; with under 1 GB free a deployment action as plain as `echo` fails
  with `Command failed` and no output (2026-10-02, the retrofit validation), and the harness may
  stop the whole script. Read the free memory before a run, and treat a spawn failure with no
  output as the machine first.
- **Section 6bis needs its own repository when section 4 also runs.** `backpromote-setup.sh` creates
  `feature/E2E-101-alpha`, `feature/E2E-102-beta` and `feature/E2E-103-gamma` itself, which are the
  branch names of the User Stories of section 3: run the two halves against two throwaway
  repositories (`-e2e-<n>` for the promotions, `-e2e-<n+1>` for the backpromote), or run 6bis alone
  on a repository built by `build-repo.sh` and pushed, with no stories opened.
- **`promo-vars.sh` exports short names** (`S1` to `S9`, `SA`, `SP`, `SW`, `PI`, `C1`...). A wrapper
  that sources it must not keep its own state in such names: `SP` holding a scratch path became the
  number of a story, and the next command ran `54/run-ab.sh` (2026-10-04).
- **`NODE_OPTIONS`**: with VS Code's inspector bootloader set, node hangs after the command
  finishes and the job looks stuck. `env -u NODE_OPTIONS` (the library does it).
- **Fast-forwarding a major branch from a lower one** to propagate a config change ships every
  story of that branch. Commit on `main`, reset the others to it.
- **Stories touching the same file** conflict on the second merge into the same branch, which is
  noise unless conflicts are what you are testing. One static resource per story.
- **`git fetch` into the checked-out branch** is refused; detach first (`git checkout --detach HEAD`).
- **`config/user/`** must be gitignored, otherwise `promotion:create` refuses to run.
- **A modify/delete conflict leaves no marker.** Cherry-picking a change to a file the target
  branch does not have conflicts, but git writes the incoming content with no `<<<<<<<` in it, so
  the marker gate is right to pass. To test the gate, both sides must hold the file with diverging
  content.
- **`refs/pull/<N>/merge` lags behind a push.** After pushing a fix to a Pull Request branch, a
  validation job fetched immediately can still run against the previous merge ref and fail on
  something you just fixed. Fetch again a few seconds later before believing the failure.
- **It does not exist yet right after the Pull Request is opened.** A validation started just after
  `p_open` failed to fetch it and never ran (check 38 of 2026-10-04: exit 1 and no job log at all).
  `e2e_check` now retries the fetch for a minute, and writes the reason in the job log when the ref
  never comes.
- **So does the head the GitHub API reports.** `GET /pulls/<N>` can answer with the previous
  `head.sha` for several seconds after a push, so waiting until the merge ref contains "the head the
  API gives" returns at once and validates the old tree. Wait on the commit you pushed
  (`p_wait_merge_ref <N> "$(git rev-parse HEAD)"`).
- **Git on Windows checks files out with CRLF** (`core.autocrlf=true`). A script that edits
  `config/.sfdx-hardis.yml` with patterns written for `\n` matches nothing, commits nothing, and
  the case silently runs on the unchanged config. Normalise the line endings first and fail when
  `git diff --cached --quiet` says nothing changed (`set_steps` / `commit_steps` in
  `promotion-edge.sh`).
- **A deployment that reuses its validation prints `Successfully processed QuickDeploy`**, not
  `Successfully deployed`: assert on both.
- **Writing into the user's `.gitignore`** to work around the dirty-tree check is not a fix: it
  only moves the failure to the modified `.gitignore`.
- **The A/B scripts cannot be run from inside the sfdx-hardis working copy.** Section 7ter checks
  out `origin/main`, which takes `.claude/skills/` away with it, and the second half of each pair
  silently runs nothing. Copy `ab-run.sh`, `ab-run-gitlab.sh`, `ab-run-azure.sh`, `ab-diff.py`
  and the matching `e2e-lib-*.sh`, with `e2e-lib-backpromote.sh` and `env-lib.sh` they source,
  somewhere else first, and call them by absolute path. Run `e2e_defaults` in the shell before
  (section 0): it exports `E2E_ROOT` and `E2E_ENV_FILE`, which the copies cannot derive from where
  they sit.
  `ab-run-azure.sh` and `ab-run-bitbucket.sh` source the library sitting next to them, because
  `bash script.sh` is a child process and does not inherit the functions the caller sourced.
- **A promotion Pull Request number is not a candidate.** Promotions are vehicles, so `promote
  <promotion number>` is refused. Select one of the stories it carried: since the vehicle merge is
  opened up into the commits it brought in, each of those stories is a candidate row of its own.
- **`yarn compile`, not `yarn dev`.** The diagram and pipeline scripts require the compiled modules
  one by one (`out/utils/pipeline/promotionBranchUtils.js`, `out/pipeline-data-provider.js`), which
  is the tsc layout. A webpack build leaves bundles they cannot require.
- **Both release-notes runs write the same file.** `doc:release-notes` overwrites
  `hardis-report/release-notes/main-<date>/release-notes-main-<date>.md`, so the plain run has to be
  copied aside before the `--include-promotions` one runs, or the comparison reads the same file
  twice and the vehicles look like a leak.
- **An ad-hoc `git add -A` after any CLI run commits `hardis-report/`.** From then on the tree is
  dirty on every branch that has it, and `promotion:create` refuses to run. Add only the files the
  case is about, or `git rm -r --cached hardis-report` to undo it.
- **`gh pr edit --body-file` can fail** on the classic-projects GraphQL deprecation, silently
  leaving the description unchanged. Use `gh api -X PATCH "repos/$REPO/pulls/<N>" --input <file>`.
- **On GitHub, `gh pr create` is a real second path.** When the provider refuses to open the Pull
  Request, sfdx-hardis falls back to the GitHub CLI, which reads the local remote and not
  `GITHUB_REPOSITORY`. To reach the "creation refused" case, take the GitHub CLI off `PATH` as well.
- **Git will not make an octopus merge out of sides it can fast-forward.** `git merge A B` where A
  is a descendant of HEAD produces a two-parent merge. The three-parent guard stays a unit test.
- **Azure DevOps writes a merge sentence of its own.** Completing a Pull Request without
  fast-forward gives `Merge pull request 52 from feature/X into integration`: no `#`, and the target
  branch after the source. A run that sees `-` rows labelled "Merge pull request N from ..." in a
  candidate table is looking at that, not at a missing Pull Request.
- **A promotion description can be refused for its length.** Azure DevOps caps a description at
  4000 characters and the embedded conflict prompt goes past it. The description now drops the
  prompt (it is saved in `hardis-report/` anyway) rather than losing the Pull Request, so a run that
  sees no `<details>` block on an Azure promotion with conflicts is seeing the intended behaviour.
- **Running two providers at once exhausts git bash on Windows.** `fork: retry: Resource
  temporarily unavailable` and `dofork: child -1 ... exit code 0xC000026B` come from the shell, not
  from the product: rerun the step, and keep the long A/B passes to one at a time.
- **A candidate row is a User Story, not a promotion window.** Runs written before the vehicle
  merges were opened up expected one row labelled `#3, #1` for a whole `integration -> uat` sync,
  and read "selecting either takes both" as correct. It is not: promoting one story must carry that
  story only. A run that still sees the grouped row is looking at a regression, not at the runbook.

- **The simulators must name their jobs like the templates do.** The message key of a validation or
  deployment comment carries the CI job name, and the DevOps Pipeline reads the kind of a comment back
  from that key. The simulators used to run with no job name (`job` in the key), while GitHub Actions
  writes `Simulate Deployment (sfdx-hardis)`, spaces included: the key reader stopped at the first
  space, every real GitHub comment was invisible to the Pull Request window and the navigation line
  between comments was empty, and only the real CI section could show it (sfdx-hardis #2307,
  2026-10-07). `e2e_check` / `e2e_deploy` now set `GITHUB_WORKFLOW`, `gl_check` / `gl_deploy`
  `CI_JOB_NAME`, to the names of the templates. Keep them in step with `defaults/ci`.

## 7bis. Checking the "one place in the diagram" rule

Two scripts look at the pipeline, and they answer different questions. `check-pipeline.cjs`
(section 4bis) drives the extension's own data path against the real repository and says what the
user sees at a point of the run. `check-diagram*.cjs`, below, fetches the Pull Requests itself and
feeds the pure helpers with a **superset** of every window, which makes the duplicate check
stricter than the real one. Run both: the first proves the extension, the second proves the rules.


The DevOps Pipeline lists a promoted Pull Request in the branch it reached, not in the one it came
from, so a number appears once in the whole diagram, and it lists User Stories only: promotion and
major-to-major Pull Requests are hidden until the **Show merge and promotion Pull Requests** toggle
at the top right of the branch window is on. Open the pipeline in VS Code to see it, or run the
extension's own helpers over the real Pull Requests of the test repository:

```bash
node .claude/skills/promotion-branches-e2e/scripts/check-diagram.cjs \
  "$REPO" integration,uat,preprod,main
```

The script fetches every Pull Request with `gh`, normalises the state like
`GitProviderGitHub.convertToPullRequest` does, then calls the compiled
`out/utils/pipeline/promotionBranchUtils.js`: `expandPullRequestsWithPromotions`,
`buildPromotionIndex`, `annotateAlreadyPromoted`, `enforceSinglePlacePerPullRequest` and
`userStoryPullRequests`. It prints the counter of each branch node with the Pull Requests it lists,
and exits non-zero if a number appears twice. It also prints the counts the **Show merge and
promotion Pull Requests** toggle produces, which can only be higher. There is no "show already
promoted" toggle any more: a story a promotion carried further is listed in the branch it reached
and nowhere else, in the node counter and in the branch window alike.

The extension must be compiled first (`cd $EXT && yarn compile`), on the branch under test.

On Azure DevOps, `check-diagram-azure.cjs` does the same from the Azure DevOps API:

```bash
AZ_ORG="$AZ_ORG" AZ_PROJECT="$AZ_PROJECT" AZ_TOKEN="$AZ_TOKEN"   node .claude/skills/promotion-branches-e2e/scripts/check-diagram-azure.cjs   "$AZ_REPO_NAME" integration,uat,preprod,main
```

On GitLab, `check-diagram-gitlab.cjs` does the same from the GitLab API:

```bash
GL_HOST="$GL_HOST" GL_TOKEN="$GL_TOKEN" \
  node .claude/skills/promotion-branches-e2e/scripts/check-diagram-gitlab.cjs \
  "$PROJECT_ID" integration,uat,preprod,main
```

> **The diagram scripts can hide a provider defect.** `check-diagram-azure.cjs` and
> `check-diagram-bitbucket.cjs` fetch the Pull Requests themselves and hand them to the extension's
> pure helpers, so they prove the RULES, never the extension's own fetching. Azure DevOps made that
> concrete: the CLI and the extension both lost the `promotionPullRequests` declaration to the 400
> character truncation of the list API, and the harness did not see it because
> `check-diagram-azure.cjs` re-reads full descriptions of its own accord. Whenever a fix lands in a
> sfdx-hardis git provider, read the matching `src/utils/gitProviders/gitProvider*.ts` of
> vscode-sfdx-hardis and ask whether the same call is made there.

Both scripts build a branch window from "every merged Pull Request whose target is this branch",
which is a superset of the real window and makes the duplicate check stricter. It also means a
story that reached a branch through an ordinary major-to-major merge stays listed under the branch
it was merged into: that is the script, not the extension.

## 7ter. Regression check against `main`, feature off

Before shipping, prove that a project which does not set `enablePromotionBranches` gets the same
jobs as before.

```bash
export ORG REPO WORK LOGS DEV
CLI="$E2E_ROOT"   # the sfdx-hardis working copy, set by env-lib.sh
AB=.claude/skills/promotion-branches-e2e/scripts

# one open feature Pull Request and one open major-to-major Pull Request are needed (fresh merge refs)
(cd "$CLI" && git checkout feat/promotion-branches) && "$AB/ab-run.sh" branch off 15 uat 16 preprod uat
(cd "$CLI" && git checkout --detach origin/main)    && "$AB/ab-run.sh" main   off 15 uat 16 preprod uat

# run the pair a second time: the first pass only measures run order (comments added vs updated,
# once-per-org actions run vs skipped)
(cd "$CLI" && git checkout feat/promotion-branches) && "$AB/ab-run.sh" branch2 off 15 uat 16 preprod uat
(cd "$CLI" && git checkout --detach origin/main)    && "$AB/ab-run.sh" main2   off 15 uat 16 preprod uat

PYTHONIOENCODING=utf-8 python "$AB/ab-diff.py" "$LOGS/ab-main2" "$LOGS/ab-branch2"
```

Expected: `TOTAL DIFFERING LINES: 0`, or 1 when a merged branch is named `promotion/...` (the
informational line saying it is treated as an ordinary feature branch).

> **The "off" pass must really be off.** `ab-run.sh` checks out each merge ref fresh, and with
> `core.autocrlf=true` git writes `config/.sfdx-hardis.yml` with CRLF. The flag edit used to match
> `true$` only, which never matches `true\r`: the "off" pass then ran with the feature on, and both
> CLIs agreeing proved nothing about a project that does not use the feature. Since 2026-10-04 the
> four `ab-run*.sh` match the line with or without its `\r` and stop when the flag is not `false`
> afterwards. Anything else is a
regression, **unless** it is one of these, which the run of 2026-09-09 met and which are not
promotion branches behaviour:

- `git config --null --show-origin --get-all remote.origin.url`, once per command on GitLab: the
  stale `CI_PROJECT_ID` guard reads the git remote outside a GitLab CI job. Intended, and paid by
  local runs only.
- `Changes if deployed: 1 created ...` against `0 created ... 1 unchanged`: the pass that ran first
  deployed the metadata and the second found it unchanged. **Run a third pair** and compare that
  one: on 2026-09-09 the third Azure pair came back at 0 while the second showed 20 such lines.
- `Source validate did not run tests in the org` / `There have been deploys in the org since the
  source validate happened`: quick-deploy state in the org between two passes. Switching the CLI checkout in place is safe as long as `package.json` and `yarn.lock`
are identical on both refs (`bin/dev.js` runs the TypeScript sources through ts-node).

## 8. What is different on GitLab

Run the whole thing a second time against a throwaway private GitLab project: the provider code
paths that create, find and close a promotion Pull Request are not shared with GitHub.

```bash
export ORG="your.user@example.com"
export PROJECT_ID=1234                                    # numeric id of the new project
export PROJECT_PATH="you/sfdx-hardis-promo-e2e-gl-1"
export GL_HOST="https://gitlab.example.com"
export GL_TOKEN="..."                                     # personal access token, api scope
export PROVIDER=gitlab   # ORG, WORK, LOGS, EXPECT, DEV and EXT: .env and env-lib.sh (<temp>/promo-e2e-gitlab)
source .claude/skills/promotion-branches-e2e/scripts/e2e-lib-gitlab.sh
```

Set the project to merge commits and never squash, otherwise the `-x` trailers are lost:

```bash
curl -X PUT -H "PRIVATE-TOKEN: $GL_TOKEN" "$GL_HOST/api/v4/projects/$PROJECT_ID" \
  -d merge_method=merge -d squash_option=never -d only_allow_merge_if_pipeline_succeeds=false
```

Then follow sections 3 to 7 with `gl_check` / `gl_deploy` / `gl_promote` / `gl_release_notes`.
The same features run by real GitLab CI jobs, in a project of the group `GITLAB_E2E_GROUP`, are
section 6quinquies (`PROVIDER=gitlab bash scripts/ci-workflows-run.sh`).

Traps that only bite on GitLab:

- **`refs/merge-requests/<iid>/merge` is written lazily.** After a push to the source branch it
  still points at the previous merge, and `GET /merge_requests/:iid/merge_ref` hands back the stale
  `commit_id` while the new one is computed. A validation job then runs against a tree missing the
  commit you just pushed, and the result looks like a product bug: deployment actions "not found",
  conflict markers "still there" after you solved them. `gl_check` waits until the merge ref
  actually contains the head of the source branch. Never trust a GitLab validation result you got
  within seconds of a push without that wait.
- **GitLab computes the mergeability after every push, and refuses the merge until it is done.** On
  2026-10-04 merge request !18 stayed `checking` for about 90 seconds, longer than the minute
  `gl_mr_merge` used to wait: the merge was refused, section 6sexies promoted seven stories out of
  eight, and its run was lost. `gl_mr_merge` now waits up to 3 minutes and retries the merge.
- **Python's `urllib` refuses a corporate CA** that `curl` and node accept. Every API call of the
  GitLab library goes through `curl`; python is only used to build and read JSON.
- **Python on Windows decodes stdin with the system codepage.** Piping a GitLab API answer into
  `json.load(sys.stdin)` mangles every emoji of a merge request description and can produce a lone
  surrogate, after which the update answers `400 Bad Request` with no explanation. Read the bytes:
  `json.loads(sys.stdin.buffer.read().decode('utf-8'))`.
- **Python on Windows does not resolve the git bash `/tmp` path.** Keep the merge request body
  files under a real Windows path, or the description is silently posted empty.
- **`glab` defaults to gitlab.com** and prints its own decorations. Use `curl` with
  `PRIVATE-TOKEN`, or export `GITLAB_HOST`.
- Merge request iids do not have to start at 1. Nothing in the feature assumes they do, and a run
  that starts at !2 is a slightly better test than one that starts at !1.

## 8bis. What is different on Azure DevOps

Run the whole thing again against a throwaway repository of an Azure DevOps team project: the
provider code paths that create, find, close and read a promotion Pull Request are not shared with
GitHub or GitLab.

```bash
export AZ_REPO_NAME="sfdx-hardis-promo-e2e-az-7"   # -az-1 to -az-6 exist (2026-10-08)
# AZ_ORG, AZ_PROJECT and the token (AZURE_PERSONAL_ACCESS_TOKEN) come from the environment, else from
# .env (E2E_ENV_FILE to point elsewhere). PAT: Code read/write, Pull Request threads read/write.
# AZ_REPO_ID: leave it unset, it is read by name once the repository exists.
export PROVIDER=azure    # ORG, WORK, LOGS, EXPECT, DEV, EXT, API: .env and env-lib.sh (<temp>/promo-e2e-azure)
source .claude/skills/promotion-branches-e2e/scripts/env-lib.sh && e2e_defaults "promo-e2e-$PROVIDER"
```

Create the repository with the REST API, before sourcing the library (it reads the GUID by name and
stops when there is none). The token comes from `.env` here too:

```bash
curl -sS -u ":$AZURE_PERSONAL_ACCESS_TOKEN" -H "Content-Type: application/json" -d '{"name":"'"$AZ_REPO_NAME"'"}' \
  "https://dev.azure.com/$AZ_ORG/$AZ_PROJECT/_apis/git/repositories?api-version=7.1" -o /dev/null -w "%{http_code}\n"
source .claude/skills/promotion-branches-e2e/scripts/e2e-lib-azure.sh
```

Push with the token in the remote URL: `git remote add origin "$(az_remote_url)"` (that is
`https://azure:$AZ_TOKEN@dev.azure.com/$AZ_ORG/$AZ_PROJECT/_git/$AZ_REPO_NAME`). Then run the scripted
sections with `PROVIDER=azure` (section 6ter), or follow sections 3 to 7 by hand with `az_check` /
`az_deploy` / `az_promote` / `az_release_notes`:

```bash
export PROVIDER=azure
bash .claude/skills/promotion-branches-e2e/scripts/promotion-run.sh
bash .claude/skills/promotion-branches-e2e/scripts/promotion-edge.sh g1 g2 g3 g4 g5 g6
bash .claude/skills/promotion-branches-e2e/scripts/deployment-actions-run.sh
bash .claude/skills/promotion-branches-e2e/scripts/identical-actions-run.sh
bash .claude/skills/promotion-branches-e2e/scripts/backpromote-setup.sh   # on its own repository, see 6bis
```

Traps that only bite on Azure DevOps:

- **The Pull Request list API truncates every description at 400 characters**, with no marker
  saying so. A promotion branch declares its stories in a `promotionPullRequests` yaml block that
  sits below the navigation block and the introduction, so it is cut off, and every consumer that
  reads a description from a list sees nothing. This was a real defect, found by this run and fixed
  in `AzureDevopsProvider.completeTruncatedDescription`. `check-diagram-azure.cjs` re-reads the
  full Pull Request the same way. Anything new that reads a description out of `listPullRequests`
  has to go through that helper.
- **A Pull Request description is capped at 4000 characters.** A promotion with an embedded
  conflict prompt gets close: the one this run produced was 3690.
- **Pull Request ids are unique per organization, not per repository**, so a fresh repository does
  not start at 1 (this run started at 6). Nothing in the feature assumes it does, and it is a
  slightly better test than a run starting at 1.
- **`refs/pull/<id>/merge` is recomputed asynchronously.** As on GitLab, a validation job run
  seconds after a push can validate the previous merge. `az_check` waits until the merge ref holds
  the head of the source branch.
- **Completing a Pull Request is asynchronous too.** The API accepts the completion and answers
  before the merge commit exists; `az_pr_merge` waits for `status=completed` and
  `mergeStatus=succeeded`. It always completes with `mergeStrategy: noFastForward` so the `-x`
  trailers of the cherry-picks survive.
- **The description of a completed Pull Request cannot be edited** (Azure answers TF401181), which
  is why `isPrDescriptionEditableAfterMerge()` returns false and the deployment comment is created
  as a placeholder by the validation job.
- **Python on Windows does not resolve the git bash `/tmp` path.** Keep the Pull Request body files
  under a real Windows path (`$LOGS` as env-lib.sh sets it is one), or the description is posted empty and the creation
  fails with "Both a source and target reference is required".
- `az repos` (the Azure CLI) is not used anywhere: it needs its own login, prints its own
  decorations, and cannot set the completion options the merge needs. Everything goes through
  `curl` with the PAT.
- **The message key of the comments holds the job name** (`SYSTEM_JOB_DISPLAY_NAME`, #2307). The
  simulators pass the job names of the sfdx-hardis templates, `DeploymentCheck` for the validation
  and `Deployment` for the deployment, the way GitHub passes the workflow names and GitLab the job
  names. With a single fixed name for both, the validation and deployment comments of a Pull Request
  would only differ by their `deployment-check` / `deployment` prefix.
- **The mergeability check can outlast a minute** on a busy organization, like on GitLab.
  `az_pr_merge` waits up to 3 minutes for it, asks the completion again when it did not happen, and
  takes a Pull Request already `completed` (an earlier answer lost) as merged.
- **The PAT of `.env` is custom scoped.** On 2026-10-08 it creates and deletes repositories,
  contributes, creates branches and contributes to Pull Requests; Variable Groups, Service
  Connections and Graph answer 401, which the run never calls. Force push is allowed only on the
  repositories its user created: create the test repository with that same PAT, or the `git push -f`
  of the story branches (`story`, the retrofit) is refused.
- **`AZ_REPO_ID` is read by name** when it is empty: a sourcing that stops on "could not be read
  from the API" means the repository does not exist yet, or the PAT cannot read it.

## 8ter. What is different on Bitbucket Cloud

Exercised live twice on 2026-09-07 and 2026-09-08, on a repository of another workspace reached with
a repository access token. A workspace over its user limit makes every repository in it read-only:
`git push` answers HTTP 402, with nothing in the API to warn you beforehand. Since 2026-10-08 the run
uses the workspace `sfdxhardistest` (project key `TES`) with the Atlassian API token of `.env`.

```bash
export BB_REPO="sfdx-hardis-promo-e2e-bb-1"
# BB_WORKSPACE, and the token and email (ATLASSIAN_TOKEN, ATLASSIAN_EMAIL), come from the environment,
# else from .env (E2E_ENV_FILE to point elsewhere).
# For a workspace or repository Access Token instead: BB_TOKEN=<it> and BB_EMAIL="" (Bearer auth).
export PROVIDER=bitbucket   # ORG, WORK, LOGS, EXPECT, DEV, EXT, API: .env and env-lib.sh (<temp>/promo-e2e-bitbucket)
source .claude/skills/promotion-branches-e2e/scripts/e2e-lib-bitbucket.sh
```

Create the repository with the REST API (a project key is required in a workspace that has one), then
push through `bb_remote_url`:

```bash
bb_api POST "$BB_API" -d '{"scm":"git","is_private":true,"project":{"key":"'"$BB_PROJECT_KEY"'"}}' -o /dev/null -w "%{http_code}\n"
git remote add origin "$(bb_remote_url)"
```

Then run the scripted sections with `PROVIDER=bitbucket` (section 6ter), or follow sections 3 to 7
by hand with `bb_check` / `bb_deploy` / `bb_promote` / `bb_release_notes`:

```bash
export PROVIDER=bitbucket
bash .claude/skills/promotion-branches-e2e/scripts/promotion-run.sh
bash .claude/skills/promotion-branches-e2e/scripts/promotion-edge.sh g1 g2 g3 g4 g5 g6
bash .claude/skills/promotion-branches-e2e/scripts/deployment-actions-run.sh
bash .claude/skills/promotion-branches-e2e/scripts/identical-actions-run.sh
bash .claude/skills/promotion-branches-e2e/scripts/backpromote-setup.sh   # on its own repository, see 6bis
```

Traps already met on Bitbucket:

- **A classic Atlassian API token does not work.** It authenticates but answers
  `API Token provided has no Bitbucket scopes`. Create an API token **with scopes** covering
  Bitbucket (`read`/`write`/`admin:repository:bitbucket`, `read`/`write:pullrequest:bitbucket`), or
  a workspace Access Token. sfdx-hardis reads `CI_SFDX_HARDIS_BITBUCKET_TOKEN`, plus
  `CI_SFDX_HARDIS_BITBUCKET_EMAIL` when the token is an Atlassian API token (Basic auth); without
  the email it authenticates as a Bearer token, which is what an Access Token needs.
- **The REST API and `git push` do not take the same username.** The API wants the Atlassian
  account email; `git push` refuses it (and the `@` also has to be percent-encoded to survive the
  URL). For an Atlassian API token, git takes `x-bitbucket-api-token-auth`, the name the Atlassian
  documentation gives: `https://x-bitbucket-api-token-auth:<token>@bitbucket.org/<workspace>/<repo>.git`
  (`git ls-remote` with it answered on 2026-10-08). A workspace or repository Access Token takes
  `x-token-auth`. `bb_remote_url` picks the first when `BB_EMAIL` is set and the second otherwise;
  `BB_GIT_USER=x-token-auth` forces the older name if an API token is ever refused under the first.
- **The extension stores a Bitbucket token as `<HOST>_BITBUCKET_TOKEN`**, not `<HOST>_TOKEN` like the
  other providers. `check-pipeline.cjs` sets both since 2026-10-08; before that the DevOps Pipeline
  check found no Bitbucket token at all.
- **Python on Windows decodes stdin with the system codepage**, as on GitLab: a Pull Request whose
  description carries the emoji of the sfdx-hardis navigation block can break `json.load(sys.stdin)`.
  `bb_pr_field` and `bb_pr_create` (and their Azure DevOps twins) read the bytes as UTF-8.
- **Bitbucket Cloud displays raw HTML as text.** An HTML comment, a `<details>` block and a `<br/>`
  show as they are written, and nothing folds. Until 2026-10-09 every sfdx-hardis comment showed
  its markers, its encoded state and its tags there, which only the visual check of section 5quater
  could see (the audit reads the source, where they belong). The Bitbucket provider now sends its
  comments through `toBitbucketMarkup` (`src/common/gitProvider/utils/utilsBitbucketMarkup.ts`): a marker
  becomes a link with no text, `[](#hardis:<percent-encoded>)` or `[](#hardis64:<base64url>)`, a folded section becomes a bold title
  followed by its content, a line break a space. What Bitbucket's markdown does draw, proven by a
  test comment: a link with no text is an invisible anchor, in a table cell too; a
  `[//]: # (text)` line disappears; task items are checkboxes, but **disabled**: nobody ticks a
  manual action in a Bitbucket comment, `set-status` is the only way.
- **The raw text of a Bitbucket comment holds the hidden markers, not the HTML comments.**
  `dump_pr_comments` and `check-pr-modal.cjs` give them back as HTML comments, as the CLI does when
  it reads them (`fromBitbucketMarkup`). Anything new that greps the raw content of a Bitbucket
  comment for `<!-- sfdx-hardis` finds nothing.
- **The Bitbucket client prints a banner on stdout, now and then** ("BITBUCKET CLOUD API LATEST
  UPDATES"), ahead of the document of a `--json` command: `status_check` then fails on "not valid
  JSON" for one call out of a few. Turned off in the provider (`notice: false`) on 2026-10-09.
- **A push right after the repository is created can answer 403** for one branch: push again.
- **A workspace over its user limit is read-only**, with a plain HTTP 402 on push. Nothing in the
  API says so beforehand; the repository can still be created. On 2026-10-08 `sfdxhardistest`
  itself answered it ("the account 'sfdxhardistest' has exceeded its user limit and this repository
  is restricted to read-only access") while the API listed one member, its owner: the limit is a
  plan setting only the owner sees (Workspace settings > Plan details). No Bitbucket section ran
  that day. Before a run, push one commit to a scratch branch of an existing repository of the
  workspace: it is the only check that sees it.
- Merge with `merge_strategy: merge_commit` and `close_source_branch: false`, never squash, or the
  `-x` trailers of the cherry-picks are lost.
- **Bitbucket Cloud publishes no merge ref.** Neither `refs/pull-requests/<id>/merge` nor
  `.../from` is fetchable, and `git ls-remote` advertises none of them. A `pull-requests:` pipeline
  checks out the **source** branch and merges the destination into it before running the steps, so
  that is what `bb_checkout_pr_merge` reproduces. This is the one place where the Bitbucket harness
  differs in kind from the other three: there is no lazily written ref to wait for, and a merge
  conflict shows up at checkout rather than as a stale tree.
- **No merge ref also means nothing for `p_wait_merge_ref` to fetch.** On Bitbucket it waits until
  the Pull Request API reports the pushed head as its source commit (a 12 character hash), because the
  CLI reads the Pull Request from that API. `bb_pr_merge` asks the merge again when the state is not
  `MERGED` after a minute (Bitbucket can answer 202 and merge in the background).
- **A repository access token is scoped to its repository** (the runs of 2026-09), so a rerun with one
  cannot create a second repository and has to reuse the same one. The Atlassian API token of `.env`
  is not scoped to a repository: create a new `sfdx-hardis-promo-e2e-bb-<n>` each run.
  With a repository access token, reuse the same repository. Reset it by deleting every branch but `main` and
  force-pushing the base project. Two artefacts follow, neither of them a product defect:
  - the Pull Requests of the previous run stay in the repository, so pass `MIN_PR=<first new
    number>` to `check-diagram-bitbucket.cjs` to keep the windows readable, and expect an old
    major-to-major Pull Request to turn up in a deployment scope, matched by its source branch;
  - re-creating a Pull Request between the same two branches **reopens the declined one** of the
    previous run instead of creating a new number.

## 8quater. Proving the Azure DevOps and Bitbucket wiring without creating anything

Before a run, or after a change to a library, these prove the scripts and the tokens with read-only
calls. None of them creates a repository, a branch, a Pull Request or a comment, and none prints a
token.

```bash
cd .claude/skills/promotion-branches-e2e/scripts
for f in *.sh; do bash -n "$f" || echo "FAIL $f"; done
for f in *.cjs; do node --check "$f" || echo "FAIL $f"; done
shellcheck -x -S warning *.sh
bash preflight.sh        # tools, working copies, tokens, orgs: read-only, see section 0

# every p_* function exists for each provider (dummy values: nothing is called)
for P in github gitlab azure bitbucket; do (
  export PROVIDER=$P ORG=o REPO=a/b WORK=/tmp/w LOGS=/tmp/l DEV=d PROJECT_ID=1 PROJECT_PATH=a/b GL_HOST=https://x GL_TOKEN=t \
    AZ_ORG=o AZ_PROJECT=p AZ_REPO_ID=x AZ_REPO_NAME=r AZ_TOKEN=t BB_WORKSPACE=w BB_REPO=r BB_TOKEN=t BB_EMAIL=e
  source ./promotion-provider.sh
  for f in p_check p_deploy p_promote p_release_notes p_open p_merge p_close p_body p_set_body p_token p_cli \
    p_open_number_for_branch p_list_candidates p_promote_no_provider p_wait_merge_ref p_check_edited p_deploy_branch \
    p_pr_modal_check dump_pr_comments pipeline_check bp_provider_env bp_open bp_merge; do
    declare -F $f >/dev/null || echo "$P misses $f"; done ); done

# one GET per provider through the libraries' own helpers, the tokens taken from .env
( export AZ_REPO_NAME=sfdx-hardis-promo-e2e-az-6   # an existing repository; the rest comes from .env
  source ./e2e-lib-azure.sh; az_api GET "${AZ_COLLECTION}_apis/projects?api-version=7.1" -o /dev/null -w "azure %{http_code}\n" )
( export BB_REPO=any
  source ./e2e-lib-bitbucket.sh; bb_api GET https://api.bitbucket.org/2.0/user -o /dev/null -w "bitbucket %{http_code}\n" )
```

On 2026-10-08 all of it passed: no syntax error, no shellcheck warning, every function defined for
the four providers, `200` from both providers, the Azure repository GUID read by name, and
`git ls-remote "$(bb_remote_url)"` answering on an existing repository of the workspace.

## 9. Cleaning up

The repository is disposable. `gh repo delete "$REPO" --yes` needs the `delete_repo` scope
(`gh auth refresh -h github.com -s delete_repo`). The static resources, labels and Apex classes
left in the org are prefixed `PromoE2E` / `E2E_` and can be removed with a destructive changes
deployment. Delete the backpromote scratch orgs with `sf org delete scratch --target-org "$DEVORG" --no-prompt` (and `$DEVORG2`). The backpromote history comments disappear with the repository.

The GitLab CI project of section 6quinquies goes with
`curl -X DELETE -H "PRIVATE-TOKEN: $GL_TOKEN" "$GL_HOST/api/v4/projects/$PROJECT_ID"` (ids in
`$LOGS/ci-vars.sh`): its CI/CD variables and its project access token go with it. Delete it only once
the report is written, and only when the user asks: it lives in a shared group.

The Azure DevOps repository of section 6quinquies: delete the two pipeline definitions first
(`DELETE _apis/build/definitions/<AZ_CHECK_DEF_ID>` and `<AZ_DEPLOY_DEF_ID>`, their builds go with
them), then the repository (`DELETE _apis/git/repositories/<AZ_REPO_ID>`): its branch policies and
its access control entry go with it. The Bitbucket repository:
`bb_api DELETE "$BB_API"`, variables and pipelines included. Ids in `$LOGS/ci-vars.sh`.

The local folders are under the temp dir: `rm -rf "$WORK" "$LOGS" "$EXPECT"` once the report is
written, or the next run of the same provider stops on the existing `WORK`.
