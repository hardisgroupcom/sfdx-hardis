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

Each writes `$LOGS/<label>.log` and echoes the exit code.

## 2. Build the repository

Four major branches, all deployed to the same org.

```bash
mkdir -p "$WORK" && cd "$WORK" && git init -q -b main
```

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

Give **S1 two separate `yaml` blocks** in its description (the test classes, then a second block
added later): both must be read.

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

# P3: uat -> preprod carrying the MERGE COMMIT of P1, so P1 and the stories under it
e2e_promote uat <P1> "promotion-uat-preprod-nested"

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

| Case                                   | How                                                                                                                           | Expected                                                                                                                                                                   |
|----------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Already promoted                       | `e2e_promote uat 4 ...` after the `uat -> preprod` promotion is merged                                                        | the candidate table shows `Already promoted by promotion/uat/preprod/...`, a warning names `--include-already-promoted`, no branch created                                 |
| Empty cherry-pick                      | same with `--include-already-promoted`                                                                                        | `Nothing to cherry-pick ...: this change is already in the target branch`, branch undone, tree clean, **exit 0**. Not a conflict                                           |
| Empty cherry-pick, dirty report folder | the same while `hardis-report/` is untracked                                                                                  | identical result: the cleanliness check and the emptiness test must both ignore the report directory                                                                       |
| Conflict, agent default                | two stories on the shared `CustomLabels` file merged into integration, promote only the second                                | `Cherry-pick conflict on #N (...): the promotion has been undone`, no leftover branch                                                                                      |
| Conflict, kept                         | same with `--on-conflict commit-with-markers`                                                                                 | Pull Request created, `hardis-report/promotion-conflicts-prompt-*.md` written, prompt embedded in the description                                                          |
| Marker guard                           | validate that Pull Request                                                                                                    | job fails: `still contains git conflict markers in N file(s): ...`                                                                                                         |
| Marker guard, solved                   | solve as the prompt says, push, validate again                                                                                | job passes                                                                                                                                                                 |
| Conflict outside force-app             | make two stories diverge on `NOTES.md` (both sides must hold the file with different content, otherwise git leaves no marker) | the marker gate still catches it and names `NOTES.md`                                                                                                                      |
| Feature off                            | set `enablePromotionBranches: false` in the checked-out tree and validate a promotion Pull Request                            | one informational line, scope = the Pull Request alone, everything else unchanged                                                                                          |
| Hand-named branch                      | branch `promotion/hand-made-by-a-human` with a `promotionPullRequests` block in its description                               | warning `starts with promotion/ but does not follow the promotion branch naming ...`, treated as a feature branch, declaration ignored                                     |
| Retargeted promotion                   | open a `promotion/uat/preprod/...` branch against `main`                                                                      | treated as an ordinary branch, scope is the Pull Request alone, with a warning naming the mismatch. **The declared stories must not run their actions against production** |
| Grouped merge commit                   | promote a candidate whose label lists several numbers (`#7, #6, #4 ...`)                                                      | the command names the numbers nobody asked for **before** cherry-picking, and declares them all                                                                            |
| Unreadable declaration                 | declare a Pull Request number that does not exist                                                                             | warning and skip, not a failure                                                                                                                                            |
| Sync merge inside a story              | merge the major branch into a feature branch, then merge that feature branch                                                  | the candidate lists the story only: the major branch's own Pull Request must not be offered, declared or have its actions run                                              |
| Branch merged twice                    | merge a feature branch, push a fix on it, merge it again, then promote                                                        | the candidate lists the Pull Request once, never once with its number and once as a "-" row                                                                                |
| Single place in the diagram            | section 7bis                                                                                                                  | each promoted number appears in one branch only                                                                                                                            |

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

## 8. Cleaning up

The repository is disposable. `gh repo delete "$REPO" --yes` needs the `delete_repo` scope
(`gh auth refresh -h github.com -s delete_repo`). The static resources, labels and Apex classes
left in the org are prefixed `PromoE2E` / `E2E_` and can be removed with a destructive changes
deployment.
