---
name: pr-watch-fix
description: Watch the GitHub PR for the current branch, wait for CI to finish, and autonomously fix failing jobs by reading logs, editing sources, and pushing. Stops cleanly when stuck.
allowed-tools: Bash Read Grep Glob Edit Write AskUserQuestion Agent
user-invocable: true
model: sonnet
---

Watch the open PR for the current branch, wait for CI, and fix failures.

You are the **orchestrator**. You run on Sonnet and stay light: you coordinate, wait, ask the user when needed, and report. You delegate the two heavy parts to subagents (this is what keeps token usage down):

- **Collecting PR state and failing logs** -> the `pr-watch` agent (Haiku). Cheap, mechanical `gh`/`jq`/log work. Spawn it via the Agent tool each time you need a fresh snapshot.
- **Analyzing and fixing failures** -> the `pr-fix` agent (Opus). It diagnoses, edits sources, validates, commits and pushes. Spawn it via the Agent tool when there are failures.

The waiting between cycles uses a persistent `Monitor` (cheap bash polling, no model cost). Interactive questions to the user happen here in the orchestrator, because a subagent cannot talk back to the user - `pr-fix` returns a `NEEDS-USER-INPUT` block and you turn that into an `AskUserQuestion`.

## Loop

Repeat until the PR is fully green or you stop intentionally.

### 0. Stop any prior PR-watch Monitor

Re-invoking `/pr-watch-fix` always wins. Use `TaskList` to find Monitors whose description starts with `PR watch:` and call `TaskStop` on each. Do not stop tasks that don't start with this prefix - they belong to other work.

### 1. Find the PR

```bash
BRANCH="$(git branch --show-current)"
PR_JSON="$(gh pr list --head "$BRANCH" --state open --json number,url,headRefOid --limit 1)"
PR_NUMBER="$(printf '%s' "$PR_JSON" | jq -r '.[0].number // empty')"
```

If `PR_NUMBER` is empty -> **STOP**. Tell the user there is no open PR for the branch. Save the PR URL and `headRefOid`.

### 2. Collect CI state (delegate to `pr-watch`)

Spawn the `pr-watch` agent (Haiku) via the Agent tool, passing the PR number and branch. It returns a structured snapshot: `state` (`green` / `failures` / `running` / `no-pr`), the still-running count, and for each failure the job, workflow, `errorType`, and key log lines.

Trust its `state`, but remember the rule it encodes: "done" requires BOTH zero pending checks AND zero still-running runs for the current HEAD SHA (a fresh run can lag 30-90s before registering as a check).

### 3. Act on the state

- **`green`** -> **STOP**. Report success and the PR URL.
- **`failures`** -> go to step 5 (fix).
- **`running`** -> go to step 4 (wait).

### 4. Wait for running jobs

Poll every **5 minutes**, fixed interval, no backoff - the user wants a 5-minute cadence so failures surface fast. Use a persistent `Monitor` with a description starting with `PR watch:` so step 0 of a future invocation can find and stop it. The Monitor does plain `gh`/`jq` polling (no model) and emits only on state changes (new failures or completion), not every 5 minutes.

```
Monitor:
  description: "PR watch: PR #1903 CI"
  persistent: true
  command: |
    while true; do
      checks="$(gh pr checks 1903 --json name,bucket 2>/dev/null || echo '[]')"
      runs="$(gh run list --branch BRANCH --limit 20 --json status,conclusion,name 2>/dev/null || echo '[]')"

      counts="$(jq -r '[.[] | .bucket] | group_by(.) | map("\(.[0])=\(length)") | join(" ")' <<<"$checks")"
      pending_checks="$(jq -r '[.[] | select(.bucket=="pending")] | length' <<<"$checks")"
      pending_runs="$(jq -r '[.[] | select(.status=="in_progress" or .status=="queued" or .status=="requested" or .status=="waiting" or .status=="pending")] | length' <<<"$runs")"
      fail_now="$(jq -r '[.[] | select(.bucket=="fail" or .bucket=="cancel") | .name] | sort | join(",")' <<<"$checks")"

      if [ -n "$fail_now" ] && [ "$fail_now" != "${prev_fail:-}" ]; then
        echo "[failures] $fail_now ($counts)"
        prev_fail="$fail_now"
      fi

      if [ "$pending_checks" = "0" ] && [ "$pending_runs" = "0" ]; then
        echo "[final] checks: $counts | runs: 0 in-progress"
        break
      fi
      sleep 300
    done
```

Replace `BRANCH` and the PR number when instantiating. When the Monitor wakes you (state change or completion), go back to step 2 and re-collect with `pr-watch`.

If the same check has been pending more than **90 minutes** without a state change, the Monitor must emit a `[stalled]` event and you should **ask the user** whether to keep waiting. (MegaLinter + nuts on Windows can legitimately take 20-40 min; don't panic before 90.) Do not poll faster than 5 minutes.

### 5. Fix the failures (delegate to `pr-fix`)

Spawn the `pr-fix` agent (Opus) via the Agent tool. Pass it the branch, PR number, current HEAD SHA, and the failure list from `pr-watch` (job names, error types, key log lines). `pr-fix` owns the diagnosis, the fix, local validation (`yarn compile` / `yarn lint` / `yarn test:only` / `yarn build:doc`), and the commit + push (including the MegaLinter `--force-with-lease` reconcile and all the git-safety rules).

`pr-fix` returns one of:

- **A fix report** (job fixed, root cause, files changed, new HEAD SHA pushed) -> note the new SHA, sleep ~60s for GitHub to register new runs, then go back to step 2.
- **A `NEEDS-USER-INPUT` block** (ambiguous cause, likely flake, fork-PR secret error, generated-artifact edit, non-bot commits on origin, more than 3 cycles without progress) -> **do not loop**. Turn it into an `AskUserQuestion`: show the failing job, the key error line, the agent's hypothesis, and offer its 2-3 options plus "stop and let me investigate". Wait for the user.

If a single subtask inside the fix is pure i18n key propagation across the 9 locales, you may instead spawn the `i18n-translate` agent (Sonnet) for that part.

### 6. Loop

Go back to step 1. The loop ends when:

- All checks pass -> success report.
- You asked the user a question (loop pauses until they answer).
- `pr-fix` reported it hit the 3-cycle cap without progress -> ask before continuing.
- The user interrupts.

## Reporting

Each time you wake from a poll or finish a fix cycle, give the user **one short line**:

```
Cycle 2: linux-unit-tests failed (TS2345 in src/common/utils/i18n.ts:42), pushed e0a44f1. Waiting 5m.
```

Do not paste full job logs into the conversation. Summarize and link to the run.

## Safety

The detailed git-safety rules live in the `pr-fix` agent (it owns commit/push). As orchestrator, hold these invariants:

- `git push` is the only network-mutating action - never push to `main`/`master`.
- Force-push is authorized in exactly one case: rebasing onto a landed `[MegaLinter] Apply linters fixes` commit, with `--force-with-lease`. Any other force-push needs explicit user permission - if `pr-fix` reports it needs one, ask the user.
- If `gh` is not authenticated or the repo isn't a GitHub repo, **STOP** and tell the user.
- Never edit generated files, never bypass Husky hooks (`--no-verify`), use **Yarn** not npm. `pr-fix` enforces these; if it reports a violation it could not avoid, stop and ask.
