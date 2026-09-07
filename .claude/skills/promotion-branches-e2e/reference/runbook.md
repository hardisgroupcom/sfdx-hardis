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
- A local vscode-sfdx-hardis working copy on the matching branch, compiled (`yarn dev`), for the
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
mkdir -p "$LOGS"
```

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

# P1: integration -> uat carrying S1 and S3 only
e2e_promote integration 1,3 "promotion-integration-uat"   # creates Pull Request P1
e2e_check <P1> uat "check-promotion-uat"
gh pr merge <P1> --repo "$REPO" --merge --delete-branch=false
e2e_deploy uat "deploy-uat-promotion"

# Stories validated directly in uat
for pr in 4 5; do e2e_check $pr uat "check-pr$pr"; done
for pr in 4 5; do gh pr merge $pr --repo "$REPO" --merge --delete-branch=false
                  e2e_deploy uat "deploy-uat-pr$pr"; done

# P2: uat -> preprod carrying S4 only
e2e_promote uat 4 "promotion-uat-preprod"
e2e_check <P2> preprod "check-promotion-preprod"
gh pr merge <P2> --repo "$REPO" --merge --delete-branch=false
e2e_deploy preprod "deploy-preprod-promotion"

# P3: uat -> preprod carrying the MERGE COMMIT of P1, so the stories under it.
# Not <P1>: a promotion Pull Request is a vehicle, it is no longer a candidate, and passing its
# number is answered with "not among the Pull Requests waiting for promotion". Pass one of the
# stories it carried: the candidate is the group labelled "#3, #1" and selecting either takes both.
e2e_promote uat 3 "promotion-uat-preprod-nested"

# RUN stream: hotfix straight into preprod
e2e_check 6 preprod "check-pr6-hotfix"
gh pr merge 6 --repo "$REPO" --merge --delete-branch=false
e2e_deploy preprod "deploy-preprod-pr6"

# P4: preprod -> main carrying two promotions AND the hotfix (two levels of nesting)
e2e_promote preprod <P2>,<P3>,6 "promotion-preprod-main"
e2e_check <P4> main "check-promotion-main"
gh pr merge <P4> --repo "$REPO" --merge --delete-branch=false
e2e_deploy main "deploy-main-promotion"

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
| retrofit validation / deployment               | the go-live promotion is expanded, then `Pull Request N was already deployed through promotion branch(es) ...` for each story already shipped                                                                                                                                                        |
| release notes of the go-live                   | `hardis-report/release-notes/main-<date>/release-notes-main-<date>.md` lists the **User Stories**, not the promotion Pull Requests: the Pull Request count, the contributor counts and the ticket rows must name the stories only. With `--include-promotions`, the vehicles are listed next to them |

Check the deployment action state from the git provider too:

```bash
gh api "repos/$REPO/issues/1/comments" --jq '.[] | select(.body | contains("Deployment Actions")) | .body'
```

The "Status by org branch" table must have one column per org branch the story reached, and one
pending manual checkbox per org branch.

## 6. Edge cases to run at the end

| Case                                   | How                                                                                                                                    | Expected                                                                                                                                                                                                                                                   |
|----------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Already promoted                       | `e2e_promote uat 4 ...` after the `uat -> preprod` promotion is merged                                                                 | the candidate table shows `Already promoted by promotion/uat/preprod/...`, a warning names `--include-already-promoted`, no branch created                                                                                                                 |
| Empty cherry-pick                      | same with `--include-already-promoted`                                                                                                 | `Nothing to cherry-pick ...: this change is already in the target branch`, branch undone, tree clean, **exit 0**. Not a conflict                                                                                                                           |
| Empty cherry-pick, dirty report folder | the same while `hardis-report/` is untracked                                                                                           | identical result: the cleanliness check and the emptiness test must both ignore the report directory                                                                                                                                                       |
| Conflict, agent default                | two stories on the shared `CustomLabels` file merged into integration, promote only the second                                         | `Cherry-pick conflict on #N (...): the promotion has been undone`, no leftover branch                                                                                                                                                                      |
| Conflict, kept                         | same with `--on-conflict commit-with-markers`                                                                                          | Pull Request created, `hardis-report/promotion-conflicts-prompt-*.md` written, prompt embedded in the description                                                                                                                                          |
| Marker guard                           | validate that Pull Request                                                                                                             | job fails: `still contains git conflict markers in N file(s): ...`                                                                                                                                                                                         |
| Marker guard, solved                   | solve as the prompt says, push, validate again                                                                                         | job passes                                                                                                                                                                                                                                                 |
| Conflict outside force-app             | make two stories diverge on `NOTES.md` (both sides must hold the file with different content, otherwise git leaves no marker)          | the marker gate still catches it and names `NOTES.md`                                                                                                                                                                                                      |
| Feature off                            | set `enablePromotionBranches: false` in the checked-out tree and validate a promotion Pull Request                                     | one informational line, scope = the Pull Request alone, everything else unchanged                                                                                                                                                                          |
| Hand-named branch                      | branch `promotion/hand-made-by-a-human` with a `promotionPullRequests` block in its description                                        | warning `starts with promotion/ but does not follow the promotion branch naming ...`, treated as a feature branch, declaration ignored                                                                                                                     |
| Retargeted promotion                   | open a `promotion/uat/preprod/...` branch against `main`                                                                               | treated as an ordinary branch, scope is the Pull Request alone, with a warning naming the mismatch. **The declared stories must not run their actions against production**                                                                                 |
| Grouped merge commit                   | promote a candidate whose label lists several numbers (`#7, #6, #4 ...`)                                                               | the command names the numbers nobody asked for **before** cherry-picking, and declares them all                                                                                                                                                            |
| Unreadable declaration                 | declare a Pull Request number that does not exist                                                                                      | warning and skip, not a failure                                                                                                                                                                                                                            |
| Sync merge inside a story              | merge the major branch into a feature branch, then merge that feature branch                                                           | the candidate lists the story only: the major branch's own Pull Request must not be offered, declared or have its actions run                                                                                                                              |
| Supersede a promotion                  | assemble a promotion, then assemble another one from the same source with the same stories                                             | the confirmation names the open promotion, then the candidate list offers those stories again with no "Already promoted by" mark, and `--include-already-promoted` is not needed                                                                           |
| Branch merged twice                    | merge a feature branch, push a fix on it, merge it again, then promote                                                                 | the candidate lists the Pull Request once, never once with its number and once as a "-" row                                                                                                                                                                |
| Full merge after a partial promotion   | promote some stories of a branch, then open an ordinary merge of the whole branch into the same target                                 | the stories already promoted are named `already deployed through promotion branch(es)` and their actions skipped, the ones never promoted arrive for the first time and run theirs. Afterwards nothing is left waiting for promotion: the merge base moved |
| Restricted promotion steps             | narrow `allowedPromotionSteps` to the single `uat -> preprod` entry, then try `--source-branch integration` and `--target-branch main` | both are refused naming the allowed steps, `--source-branch uat` still works, and the DevOps Pipeline shows **Create promotion** on `uat` only. Restore the three entries before the rest of the run                                                       |
| Promotion steps not declared           | remove `allowedPromotionSteps` from `config/.sfdx-hardis.yml` and run `promotion:create`                                               | the command stops asking for the list and linking to the doc page, before listing anything. Put it back afterwards                                                                                                                                         |
| Two yaml blocks with the same key      | a description declaring `deploymentApexTestClasses` in two separate blocks                                                             | the union of both is selected, the second block does not replace the first                                                                                                                                                                                 |
| A committed conflict prompt report     | commit `hardis-report/promotion-conflicts-prompt-*.md` on the promotion branch                                                         | the marker gate stays silent: it matches `<<<<<<< ` at the start of a line, and the report only mentions the markers inline                                                                                                                                |
| Single place in the diagram            | section 7bis                                                                                                                           | each promoted number appears in one branch only                                                                                                                                                                                                            |

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
  <promotion number>` is refused. Select one of the stories it carried.

## 7bis. Checking the "one place in the diagram" rule

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

The extension must be compiled first (`cd $EXT && yarn dev`), on the branch under test.

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
regression. Switching the CLI checkout in place is safe as long as `package.json` and `yarn.lock`
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

**Not yet exercised live.** The harness below is written and its credentials are proven, but the
run itself has never happened: the `test-sfdx-hardis-2` workspace is over its user limit, so every
repository in it is read-only and `git push` answers HTTP 402. Whoever restores write access can
run sections 3 to 7 with it and finish this section.

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
- The `refs/pull-requests/<id>/merge` ref is recomputed after a push, so `bb_check` waits until it
  holds the head of the source branch, like the other two providers.

## 9. Cleaning up

The repository is disposable. `gh repo delete "$REPO" --yes` needs the `delete_repo` scope
(`gh auth refresh -h github.com -s delete_repo`). The static resources, labels and Apex classes
left in the org are prefixed `PromoE2E` / `E2E_` and can be removed with a destructive changes
deployment.
