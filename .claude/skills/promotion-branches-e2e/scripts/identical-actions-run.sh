#!/usr/bin/env bash
# Runbook section 6sexies on GitHub or GitLab: identical deployment actions run once per run
# (issue #2271). Run it after promotion-run.sh, on the same repository: it reads
# $LOGS/promo-vars.sh and adds eight stories into integration, promoted together to uat.
#
#   export PROVIDER=github|gitlab ORG WORK LOGS DEV API <the provider library variables>
#   export DEV_ORG=<a scratch org or developer sandbox username>   # optional, group I7
#   bash identical-actions-run.sh
#
#   I1  in integration, the shared step written twice in one Pull Request runs twice
#   I2  the forecast of the promotion to uat names the copies and the action they run with
#   I3  the deployment of the promotion runs the shared step once for the Pull Requests that carry
#       it, runs the repeat and the pre-deployment one, runs both actions reusing one id, and
#       records the copy met after a failure as done
#   I4  the Deployment Actions comment of each Pull Request: the copies done, with a note
#   I5  the failure retried with action:run
#   I6  the same deployment run again runs nothing: the copies are done in uat
#   I7  (DEV_ORG set) the backpromote plan of the window marks the copies and keys every action
#
# The shared step appends one character to e2e-identical-count.txt in the working copy: the size
# of that file is the number of real runs, whatever the logs say.
#
# Prints one line per assertion and writes $LOGS/results-section6sexies.txt.
set -uo pipefail
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${PROVIDER:?set PROVIDER to github or gitlab}"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/promotion-provider.sh"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/stories.sh"
# shellcheck source=/dev/null
source "$LOGS/promo-vars.sh"
: "${S1:?run promotion-run.sh first: S1 is read from $LOGS/promo-vars.sh}"
cd "$WORK" || exit 1

RESULTS="$LOGS/results-section6sexies.txt"
: >"$RESULTS"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/section-lib.sh"
PLAN_CHECKER="$(cygpath -m "$SCRIPTS_DIR/check-backpromote-identical.cjs" 2>/dev/null || echo "$SCRIPTS_DIR/check-backpromote-identical.cjs")"
BODIES="$(cygpath -m "$LOGS" 2>/dev/null || echo "$LOGS")/bodies"
mkdir -p "$BODIES"

COUNT_FILE="$WORK/e2e-identical-count.txt"
# How many times the shared step really ran since the last reset: one character per run
shared_runs() {
  if [ -f "$COUNT_FILE" ]; then
    wc -c <"$COUNT_FILE" | tr -d ' '
  else
    echo 0
  fi
}
# Usage: assert_runs <id> <expected count> <description>
assert_runs() {
  local got
  got=$(shared_runs)
  if [ "$got" = "$2" ]; then
    record "$1" OK "$3 ($got run(s))"
  else
    record "$1" FAIL "$3: $got run(s), expected $2"
  fi
}

# ------------------------------------------------------------------ the stories
echo "=== section 6sexies: the stories ==="
# The counter and the file the flaky command waits for are untracked on purpose, and kept out of
# git status: untracked and not excluded, promotion:create refuses the working copy as not clean
for f in e2e-identical-count.txt e2e-identical-ok.txt; do
  grep -qx "$f" "$WORK/.git/info/exclude" 2>/dev/null || echo "$f" >>"$WORK/.git/info/exclude"
done
rm -f "$COUNT_FILE" "$WORK/e2e-identical-ok.txt"
# IA_RUN names a second run of this section on the same repository (its story branches differ)
SUFFIX="${IA_RUN:+-$IA_RUN}"
new_story() {
  local slug="$1" resource="$2" kind="$3" text="$4"
  printf 'Story %s, section 6sexies: %s.\n' "$resource" "$text" >"$BODIES/$resource.md"
  open_story "feature/E2E-$slug$SUFFIX" integration "$resource${IA_RUN:-}" "E2E-$slug$SUFFIX" "$BODIES/$resource.md" "$kind"
}
# Created in this order on purpose: the Pull Request numbers grow with it, and the merge order below
# follows it, so the forecast (numbers) and the deployment (merge order) agree on the first copy
SA=$(new_story 501-shared-a E2E_IA_A identical "the shared step") || exit 1
SB=$(new_story 502-shared-b E2E_IA_B identical "the shared step, in a second story") || exit 1
ST=$(new_story 503-shared-twice E2E_IA_T identical-twice "the shared step twice, another step between them") || exit 1
SP=$(new_story 504-shared-pre E2E_IA_P identical-pre "the shared step, before the deployment") || exit 1
SX=$(new_story 505-same-id-a E2E_IA_X same-id-a "a hand-written action id, command A") || exit 1
SY=$(new_story 506-same-id-b E2E_IA_Y same-id-b "the same action id, command B") || exit 1
SF=$(new_story 507-flaky E2E_IA_F flaky-uat "a post-deployment command failing in uat") || exit 1
SC=$(new_story 508-shared-c E2E_IA_C identical "the shared step, after the failure") || exit 1
printf 'export SA="%s"\nexport SB="%s"\nexport ST="%s"\nexport SP="%s"\nexport SX="%s"\nexport SY="%s"\nexport SF="%s"\nexport SC="%s"\n' \
  "$SA" "$SB" "$ST" "$SP" "$SX" "$SY" "$SF" "$SC" >>"$LOGS/promo-vars.sh"
