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
- Git bash. On Windows, clear `NODE_OPTIONS` for every CLI call (VS Code sets an inspector
  bootloader that keeps node alive after the command ends). The library does it for you.

Set once:

```bash
export ORG="your.user@example.com"           # target org username or alias
export REPO="youruser/sfdx-hardis-promo-e2e" # private test repository, always a NEW one
export WORK="/c/tmp/promo-e2e"               # local clone
export LOGS="/c/tmp/promo-e2e-logs"
export DEV="C:/git/sfdx-hardis/bin/dev.js"
export EXT="C:/git/vscode-sfdx-hardis"       # only for the diagram check
export DEVHUB="$ORG"                         # Dev Hub for the backpromote scratch org (section 6bis)
export DEVORG="promo-e2e-dev"                # alias of that scratch org
export DEVORG2="promo-e2e-dev2"              # a second one, standing for a refreshed sandbox (B16)
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
`AZ_ORG`, `AZ_PROJECT`, `AZ_REPO_ID`, `AZ_REPO_NAME` and `AZ_TOKEN`. Section 8bis holds what is
different on Azure DevOps.

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

| Story | Branch                    | Target      | Actions                   | Test classes        | Custom behavior          |
|-------|---------------------------|-------------|---------------------------|---------------------|--------------------------|
| S1    | `feature/E2E-101-alpha`   | integration | pre command + post manual | `PromoE2EAlphaTest` | -                        |
| S2    | `feature/E2E-102-beta`    | integration | post command              | -                   | `NO_DELTA`               |
| S3    | `feature/E2E-103-gamma`   | integration | pre command               | `PromoE2EBetaTest`  | `PURGE_FLOW_VERSIONS`    |
| S4    | `feature/E2E-201-delta`   | uat         | pre command + post manual | `PromoE2EAlphaTest` | -                        |
| S5    | `feature/E2E-202-epsilon` | uat         | post command              | -                   | -                        |
| S6    | `feature/E2E-301-hotfix`  | preprod     | pre command + post manual | `PromoE2EBetaTest`  | `FLOW_DELETE_INTERVIEWS` |

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
export EXT=C:/git/vscode-sfdx-hardis
export EXPECT=/c/tmp/promo-e2e-expect          # one small JSON per checkpoint
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
branch that must not get a node of its own.

Three things are asserted at every checkpoint, expectations or not: a Pull Request number is listed
in one branch and one only, every counter bubble equals the length of the list under it, and the
diagram parses.

| Checkpoint              | When                                             | What it proves                                                                                                                                                                                  |
|-------------------------|--------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `pipeline-before-p1`    | after the BUILD stream is merged, before P1      | the stories wait in the branch they were merged into, the downstream branches are empty, and no promotion is drawn on any arrow                                                                 |
| `pipeline-p1-open`      | after `promotion:create`, before the merge       | the open promotion is drawn **on the `integration -> uat` arrow**, gets no branch node of its own, and takes nothing out of `integration` yet: a promotion only moves a story once it is merged |
| `pipeline-after-p1`     | after the merge and the deployment               | S1 and S3 are listed in `uat`, gone from `integration`, which keeps S2 alone, and the arrow is empty again                                                                                      |
| `pipeline-before-p3`    | before promoting a story that arrived through P1 | a story a promotion carried is offered by the branch it reached, so what the pipeline lists and what `promotion:create` offers are the same set                                                 |
| `pipeline-after-golive` | after the `preprod -> main` promotion is merged  | every promoted story is listed in `main`, none of them twice, and the counters of the branches it left went down                                                                                |

The extension needs its provider token, which it reads from a secret named after the remote host:
dots replaced by underscores, uppercased, plus `_TOKEN`. On `gitlab.hardis-group.com` that is
`GITLAB_HARDIS-GROUP_COM_TOKEN`, a name a shell cannot export, so the script takes the token in
`PROVIDER_TOKEN` and files it under the right name itself. `pipeline_check` passes the token the
rest of the library is already using.

> The check builds a **cold** cache on every call (an in-memory `Memento`), because a stale answer
> here would look exactly like the defect being hunted. Do not add a persistent store to it.

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
dump_pr_comments "C:/tmp/promo-e2e-comments.json"
node .claude/skills/promotion-branches-e2e/scripts/audit-pr-comments.cjs \
  "C:/tmp/promo-e2e-comments.json" "C:/tmp/promo-e2e-expect.json"
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

## 5ter. Deployment action state from the git provider

Check the deployment action state from the git provider too:

```bash
gh api "repos/$REPO/issues/1/comments" --jq '.[] | select(.body | contains("Deployment Actions")) | .body'
```

The "Status by org branch" table must have one column per org branch the story reached, and one
pending manual checkbox per org branch.

## 6. Edge cases to run at the end

| Case                                   | How                                                                                                                                    | Expected                                                                                                                                                                                                                                                                                                                                     |
|----------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Already promoted                       | `e2e_promote uat 4 ...` after the `uat -> preprod` promotion is merged                                                                 | the candidate table shows `Already promoted by promotion/uat/preprod/...`, a warning names `--include-already-promoted`, no branch created                                                                                                                                                                                                   |
| Empty cherry-pick                      | same with `--include-already-promoted`                                                                                                 | `Nothing to cherry-pick ...: this change is already in the target branch`, branch undone, tree clean, **exit 0**. Not a conflict                                                                                                                                                                                                             |
| Empty cherry-pick, dirty report folder | the same while `hardis-report/` is untracked                                                                                           | identical result: the cleanliness check and the emptiness test must both ignore the report directory                                                                                                                                                                                                                                         |
| Conflict, agent default                | two stories on the shared `CustomLabels` file merged into integration, promote only the second                                         | `Cherry-pick conflict on #N (...): the promotion has been undone`, no leftover branch                                                                                                                                                                                                                                                        |
| Conflict, kept                         | same with `--on-conflict commit-with-markers`                                                                                          | Pull Request created, `hardis-report/promotion-conflicts-prompt-*.md` written, prompt embedded in the description                                                                                                                                                                                                                            |
| Conflict, kept for all                 | two conflicting stories in the same promotion, no `--on-conflict`, answer "commit this and every following conflict" at the first one  | the second conflict is not asked about: the log holds `Applying the conflict handling chosen earlier: commit-with-markers` and both stories are committed with their markers                                                                                                                                                                 |
| Conflict prompt commit message         | read `hardis-report/promotion-conflicts-prompt-*.md` of the run above                                                                  | the prompt asks for a commit message whose body carries one line per conflicting file, naming the story, what the target side had, what the story added and what was kept                                                                                                                                                                    |
| Pull Request creation refused          | unset the provider token (or point it at a project the branch is not in) and run `promotion:create`                                    | the branch is still pushed, the warning names **the reason the provider gave** (not "no token"), and a link to the provider's own "new Pull Request" form is printed with the source branch, the target branch, the title and the description already filled in (the branches and the title only when the description is too long for a URL) |
| Deployment from a promotion branch     | run `deploy:smart` (no `--check`) with the promotion branch checked out, as a push pipeline of that branch would                       | the command stops with an error naming the branch and the CI setting to fix (`DEPLOY_BRANCHES` on GitLab). With `--check` it runs normally, and so does a deployment of the target branch after the merge                                                                                                                                    |
| Marker guard                           | validate that Pull Request                                                                                                             | job fails: `still contains git conflict markers in N file(s): ...`, **and the validation comment of the Pull Request says so**: failure banner, branch, count and the list of files to fix. A red job with no comment is a defect                                                                                                            |
| Marker guard, solved                   | solve as the prompt says, push, validate again                                                                                         | job passes                                                                                                                                                                                                                                                                                                                                   |
| Conflict outside force-app             | make two stories diverge on `NOTES.md` (both sides must hold the file with different content, otherwise git leaves no marker)          | the marker gate still catches it and names `NOTES.md`                                                                                                                                                                                                                                                                                        |
| Feature off                            | set `enablePromotionBranches: false` in the checked-out tree and validate a promotion Pull Request                                     | one informational line, scope = the Pull Request alone, everything else unchanged                                                                                                                                                                                                                                                            |
| Hand-named branch                      | branch `promotion/hand-made-by-a-human` with a `promotionPullRequests` block in its description                                        | warning `starts with promotion/ but does not follow the promotion branch naming ...`, treated as a feature branch, declaration ignored                                                                                                                                                                                                       |
| Retargeted promotion                   | open a `promotion/uat/preprod/...` branch against `main`                                                                               | treated as an ordinary branch, scope is the Pull Request alone, with a warning naming the mismatch. **The declared stories must not run their actions against production**                                                                                                                                                                   |
| Grouped merge commit                   | promote a candidate whose label lists several numbers (`#7, #6, #4 ...`)                                                               | the command names the numbers nobody asked for **before** cherry-picking, and declares them all                                                                                                                                                                                                                                              |
| Unreadable declaration                 | declare a Pull Request number that does not exist                                                                                      | warning and skip, not a failure                                                                                                                                                                                                                                                                                                              |
| Story brought in by a sync merge       | merge `integration` into `uat` with an ordinary merge (never a promotion), then `promotion:create --source-branch uat`                 | the candidate table has one row per story of the sync, each naming its own Pull Request. **Never one row for the whole window**: promoting one story must not carry the others. Check the assembled branch holds one cherry-pick and the description declares one number                                                                     |
| Story brought in by a promotion        | after P1 (`integration -> uat`) is merged, `promotion:create --source-branch uat`                                                      | same: S1 and S3 are two rows, promoting `3` carries S3 alone and leaves S1 offered in the next run                                                                                                                                                                                                                                           |
| Two levels of vehicle                  | merge a promotion into `integration`, then merge `integration` into `uat` with an ordinary merge, then promote from `uat`              | the stories under the inner promotion are candidates of their own: the split runs again over what it produced. The row must name the story, never the promotion or the sync                                                                                                                                                                  |
| Vehicle boundary                       | the same run                                                                                                                           | the merge that follows an opened-up vehicle does not swallow it: no candidate row lists the Pull Request numbers of the stories the vehicle carried on top of its own                                                                                                                                                                        |
| Back-merge from the target branch      | merge `preprod` into `uat` (a major branch merged backwards), then promote from `uat`                                                  | the back-merge stays a single row instead of becoming a page of stories already delivered: its commits sit before the merge base, outside the window being listed                                                                                                                                                                            |
| Octopus merge                          | `git merge -m "sync" origin/integration origin/preprod` on `uat`, then promote from `uat`                                              | the merge is left whole: opening up a merge with more than two parents would lose every side but the second one                                                                                                                                                                                                                              |
| Promotion that cannot be opened up     | the octopus case above, when one of its sides is a promotion branch                                                                    | the candidate keeps the promotion number, and the declaration is expanded into the stories it names before the vehicle is dropped: the offered rows are still User Stories                                                                                                                                                                   |
| Sync merge inside a story              | merge the major branch into a feature branch, then merge that feature branch                                                           | the candidate lists the story only: the major branch's own Pull Request must not be offered, declared or have its actions run                                                                                                                                                                                                                |
| Supersede a promotion                  | assemble a promotion, then assemble another one from the same source with the same stories                                             | the confirmation names the open promotion, then the candidate list offers those stories again with no "Already promoted by" mark, and `--include-already-promoted` is not needed                                                                                                                                                             |
| Branch merged twice                    | merge a feature branch, push a fix on it, merge it again, then promote                                                                 | the candidate lists the Pull Request once, never once with its number and once as a "-" row                                                                                                                                                                                                                                                  |
| Full merge after a partial promotion   | promote some stories of a branch, then open an ordinary merge of the whole branch into the same target                                 | the stories already promoted are named `already deployed through promotion branch(es)` and their actions skipped, the ones never promoted arrive for the first time and run theirs. Afterwards nothing is left waiting for promotion: the merge base moved                                                                                   |
| Restricted promotion steps             | narrow `allowedPromotionSteps` to the single `uat -> preprod` entry, then try `--source-branch integration` and `--target-branch main` | both are refused naming the allowed steps, `--source-branch uat` still works, and the DevOps Pipeline shows **Create promotion** on `uat` only. Restore the three entries before the rest of the run                                                                                                                                         |
| Promotion steps not declared           | remove `allowedPromotionSteps` from `config/.sfdx-hardis.yml` and run `promotion:create`                                               | the command stops asking for the list and linking to the doc page, before listing anything. Put it back afterwards                                                                                                                                                                                                                           |
| Two yaml blocks with the same key      | a description declaring `deploymentApexTestClasses` in two separate blocks                                                             | the union of both is selected, the second block does not replace the first                                                                                                                                                                                                                                                                   |
| A committed conflict prompt report     | commit `hardis-report/promotion-conflicts-prompt-*.md` on the promotion branch                                                         | the marker gate stays silent: it matches `<<<<<<< ` at the start of a line, and the report only mentions the markers inline                                                                                                                                                                                                                  |
| Single place in the diagram            | section 7bis                                                                                                                           | each promoted number appears in one branch only                                                                                                                                                                                                                                                                                              |
| Pipeline before and after a promotion  | section 4bis, `pipeline_check` around every promotion operation                                                                        | the open promotion is drawn on the arrow of its step and takes nothing out of the source branch until it is merged; afterwards the stories are listed in the branch they reached, the counter bubbles follow, and no story is listed in two branches or in none                                                                              |
| Counter bubble against its own list    | every `pipeline_check`, no expectations needed                                                                                         | the number on a branch node equals the number of User Stories the modal lists under it                                                                                                                                                                                                                                                       |

