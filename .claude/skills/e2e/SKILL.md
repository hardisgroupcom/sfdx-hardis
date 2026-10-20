---
name: e2e
description: End to end tests of sfdx-hardis against real Salesforce orgs and throwaway git repositories, one scenario per feature - promotion branches and backpromote (GitHub, GitLab, Azure DevOps, Bitbucket Cloud), replacement rules, deployment action types (command, apex, run-batch, schedule-batch, remove-packagexml-items, user-access-policy, manual), the three promoted together through promotion branches, and the training course walked as a learner. Use when a change must be proven in real CI jobs or real orgs because unit tests cannot cover it, or when the user asks for an end to end / e2e / hardcore test, to walk the labs, to test the training, or names one of these features with "end to end".
argument-hint: "<promotion-branches|replacement-rules|deployment-actions|promotion-rules-actions|training> [scenario arguments]"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, WebFetch, AskUserQuestion
user-invocable: true
model: opus
---

# End to end tests

Each scenario proves one feature against real Salesforce orgs, real CI jobs running sfdx-hardis built
from the branch under test, and real Pull Requests, then writes a report. A scenario lives in its own
folder under `scenarios/`: its `README.md` is the procedure, next to its `scripts/`, `reference/` and
`reports/`.

## Pick the scenario

| Scenario                                                     | Run it when                                                                                                                                                                                                                                                 | Duration                       |
|--------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------|
| [promotion-branches](scenarios/promotion-branches/README.md) | Promotion branches (`enablePromotionBranches`, `hardis:project:promotion:create`) or backpromote (`hardis:work:backpromote`, the VS Code Backpromote panel) changed, or the user asks for the promotion branches / backpromote end to end or hardcore test. | About 45 minutes, per provider |
| [replacement-rules](scenarios/replacement-rules/README.md)   | Replacement rules (`replacementRules`, `hardis:project:replacement:*`, the Replacement Rules panel, the built-in rules) changed.                                                                                                                            | About 35 minutes               |
| [deployment-actions](scenarios/deployment-actions/README.md) | An action type, the generic action code (`actionUtils.ts`, `action:create`, `action:update`, the `ActionsProvider` hooks) or `runOnlyOnceByOrg` changed.                                                                                                    | About 30 minutes               |
| [promotion-rules-actions](scenarios/promotion-rules-actions/README.md) | Promotion branches, replacement rules and deployment actions together: where a promotion picks the rules of its target, a rule or an action travels with a story, or the order of actions, rules and file restore in `deploy:smart` changed. | About 1h30, per provider |
| [training](scenarios/training/README.md)                     | The user asks to test the training, walk the labs, run the course or a level end to end, or a change to sfdx-hardis or vscode-sfdx-hardis is too broad for reading the labs (`training-impact`) to settle.                                                  | One level to a full night      |

Read the `README.md` of the scenario before anything else, and follow it: prerequisites, the run, what
each step proves, the traps. When the request matches no scenario, say so and propose the closest
one, or a new scenario (below).

## Shared harness

The CI harness of the [promotion-branches](scenarios/promotion-branches/README.md) scenario is used by
every scenario that runs CI jobs: source it from `scenarios/promotion-branches/scripts/`, never copy it.

| File                        | Use                                                                                                                                                                         |
|-----------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `env-lib.sh`, `env-lib.cjs` | Settings: the environment, else `.env` at the root of the working copy, else defaults. `E2E_ROOT` is the working copy, `E2E_TMP` the OS temp dir.                           |
| `ci-workflows-prepare.cjs`  | Writes the sfdx-hardis CI workflows of a provider into a project, with a step that clones, builds and links the branch under test, and the `SFDX_AUTH_URL_<BRANCH>` logins. |
| `ci-provider-<provider>.sh` | Creates the remote, waits for a workflow run of a commit and saves its log, reruns a run, reads the Pull Request comments.                                                  |
| `reference/env.example`     | Every variable the scenarios read, names only.                                                                                                                              |

The training scenario has its own harness (`scenarios/training/scripts/env.sh` and `env.mjs`): it
works in the sibling clones of the course, not in a throwaway repository.

## Rules for every scenario

- **The branch under test is pushed first.** The CI jobs clone it from `hardisgroupcom/sfdx-hardis`:
  an unpushed fix is not tested.
- **Run long scenarios in the background** and watch their `[FAIL]` lines. Never edit a script while
  it runs (bash reads it as it goes): fix it after the run, then replay the steps the scenario
  documents.
- **A check that cannot run says SKIP with the reason, never OK.** A wrong expectation found during a
  run is fixed in the script and written in the scenario `README.md` traps, not only in the report.
- **Each run writes its report** in the `reports/` folder of its scenario.
- **Clean up** what the run created (throwaway repositories, scratch orgs) once the report is written,
  unless the user wants to look at them.
- **No customer name** in a report, a commit or a Pull Request: throwaway orgs and repositories only.

## Add a scenario

1. Create `scenarios/<name>/` with `README.md` (what it proves, prerequisites, how to run, what each
   step proves, traps), `scripts/` and `reports/`.
2. Reuse the shared harness by a path relative to the script (`$HERE/../../promotion-branches/scripts`),
   so the scenario runs from any working copy or worktree.
3. Add its row to the table above, and its feature to the `description` of this skill.
