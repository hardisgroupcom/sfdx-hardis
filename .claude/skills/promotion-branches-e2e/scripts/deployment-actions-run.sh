#!/usr/bin/env bash
# Runbook section 6quater on GitHub or GitLab: the deployment action features built on top of the
# promotion pipeline. Run it after promotion-run.sh (and promotion-edge.sh when you run it), on the
# same repository: it reads $LOGS/promo-vars.sh and adds the stories S8 and S9.
#
#   export PROVIDER=github|gitlab ORG WORK LOGS DEV API <the provider library variables>
#   export DEV_ORG=<a scratch org or developer sandbox username>   # optional, section D
#   bash deployment-actions-run.sh
#
#   A  a pre-deployment manual action stops the validation until it is marked as done; a draft
#      Pull Request is not stopped
#   B  a failed post-deployment action and the actions it stopped, retried with action:run, the
#      manual step closed with set-status, a headless retry refused where nothing failed
#   C  a manual action marked as done ahead in uat, the forecast of the next promotion before and
#      after it, the validation and deployment of the promotion skipping what was marked
#   D  (DEV_ORG set) the actions tried in a developer org, recorded in the Backpromotes comment,
#      and skipped there on the next run
#
# Prints one line per assertion and writes $LOGS/results-section6quater.txt.
set -uo pipefail
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${PROVIDER:?set PROVIDER to github or gitlab}"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/promotion-provider.sh"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/stories.sh"
# shellcheck source=/dev/null
source "$LOGS/promo-vars.sh"
: "${S2:?run promotion-run.sh first: S2 is read from $LOGS/promo-vars.sh}"
cd "$WORK" || exit 1

RESULTS="$LOGS/results-section6quater.txt"
: >"$RESULTS"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/section-lib.sh"
BODIES="$(cygpath -m "$LOGS" 2>/dev/null || echo "$LOGS")/bodies"
mkdir -p "$BODIES"

# ------------------------------------------------------------------ the stories
cat >"$BODIES/s8.md" <<'MD'
Story S8 recovery: a pre-deployment manual step, a post-deployment action that fails once, and the actions after it.
MD
cat >"$BODIES/s9.md" <<'MD'
Story S9, a draft: its pre-deployment manual step must not stop the validation.
MD
echo "=== section 6quater: the stories S8 and S9 ==="
rm -f "$WORK/e2e-recovery-ok.txt"
# The file the flaky command looks for is untracked on purpose: kept out of git status, or
# promotion:create refuses the working copy as not clean
grep -qx "e2e-recovery-ok.txt" "$WORK/.git/info/exclude" 2>/dev/null || echo "e2e-recovery-ok.txt" >>"$WORK/.git/info/exclude"
# The org of each major branch, declared like in a real project: action:run checks the org it is
# given against it, and --dev-org refuses it
git checkout -q -f integration && git pull -q origin integration
ORG_JSON=$(env -u NODE_OPTIONS sf org display --target-org "$ORG" --json 2>/dev/null)
ORG_USERNAME=$(echo "$ORG_JSON" | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).result.username)")
ORG_INSTANCE=$(echo "$ORG_JSON" | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).result.instanceUrl)")
for f in config/branches/.sfdx-hardis.*.yml; do
  grep -q "^targetUsername:" "$f" || printf 'targetUsername: %s\ninstanceUrl: %s\n' "$ORG_USERNAME" "$ORG_INSTANCE" >>"$f"
done
# Section A tests the manual action gate, off by default
grep -q "^failValidationOnPendingManualActions:" config/.sfdx-hardis.yml || printf 'failValidationOnPendingManualActions: true\n' >>config/.sfdx-hardis.yml
if ! git diff --quiet; then
  git add config && git commit -qm "chore: declare the org of each major branch, turn the manual action gate on" && git push -q origin integration
fi
# DA_RUN names a second run of this section on the same repository (its story branches differ)
SUFFIX="${DA_RUN:+-$DA_RUN}"
S8=$(open_story "feature/E2E-401-recovery$SUFFIX" integration "E2E_S8${DA_RUN:-}" "E2E-401 S8 recovery$SUFFIX" "$BODIES/s8.md" recovery) || exit 1
S9=$(open_story "feature/E2E-402-draft$SUFFIX" integration "E2E_S9${DA_RUN:-}" "E2E-402 S9 draft gate$SUFFIX" "$BODIES/s9.md" pre-manual) || exit 1
printf 'export S8="%s"\nexport S9="%s"\n' "$S8" "$S9" >>"$LOGS/promo-vars.sh"
echo "S8=$S8 S9=$S9"