## 6bis. Backpromote (Beta)

`hardis:work:backpromote` brings what was merged in `integration` into a developer's own org. It is
tested here on the same repository, from a developer feature branch, against **scratch orgs**: a
backpromote refuses production orgs and the orgs of the major branches, which is what `$ORG` is.

What each org already received is **not stored locally**: every Pull Request deployed into an org
gets a `<!-- sfdx-hardis backpromote-state -->` comment recording the Salesforce Organization Id, the
date, the merge commit and its deployment action results. The command refuses to run without a git
provider connection. The listing starts after the newest Pull Request already backpromoted to the
org; `--from` lists older ones.

It runs after section 4, or on its own right after sections 2 and 3 once the BUILD stream merges of
section 4 are done (`#1`, `#2`, `#3` merged into `integration`). The expectations below name the
groups of that short run; after a full section 4, the story numbers created below are higher and the
retrofit merge is one more group.

### Setup

```bash
cd "$WORK"
git fetch -q origin
ROOT=$(git rev-list --max-parents=0 origin/integration)    # the base project commit
BPX="C:/git/sfdx-hardis/.claude/skills/promotion-branches-e2e/reference/backpromote"   # expectations
echo '{"orgName":"promo e2e dev","edition":"Developer"}' >"$LOGS/scratch-def.json"
sf org create scratch --definition-file "$LOGS/scratch-def.json" --target-dev-hub "$DEVHUB" \
  --alias "$DEVORG" --duration-days 1 --wait 30
DEVUSER=$(sf org display --target-org "$DEVORG" --json | node -pe "JSON.parse(require('fs').readFileSync(0)).result.username")

# The developer's org starts from the base project, before any story
git worktree add -f "$LOGS/bp-base" "$ROOT"
(cd "$LOGS/bp-base" && sf project deploy start --source-dir force-app --target-org "$DEVORG" --ignore-conflicts)
git worktree remove --force "$LOGS/bp-base"

# The developer's branch already contains everything integration has
git checkout -q -f integration && git pull -q origin integration
git checkout -q -b feature/E2E-401-dev
```