echo "SA=$SA SB=$SB ST=$ST SP=$SP SX=$SX SY=$SY SF=$SF SC=$SC"
LIST="$SA,$SB,$ST,$SP,$SX,$SY,$SF,$SC"
# The job log names an action "<label> (from PR #<n>)": the suffix keeps #1 from matching #12
shared() { echo "E2E shared step of PR $1 \\(from PR #$1\\)"; }
NOTE="Not run twice: the identical action \"E2E shared step of PR $SA\" of #$SA"
COPY_OF_SA="same action as E2E shared step of PR $SA \\(#$SA\\), run once for this deployment"

# ------------------------------------------------------------------ I1. one Pull Request, the step twice
echo "=== I1. the shared step written twice in one Pull Request ==="
for pr in "$SA" "$SB" "$ST"; do
  p_merge "$pr" >/dev/null || record "merge-$pr" FAIL "merge of #$pr"
done
# The deployment of a feature merge carries that Pull Request alone: #ST here
rm -f "$COUNT_FILE"
job p_deploy integration ia-deploy-integration-twice
assert_log I1 ia-deploy-integration-twice 0 "the deployment of #$ST runs both of its shared steps: one Pull Request is one source" \
  "Running action $(shared "$ST")" "Running action E2E shared step again of PR $ST \(from PR #$ST\)" "!same action as"
assert_runs I1b 2 "the shared step ran twice in integration"
for pr in "$SP" "$SX" "$SY" "$SF" "$SC"; do
  p_merge "$pr" >/dev/null || record "merge-$pr" FAIL "merge of #$pr"
done

# ------------------------------------------------------------------ I2. the forecast of the promotion
echo "=== I2. the forecast of the promotion to uat ==="
job p_promote integration "$LIST" ia-promotion-integration-uat
P7=$(promo_number ia-promotion-integration-uat)
printf 'export P7="%s"\n' "$P7" >>"$LOGS/promo-vars.sh"
assert_log I2 ia-promotion-integration-uat 0 "P7 #$P7 carries the eight stories" "assembled with 8 User Story\(ies\)"
status_check I2b ia-forecast-open "the copies run once with the shared step of #$SA; the repeat, the other phase and the same id on their own" \
  "--pr-ids $LIST --forecast uat --from-branch integration" \
  "P=$P7" \
  "F:$SA:e2e-shared-$SA=runs-at-deployment/deploy-only" "I:$SA:e2e-shared-$SA=none" \
  "F:$SB:e2e-shared-$SB=runs-at-deployment/identical-action" "I:$SB:e2e-shared-$SB=$SA:e2e-shared-$SA" \
  "I:$ST:e2e-shared-$ST=$SA:e2e-shared-$SA" "I:$ST:e2e-shared-again-$ST=none" \
  "I:$SP:e2e-shared-pre-$SP=none" "I:$SX:e2e-same-id=none" "I:$SY:e2e-same-id=none" \
  "I:$SC:e2e-shared-$SC=$SA:e2e-shared-$SA"

# ------------------------------------------------------------------ I3. the deployment of the promotion
echo "=== I3. the deployment of the promotion ==="
p_wait_merge_ref "$P7" >/dev/null 2>&1
job p_check "$P7" uat ia-check-promotion-uat
assert_log I3a ia-check-promotion-uat 0 "the validation runs no deployment-only action, so it merges nothing" "!same action as"
p_merge "$P7" >/dev/null || record "merge-$P7" FAIL "merge of #$P7"
rm -f "$COUNT_FILE"
job p_deploy uat ia-deploy-uat
assert_log I3 ia-deploy-uat 1 "one run of the shared step stands for the other Pull Requests; the repeat, the other phase and both same-id actions run; the failure stops the job" \
  "Running action E2E shared step before the deployment of PR $SP \(from PR #$SP\)" \
  "Running action $(shared "$SA")" \
  "Skipping action $(shared "$SB"): $COPY_OF_SA" \
  "Skipping action $(shared "$ST"): $COPY_OF_SA" \
  "Running action E2E shared step again of PR $ST \(from PR #$ST\)" \
  "Running action E2E same id, command A of PR $SX \(from PR #$SX\)" \
  "Running action E2E same id, command B of PR $SY \(from PR #$SY\)" \
  "Action E2E flaky post-deploy of PR $SF failed, stopping execution of further actions" \
  "Skipping action $(shared "$SC"): $COPY_OF_SA" \
  "!Skipping E2E same id.*already run in uat"