# ------------------------------------------------------------------ A. the manual action gate
echo "=== A. a pre-deployment manual action stops the validation ==="
p_wait_merge_ref "$S8" >/dev/null 2>&1
job p_check "$S8" integration "da-check-s8-gate"
assert_log A1 da-check-s8-gate 1 "the validation stops on the pending pre-deployment manual action, before the deployment check" \
  "1 pre-deployment manual action\(s\) not marked as performed in integration" "E2E pre-deploy manual of PR $S8" \
  "action:set-status --pr $S8 --action-id \"e2e-gate-$S8\" --org-branch integration" "!Deployment mode:"
cli da-set-status-gate integration hardis:project:action:set-status --agent --pr "$S8" --action-id "e2e-gate-$S8" --org-branch integration --target-org "$ORG"
assert_log A2 da-set-status-gate 0 "set-status marks the manual action as done in integration" "E2E pre-deploy manual of PR $S8"
status_check A3 da-status-gate-done "the action is success in integration, with the note naming who" "--pr-ids $S8" \
  "S:$S8:e2e-gate-$S8:integration=success" "N:$S8:e2e-gate-$S8:integration~Manual action marked as done by"
job p_check "$S8" integration "da-check-s8-rerun"
assert_log A4 da-check-s8-rerun 0 "the validation run again skips the action done and goes on" \
  "Skipping E2E pre-deploy manual of PR $S8 .*already run in integration" "!not marked as performed in integration"
p_wait_merge_ref "$S9" >/dev/null 2>&1
job p_check "$S9" integration "da-check-s9-draft"
assert_log A5 da-check-s9-draft 0 "a Pull Request with draft in its title is not stopped, only warned" \
  "the Pull Request is a draft, so the validation goes on"
p_close "$S9" >/dev/null 2>&1

# ------------------------------------------------------------------ B. failure, retry, set-status
echo "=== B. a failed post-deployment action, retried ==="
p_merge "$S8" >/dev/null || record "merge-$S8" FAIL "merge of #$S8"
job p_deploy integration da-deploy-integration-s8
assert_log B1 da-deploy-integration-s8 1 "the flaky action fails and stops the ones after it; the pre-deployment manual action done is skipped" \
  "Skipping E2E pre-deploy manual of PR $S8 .*already run in integration" "Action E2E flaky post-deploy of PR $S8 failed, stopping execution of further actions"
status_check B2 da-status-after-failure "failed, then the two actions it stopped" "--pr-ids $S8" \
  "S:$S8:e2e-flaky-$S8:integration=failed" "S:$S8:e2e-after-flaky-$S8:integration=not-run" "S:$S8:e2e-manual-$S8:integration=not-run"
# The fix of a failed action that needs no new metadata: here, the file the command looks for
echo ok >"$WORK/e2e-recovery-ok.txt"
cli da-run-retry integration hardis:project:action:run --agent --pr "$S8" --action-id "e2e-flaky-$S8" --org-branch integration --target-org "$ORG" --next all
assert_log B3 da-run-retry 0 "action:run retries the failed action, then runs the ones it stopped" \
  "E2E flaky post-deploy of PR $S8" "E2E after the flaky one of PR $S8"
status_check B4 da-status-after-retry "both commands success with a run locally note, the manual step waiting" "--pr-ids $S8" \
  "S:$S8:e2e-flaky-$S8:integration=success" "N:$S8:e2e-flaky-$S8:integration~Run locally by" \
  "S:$S8:e2e-after-flaky-$S8:integration=success" "S:$S8:e2e-manual-$S8:integration=manual"
cli da-set-status-manual integration hardis:project:action:set-status --agent --pr "$S8" --action-id "e2e-manual-$S8" --org-branch integration --target-org "$ORG"
status_check B5 da-status-manual-done "the post-deployment manual step closed with set-status" "--pr-ids $S8" \
  "S:$S8:e2e-manual-$S8:integration=success" "N:$S8:e2e-manual-$S8:integration~Manual action marked as done by"
cli da-run-refused integration hardis:project:action:run --agent --pr "$S8" --action-id "e2e-after-flaky-$S8" --org-branch preprod --target-org "$ORG" --allow-branch-mismatch
assert_log B6 da-run-refused 1 "in agent mode, a retry where nothing failed is refused" "nothing records it in preprod"