### Steps

Run them in this order: each one starts from the state the previous one left.

| Step | Command | Expected |
|------|---------|----------|
| B0 Not connected | `e2e_backpromote_nogit_json bp-no-git --plan --from "$ROOT"`, then the same without `--plan` | `not-connected.json`: plan `blocked` on the `gitProvider` check, inviting to connect; the run exits 1 with the same message, before listing anything |
| B1 Org of a major branch | add `targetUsername: <DEVUSER>` to `config/branches/.sfdx-hardis.uat.yml` without committing, `e2e_backpromote_json bp-refused-major --plan --from "$ROOT"`, then `e2e_backpromote bp-refused-major-run --agent --from "$ROOT"`, then `git checkout -- config/branches` | `refused-major.json`: plan `blocked`, check `targetOrg` fails naming the `uat` branch, no group listed. The run exits 1 with the same message |
| B2 Production org | `e2e_backpromote_json bp-refused-prod --plan --from "$ROOT" --target-org "$ORG"` | `refused-production.json`: `blocked`, `is a production org` |
| B3 Plan | `e2e_backpromote_json bp-plan-1 --plan --from "$ROOT"` | `plan-1.json`: `ready`, org type `scratch`, the five checks pass, groups `#1` `#2` `#3` pending and trackable with their static resource, every item `newToOrg`, the four actions |
| B4 Pull Requests picked one by one | `e2e_backpromote bp-run-1-3 --agent --from "$ROOT" --pull-requests 1,3` | exit 0, `E2E pre-deploy of PR 1` and `of PR 3` in the log, nothing of PR 2; `E2E_S1` and `E2E_S3` in the org, `E2E_S2` not. `backpromote_comment 1` and `backpromote_comment 3` show a history table naming the scratch org, `backpromote_comment 2` shows nothing; the comment of #1 lists `E2E pre-deploy of PR 1` as done and `E2E manual step of PR 1` as manual. `config/user/` holds no `backpromoteState` |
| B5 Window after the last backpromoted | `e2e_backpromote_json bp-plan-2 --plan` (no `--from`), then `e2e_backpromote_json bp-plan-2-from --plan --from "$ROOT"` | `plan-2.json`: `upToDate`, only `#3` listed as done, `olderFrom` set, `#2` not listed. `plan-2-from.json`: `#2` pending, `#1` and `#3` done in this org, only the action of #2 left |
| B6 The one left out, no actions | `e2e_backpromote bp-run-2 --agent --from "$ROOT" --pull-requests 2 --skip-actions` | exit 0, `Deployment actions skipped (--skip-actions)`, `E2E_S2` in the org, `backpromote_comment 2` now names the org |
| B7 Unknown Pull Request | `e2e_backpromote bp-unknown --agent --pull-requests 999` | exit 1, `These Pull Requests are not waiting to be backpromoted from integration: 999`, with the `--from` hint |
| B8 Changed in the org and in integration | the S7 commands below, then `e2e_backpromote_json bp-plan-3 --plan` | `plan-3.json`: `ApexClass:PromoE2EAlphaTest` is `changedInOrg` and `mergeable` |
| B9 Prepare the merge | `e2e_backpromote_json bp-prepare --pull-requests $S7 --prepare-merge ApexClass:PromoE2EAlphaTest` | `prepare.json`: one file with 1 conflict block; the class holds `<<<<<<< your org`, `\|\|\|\|\|\|\| last backpromoted` and `>>>>>>> integration`; `nextCommand` carries `--merged-metadata ApexClass:PromoE2EAlphaTest`; `hardis-report/backpromote-merge-prompt-*.md` exists |
| B10 Markers left | run `nextCommand` as it is, through `e2e_backpromote bp-merged-markers --agent <its flags>` | exit 1, `Solve the conflict markers left in these files before deploying them`, nothing deployed |
| B11 Merge solved and deployed | solve with the node one-liner below, then `e2e_backpromote bp-merged --agent <the same flags>` | exit 0, `Commit the merged files with your User Story`, the org class body holds **both** lines. `git status` shows the class modified, nothing else outside `hardis-report/`. Commit it on the developer branch (`git commit -qam "chore: keep the org change of PromoE2EAlphaTest"`) |
| B12 Keep the org version | the S8 commands below, then `e2e_backpromote bp-keep-org --agent --pull-requests $S8 --exclude-metadata ApexClass:PromoE2EBetaTest` | exit 0, `1 item(s) left out of the deployment`, the org still has its own version of `PromoE2EBetaTest` |
| B13 Declined deletions | the S9 commands below, `e2e_backpromote_json bp-plan-4 --plan`, then `e2e_backpromote bp-skip-destructive --agent --pull-requests $S9 --skip-destructive` | `plan-4.json` lists the deletion of `StaticResource:E2E_S1`; the run exits 0 and `E2E_S1` is **still** in the org |
| B14 Dirty tree | `echo x >> NOTES.md`, `e2e_backpromote_json bp-dirty --plan`, then `git checkout -- NOTES.md` | `dirty.json`: `blocked`, check `gitClean` fails listing `NOTES.md` and nothing under `hardis-report/` |
| B15 Terminal prompts | `node "$DEV" hardis:work:backpromote --target-org "$DEVORG"` by hand, answer the prompts | one multiselect of the pending Pull Requests (newest first, preselected), then per item changed in the org: deploy / keep the org version / merge. Not scriptable: say "not covered" when skipped |
| B16 Refreshed sandbox (new org) | create a second scratch org `$DEVORG2` from the Dev Hub with the base project, then `DEVORG="$DEVORG2" e2e_backpromote_json bp-new-org --plan --from "$ROOT"` | `new-org.json`: `#1` `#2` `#3` pending again (the history is per org id), each naming the first scratch org in `backpromotedTo`, and the actions of #1 not done. Delete `$DEVORG2` afterwards |