assert_runs I3b 3 "the shared step ran three times: before the deployment for #$SP, then for #$SA and again for #$ST"

# ------------------------------------------------------------------ I4. the state of each Pull Request
echo "=== I4. the Deployment Actions comment of each Pull Request ==="
status_check I4 ia-status-uat "the copies done with the note, the repeat and both same-id actions run, the failure failed" \
  "--pr-ids $LIST" \
  "S:$SA:e2e-shared-$SA:uat=success" \
  "S:$SB:e2e-shared-$SB:uat=success" "N:$SB:e2e-shared-$SB:uat~$NOTE" \
  "S:$ST:e2e-shared-$ST:uat=success" "N:$ST:e2e-shared-$ST:uat~$NOTE" "S:$ST:e2e-shared-again-$ST:uat=success" \
  "S:$SP:e2e-shared-pre-$SP:uat=success" \
  "S:$SX:e2e-same-id:uat=success" "S:$SY:e2e-same-id:uat=success" \
  "S:$SF:e2e-flaky-$SF:uat=failed" \
  "S:$SC:e2e-shared-$SC:uat=success" "N:$SC:e2e-shared-$SC:uat~$NOTE"

# ------------------------------------------------------------------ I5. the failure retried
echo "=== I5. the failure retried with action:run ==="
# The fix of a failed action that needs no new metadata: here, the file the command looks for
echo ok >"$WORK/e2e-identical-ok.txt"
cli ia-run-retry uat hardis:project:action:run --agent --pr "$SF" --action-id "e2e-flaky-$SF" --org-branch uat --target-org "$ORG" --next all
assert_log I5 ia-run-retry 0 "the failed action runs again and succeeds" "E2E flaky post-deploy of PR $SF"
status_check I5b ia-status-retry "the failure is success, with a run locally note" "--pr-ids $SF" \
  "S:$SF:e2e-flaky-$SF:uat=success" "N:$SF:e2e-flaky-$SF:uat~Run locally by"

# ------------------------------------------------------------------ I6. the same deployment again
echo "=== I6. the deployment of uat run again ==="
rm -f "$COUNT_FILE"
job p_deploy uat ia-deploy-uat-again
assert_log I6 ia-deploy-uat-again 0 "every action is already done in uat, the copies included" \
  "Skipping $(shared "$SB"): already run in uat" "Skipping $(shared "$SC"): already run in uat" \
  "!same action as" "!Running action E2E shared step"
assert_runs I6b 0 "the shared step did not run again"

# ------------------------------------------------------------------ I7. the backpromote plan
if [ -n "${DEV_ORG:-}" ]; then
  echo "=== I7. the backpromote plan of the window ==="
  # From a branch of the developer, never from a major branch
  git checkout -q -f integration && git pull -q origin integration
  git checkout -q -B "e2e/identical-dev$SUFFIX"
  p_cli hardis:work:backpromote --agent --plan --json --target-org "$DEV_ORG" --parent-branch integration --from-pull-request "$SA" \
    >"$LOGS/ia-backpromote-plan.json" 2>"$LOGS/ia-backpromote-plan.err"
  if out=$(node "$PLAN_CHECKER" "$(cygpath -m "$LOGS/ia-backpromote-plan.json" 2>/dev/null || echo "$LOGS/ia-backpromote-plan.json")" \
    U "I:$SA:e2e-shared-$SA=none" "I:$SB:e2e-shared-$SB=$SA:e2e-shared-$SA" "I:$ST:e2e-shared-$ST=$SA:e2e-shared-$SA" \
    "I:$ST:e2e-shared-again-$ST=none" "I:$SC:e2e-shared-$SC=$SA:e2e-shared-$SA" \
    "K:$SX:post:e2e-same-id" "K:$SY:post:e2e-same-id" "I:$SY:e2e-same-id=none" 2>&1); then
    record I7 OK "ia-backpromote-plan: the copies point at the shared step of #$SA, every action has its own key"
  else
    record I7 FAIL "ia-backpromote-plan: $(echo "$out" | grep -E '^FAIL' | tr '\n' ';')"
  fi
  echo "$out" >"$LOGS/ia-backpromote-plan.check"
  git checkout -q -f integration
else
  record I7 SKIP "DEV_ORG not set: the backpromote plan of identical actions is not covered"
fi

echo
echo "=== section 6sexies summary ==="
echo "$(grep -c '| OK |' "$RESULTS") OK"
echo "$(grep -c '| FAIL |' "$RESULTS") FAIL"
grep "| FAIL |" "$RESULTS" || true
echo "SECTION 6SEXIES DONE"