# ------------------------------------------------------------------ C. mark as done ahead, forecast
echo "=== C. marked as done ahead in uat, forecast of the promotion ==="
cli da-set-status-ahead integration hardis:project:action:set-status --agent --pr "$S8" --action-id "e2e-gate-$S8" --org-branch uat --target-org "$ORG"
status_check C1 da-status-ahead "marked as done in uat before any deployment to uat" "--pr-ids $S8" \
  "S:$S8:e2e-gate-$S8:uat=success" "N:$S8:e2e-gate-$S8:uat~before any deployment to uat"
job p_promote integration "$S8" da-promotion-integration-uat
P6=$(promo_number da-promotion-integration-uat)
printf 'export P6="%s"\n' "$P6" >>"$LOGS/promo-vars.sh"
assert_log C2 da-promotion-integration-uat 0 "P6 #$P6 carries #$S8 only" "assembled with 1 User Story\(ies\): #$S8"
status_check C3 da-forecast-open "forecast of the promotion to uat, P6 open" "--pr-ids $S8,$S2 --forecast uat --from-branch integration" \
  "P=$P6" "C:$S8=yes" "C:$S2=no" "F:$S8:e2e-gate-$S8=done" "F:$S8:e2e-flaky-$S8=runs-at-deployment/deploy-only" \
  "F:$S8:e2e-manual-$S8=after-merge/manual-after-merge" "F:$S2:e2e-post-$S2=not-in-promotion"
p_wait_merge_ref "$P6" >/dev/null 2>&1
job p_check "$P6" uat da-check-promotion-uat
assert_log C4 da-check-promotion-uat 0 "the validation of P6 skips the manual action marked ahead, and is not stopped" \
  "Skipping E2E pre-deploy manual of PR $S8 .*already run in uat" "!not marked as performed in uat"
p_merge "$P6" >/dev/null || record "merge-$P6" FAIL "merge of #$P6"
job p_deploy uat da-deploy-uat-promotion
assert_log C5 da-deploy-uat-promotion 0 "the deployment of P6 runs the commands and skips the manual action marked ahead" \
  "Skipping E2E pre-deploy manual of PR $S8 .*already run in uat" "Running action E2E flaky post-deploy of PR $S8"
# No expectation on the post-deployment manual step: a forecast is about stories not merged yet,
# and it reads after-merge for that step whatever is recorded in uat
status_check C6 da-forecast-after "forecast once P6 is merged: no promotion open, the commands done in uat" "--pr-ids $S8 --forecast uat --from-branch integration" \
  "P=none" "F:$S8:e2e-flaky-$S8=done" "F:$S8:e2e-gate-$S8=done"

# ------------------------------------------------------------------ D. developer org
if [ -n "${DEV_ORG:-}" ]; then
  echo "=== D. the actions tried in a developer org ==="
  cli da-run-dev-org integration hardis:project:action:run --agent --pr "$S8" --all --dev-org --target-org "$DEV_ORG"
  assert_log D1 da-run-dev-org 0 "every action of #$S8 tried in the developer org" "E2E flaky post-deploy of PR $S8"
  status_check D2 da-status-dev-org "recorded under dev-sandboxes and in the Backpromotes comment of #$S8" "--pr-ids $S8 --with-backpromotes" \
    "S:$S8:e2e-flaky-$S8:dev-sandboxes=success" "B:$S8:e2e-flaky-$S8=success" "B:$S8:e2e-after-flaky-$S8=success"
  cli da-run-dev-org-again integration hardis:project:action:run --agent --pr "$S8" --all --dev-org --target-org "$DEV_ORG"
  assert_log D3 da-run-dev-org-again 0 "the second run skips what is already done in this org" \
    "Skipping E2E flaky post-deploy of PR $S8: already done in this org"
  cli da-run-major-refused integration hardis:project:action:run --agent --pr "$S8" --all --dev-org --target-org "$ORG"
  assert_log D4 da-run-major-refused 1 "--dev-org refuses an org of a major branch" "!Running action"
else
  record D SKIP "DEV_ORG not set: the developer org runs and the Backpromotes rows are not covered"
fi

echo
echo "=== section 6quater summary ==="
echo "$(grep -c '| OK |' "$RESULTS") OK"
echo "$(grep -c '| FAIL |' "$RESULTS") FAIL"
grep "| FAIL |" "$RESULTS" || true
echo "SECTION 6QUATER DONE"