Queries and helper commands:

```bash
# Static resources of the stories present in the developer org
sf data query --target-org "$DEVORG" --query "SELECT Name FROM StaticResource WHERE Name LIKE 'E2E_S%' ORDER BY Name"

# S7: the developer changes a line of PromoE2EAlphaTest directly in their org...
git checkout -q feature/E2E-401-dev
sed -i "s/'promotion branches end to end test'/'changed in the dev org'/" force-app/main/default/classes/PromoE2EAlphaTest.cls
sf project deploy start --metadata ApexClass:PromoE2EAlphaTest --target-org "$DEVORG" --ignore-conflicts
git checkout -- force-app/main/default/classes/PromoE2EAlphaTest.cls
# ...while a teammate changes the same line in integration
git checkout -q -f integration && git pull -q origin integration && git checkout -q -b feature/E2E-105-apex
sed -i "s/'promotion branches end to end test'/'incoming from integration'/" force-app/main/default/classes/PromoE2EAlphaTest.cls
git commit -qam "feat: E2E-105 apex change" && git push -q -u origin feature/E2E-105-apex
S7=$(gh pr create --repo "$REPO" --base integration --head feature/E2E-105-apex --title "E2E-105 apex change" --body "Story S7: backpromote conflict." | grep -o '[0-9]*$')
gh pr merge "$S7" --repo "$REPO" --merge --delete-branch=false
git checkout -q feature/E2E-401-dev && git fetch -q origin && git merge -q --no-edit origin/integration

# B11: keep both lines of the conflict
node -e "const fs=require('fs');const f='force-app/main/default/classes/PromoE2EAlphaTest.cls';const s=fs.readFileSync(f,'utf8');fs.writeFileSync(f,s.replace(/<<<<<<< your org\r?\n([\s\S]*?)\r?\n\|\|\|\|\|\|\| [\s\S]*?\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> integration/,(m,org,inc)=>org+'\n'+inc))"
sf data query --use-tooling-api --target-org "$DEVORG" --query "SELECT Body FROM ApexClass WHERE Name = 'PromoE2EAlphaTest'" --json | grep -o "changed in the dev org\|incoming from integration"

# S8: the same shape on PromoE2EBetaTest, deployed with --exclude-metadata
git checkout -q feature/E2E-401-dev
sed -i "s/'promotion branches end to end test'/'kept in the dev org'/" force-app/main/default/classes/PromoE2EBetaTest.cls
sf project deploy start --metadata ApexClass:PromoE2EBetaTest --target-org "$DEVORG" --ignore-conflicts
git checkout -- force-app/main/default/classes/PromoE2EBetaTest.cls
git checkout -q -f integration && git pull -q origin integration && git checkout -q -b feature/E2E-106-apex
sed -i "s/'promotion branches end to end test'/'not deployed by the backpromote'/" force-app/main/default/classes/PromoE2EBetaTest.cls
git commit -qam "feat: E2E-106 apex change" && git push -q -u origin feature/E2E-106-apex
S8=$(gh pr create --repo "$REPO" --base integration --head feature/E2E-106-apex --title "E2E-106 apex change" --body "Story S8: keep the org version." | grep -o '[0-9]*$')
gh pr merge "$S8" --repo "$REPO" --merge --delete-branch=false
git checkout -q feature/E2E-401-dev && git fetch -q origin && git merge -q --no-edit origin/integration

# S9: a story deleting the static resource of S1
git checkout -q -f integration && git pull -q origin integration && git checkout -q -b feature/E2E-107-delete
git rm -q force-app/main/default/staticresources/E2E_S1.resource force-app/main/default/staticresources/E2E_S1.resource-meta.xml
git commit -qm "feat: E2E-107 remove E2E_S1" && git push -q -u origin feature/E2E-107-delete
S9=$(gh pr create --repo "$REPO" --base integration --head feature/E2E-107-delete --title "E2E-107 delete E2E_S1" --body "Story S9: deletion." | grep -o '[0-9]*$')
gh pr merge "$S9" --repo "$REPO" --merge --delete-branch=false
git checkout -q feature/E2E-401-dev && git fetch -q origin && git merge -q --no-edit origin/integration
```

### What the VS Code panel adds

The Backpromote (Beta) panel of vscode-sfdx-hardis reads the same `--plan --json` document, passes
the extension's git provider credentials to the CLI, and runs the same command with flags. Its
command builder and its not-connected state are covered by the extension's tests; this run does not
click the panel. Say so in the report.

### Traps

- **`--from` on the first run.** An org with nothing recorded lists the last 50 first-parent commits
  of `origin/integration`, base project commit included (a group with no Pull Request, never
  preselected). `--from "$ROOT"` keeps the expectations stable.
- **The window starts after the newest Pull Request already backpromoted to the org.** A Pull
  Request left out and older than that one is only listed again with `--from`: B5 checks both.
- **The feature branch must contain the latest `origin/integration`.** Merge it after every story
  merged in `integration`, or every run stops on the up-to-date check.
- **The history is in the Pull Request comments, not in `config/user/`.** Read it with
  `backpromote_comment <pr>`; a stale `backpromoteState` in an old user config is ignored.
- **sfdx-git-delta runs one at a time.** Parallel runs fail on `could not lock config file .git/config`.

## 7. Traps met while writing this

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
- **Writing into the user's `.gitignore`** to work around the dirty-tree check is not a fix: it
  only moves the failure to the modified `.gitignore`.
- **The A/B scripts cannot be run from inside the sfdx-hardis working copy.** Section 7ter checks
  out `origin/main`, which takes `.claude/skills/` away with it, and the second half of each pair
  silently runs nothing. Copy `ab-run.sh`, `ab-run-gitlab.sh`, `ab-run-azure.sh`, `ab-diff.py`
  and the matching `e2e-lib-*.sh` somewhere else first, and call them by absolute path.
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
EXT=C:/git/vscode-sfdx-hardis \
  node .claude/skills/promotion-branches-e2e/scripts/check-diagram.cjs \
  "$REPO" integration,uat,preprod,main
```

The script fetches every Pull Request with `gh`, normalises the state like
`GitProviderGitHub.convertToPullRequest` does, then calls the compiled
`out/utils/pipeline/promotionBranchUtils.js`: `expandPullRequestsWithPromotions`,
`buildPromotionIndex`, `annotateAlreadyPromoted`, `enforceSinglePlacePerPullRequest` and
`userStoryPullRequests`. It prints the counter of each branch node with the Pull Requests it lists,
and exits non-zero if a number appears twice. It also prints the counts the two toggles produce,
which must be higher.

The extension must be compiled first (`cd $EXT && yarn compile`), on the branch under test.

On Azure DevOps, `check-diagram-azure.cjs` does the same from the Azure DevOps API:

```bash
EXT=C:/git/vscode-sfdx-hardis AZ_ORG="$AZ_ORG" AZ_PROJECT="$AZ_PROJECT" AZ_TOKEN="$AZ_TOKEN"   node .claude/skills/promotion-branches-e2e/scripts/check-diagram-azure.cjs   "$AZ_REPO_NAME" integration,uat,preprod,main
```

On GitLab, `check-diagram-gitlab.cjs` does the same from the GitLab API:

```bash
EXT=C:/git/vscode-sfdx-hardis GL_HOST="$GL_HOST" GL_TOKEN="$GL_TOKEN" \
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
CLI=C:/git/sfdx-hardis
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
informational line saying it is treated as an ordinary feature branch). Anything else is a
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
export WORK="/c/tmp/promo-e2e-gl" LOGS="/c/tmp/promo-e2e-gl-logs"
export DEV="C:/git/sfdx-hardis/bin/dev.js"
source .claude/skills/promotion-branches-e2e/scripts/e2e-lib-gitlab.sh
```

Set the project to merge commits and never squash, otherwise the `-x` trailers are lost:

```bash
curl -X PUT -H "PRIVATE-TOKEN: $GL_TOKEN" "$GL_HOST/api/v4/projects/$PROJECT_ID" \
  -d merge_method=merge -d squash_option=never -d only_allow_merge_if_pipeline_succeeds=false
```

Then follow sections 3 to 7 with `gl_check` / `gl_deploy` / `gl_promote` / `gl_release_notes`.

Traps that only bite on GitLab:

- **`refs/merge-requests/<iid>/merge` is written lazily.** After a push to the source branch it
  still points at the previous merge, and `GET /merge_requests/:iid/merge_ref` hands back the stale
  `commit_id` while the new one is computed. A validation job then runs against a tree missing the
  commit you just pushed, and the result looks like a product bug: deployment actions "not found",
  conflict markers "still there" after you solved them. `gl_check` waits until the merge ref
  actually contains the head of the source branch. Never trust a GitLab validation result you got
  within seconds of a push without that wait.
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
export ORG="your.user@example.com"
export AZ_ORG="yourorg"                    # https://dev.azure.com/<AZ_ORG>/
export AZ_PROJECT="tests-sfdx-hardis"      # the team project holding the repository
export AZ_REPO_NAME="sfdx-hardis-promo-e2e-az-1"
export AZ_REPO_ID="..."                    # the GUID the creation API answers with
export AZ_TOKEN="..."                      # PAT: Code read/write, Pull Request threads read/write
export WORK="/c/tmp/promo-e2e-az" LOGS="/c/tmp/promo-e2e-az-logs"
export DEV="C:/git/sfdx-hardis/bin/dev.js"
source .claude/skills/promotion-branches-e2e/scripts/e2e-lib-azure.sh
```

Create the repository, and read back its GUID, with the REST API:

```bash
curl -sS -u ":$AZ_TOKEN" -H "Content-Type: application/json" -d '{"name":"'"$AZ_REPO_NAME"'"}'   "https://dev.azure.com/$AZ_ORG/$AZ_PROJECT/_apis/git/repositories?api-version=7.1"
```

Push with the token in the remote URL: `https://azure:$AZ_TOKEN@dev.azure.com/$AZ_ORG/$AZ_PROJECT/_git/$AZ_REPO_NAME`.
Then follow sections 3 to 7 with `az_check` / `az_deploy` / `az_promote` / `az_release_notes`.

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
  under a real Windows path (`C:/tmp/...`), or the description is posted empty and the creation
  fails with "Both a source and target reference is required".
- `az repos` (the Azure CLI) is not used anywhere: it needs its own login, prints its own
  decorations, and cannot set the completion options the merge needs. Everything goes through
  `curl` with the PAT.

## 8ter. What is different on Bitbucket Cloud

Exercised live twice on 2026-09-07 and 2026-09-08, on `galerieslafayette/test-prom-e2e`. The
first workspace tried, `test-sfdx-hardis-2`, is over its user limit: every repository in it is
read-only and `git push` answers HTTP 402, with nothing in the API to warn you beforehand.

```bash
export ORG="your.user@example.com"
export BB_WORKSPACE="test-sfdx-hardis-2"
export BB_REPO="sfdx-hardis-promo-e2e-bb-1"
export BB_EMAIL="you@example.com"          # empty for a workspace/repository Access Token
export BB_TOKEN="..."
export WORK="/c/tmp/promo-e2e-bb" LOGS="/c/tmp/promo-e2e-bb-logs"
export DEV="C:/git/sfdx-hardis/bin/dev.js"
source .claude/skills/promotion-branches-e2e/scripts/e2e-lib-bitbucket.sh
```

Create the repository with the REST API (a project key is required in a workspace that has one):

```bash
curl -sS -u "$BB_EMAIL:$BB_TOKEN" -X POST -H "Content-Type: application/json"   -d '{"scm":"git","is_private":true,"project":{"key":"TES"}}'   "https://api.bitbucket.org/2.0/repositories/$BB_WORKSPACE/$BB_REPO"
```

Then follow sections 3 to 7 with `bb_check` / `bb_deploy` / `bb_promote` / `bb_release_notes`.

Traps already met on Bitbucket:

- **A classic Atlassian API token does not work.** It authenticates but answers
  `API Token provided has no Bitbucket scopes`. Create an API token **with scopes** covering
  Bitbucket (`read`/`write`/`admin:repository:bitbucket`, `read`/`write:pullrequest:bitbucket`), or
  a workspace Access Token. sfdx-hardis reads `CI_SFDX_HARDIS_BITBUCKET_TOKEN`, plus
  `CI_SFDX_HARDIS_BITBUCKET_EMAIL` when the token is an Atlassian API token (Basic auth); without
  the email it authenticates as a Bearer token, which is what an Access Token needs.
- **The REST API and `git push` do not take the same username.** The API wants the Atlassian
  account email; `git push` refuses it (and the `@` also has to be percent-encoded to survive the
  URL). Use `https://x-token-auth:<token>@bitbucket.org/<workspace>/<repo>.git`.
- **A workspace over its user limit is read-only**, with a plain HTTP 402 on push. Nothing in the
  API says so beforehand; the repository can still be created.
- Merge with `merge_strategy: merge_commit` and `close_source_branch: false`, never squash, or the
  `-x` trailers of the cherry-picks are lost.
- **Bitbucket Cloud publishes no merge ref.** Neither `refs/pull-requests/<id>/merge` nor
  `.../from` is fetchable, and `git ls-remote` advertises none of them. A `pull-requests:` pipeline
  checks out the **source** branch and merges the destination into it before running the steps, so
  that is what `bb_checkout_pr_merge` reproduces. This is the one place where the Bitbucket harness
  differs in kind from the other three: there is no lazily written ref to wait for, and a merge
  conflict shows up at checkout rather than as a stale tree.
- **A repository access token is scoped to its repository**, so a rerun cannot create a second one
  and has to reuse the same repository. Reset it by deleting every branch but `main` and
  force-pushing the base project. Two artefacts follow, neither of them a product defect:
  - the Pull Requests of the previous run stay in the repository, so pass `MIN_PR=<first new
    number>` to `check-diagram-bitbucket.cjs` to keep the windows readable, and expect an old
    major-to-major Pull Request to turn up in a deployment scope, matched by its source branch;
  - re-creating a Pull Request between the same two branches **reopens the declined one** of the
    previous run instead of creating a new number.

## 9. Cleaning up

The repository is disposable. `gh repo delete "$REPO" --yes` needs the `delete_repo` scope
(`gh auth refresh -h github.com -s delete_repo`). The static resources, labels and Apex classes
left in the org are prefixed `PromoE2E` / `E2E_` and can be removed with a destructive changes
deployment. Delete the backpromote scratch orgs with `sf org delete scratch --target-org "$DEVORG" --no-prompt` (and `$DEVORG2`). The backpromote history comments disappear with the repository.
