#!/usr/bin/env bash
# Runbook section 6sexies on GitHub, GitLab, Azure DevOps or Bitbucket Cloud: identical deployment actions run once per run
# (issue #2271). Run it after promotion-run.sh, on the same repository: it reads
# $LOGS/promo-vars.sh and adds eight stories into integration, promoted together to uat.
#
#   export PROVIDER=github|gitlab|azure|bitbucket ORG WORK LOGS DEV API <the provider library variables>
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
#   I8  (DEV_ORG set) the backpromote run of the window runs the shared step once for the Pull
#       Requests that carry it and writes the copies as done in their Backpromotes comments
#   I9  the same action in the uat branch config and in a Pull Request: the config one runs, its
#       repeat in the config runs, the Pull Request one is done by it
#   I10 the same action with context all: the validation job of the promotion runs it once and
#       records the copy, the deployment job finds both done
#
# The shared step appends one character to e2e-identical-count.txt in the working copy: the size
# of that file is the number of real runs, whatever the logs say.
#
# Prints one line per assertion and writes $LOGS/results-section6sexies.txt.
set -uo pipefail
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${PROVIDER:?set PROVIDER to github, gitlab, azure or bitbucket}"
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
SW=$(new_story 503-shared-twice E2E_IA_T identical-twice "the shared step twice, another step between them") || exit 1
SP=$(new_story 504-shared-pre E2E_IA_P identical-pre "the shared step, before the deployment") || exit 1
SX=$(new_story 505-same-id-a E2E_IA_X same-id-a "a hand-written action id, command A") || exit 1
SY=$(new_story 506-same-id-b E2E_IA_Y same-id-b "the same action id, command B") || exit 1
SF=$(new_story 507-flaky E2E_IA_F flaky-uat "a post-deployment command failing in uat") || exit 1
SC=$(new_story 508-shared-c E2E_IA_C identical "the shared step, after the failure") || exit 1
printf 'export SA="%s"\nexport SB="%s"\nexport SW="%s"\nexport SP="%s"\nexport SX="%s"\nexport SY="%s"\nexport SF="%s"\nexport SC="%s"\n' \
  "$SA" "$SB" "$SW" "$SP" "$SX" "$SY" "$SF" "$SC" >>"$LOGS/promo-vars.sh"
echo "SA=$SA SB=$SB SW=$SW SP=$SP SX=$SX SY=$SY SF=$SF SC=$SC"
LIST="$SA,$SB,$SW,$SP,$SX,$SY,$SF,$SC"
# The job log names an action "<label> (from PR #<n>)": the suffix keeps #1 from matching #12
shared() { echo "E2E shared step of PR $1 \\(from PR #$1\\)"; }
NOTE="Not run twice: the identical action \"E2E shared step of PR $SA\" of #$SA"
COPY_OF_SA="same action as E2E shared step of PR $SA \\(#$SA\\), run once for this deployment"

# ------------------------------------------------------------------ I1. one Pull Request, the step twice
echo "=== I1. the shared step written twice in one Pull Request ==="
for pr in "$SA" "$SB" "$SW"; do
  p_merge "$pr" >/dev/null || record "merge-$pr" FAIL "merge of #$pr"
done
# The deployment of a feature merge carries that Pull Request alone: #SW here
rm -f "$COUNT_FILE"
job p_deploy integration ia-deploy-integration-twice
assert_log I1 ia-deploy-integration-twice 0 "the deployment of #$SW runs both of its shared steps: one Pull Request is one source" \
  "Running action $(shared "$SW")" "Running action E2E shared step again of PR $SW \(from PR #$SW\)" "!same action as"
assert_runs I1b 2 "the shared step ran twice in integration"
for pr in "$SP" "$SX" "$SY" "$SF" "$SC"; do
  p_merge "$pr" >/dev/null || record "merge-$pr" FAIL "merge of #$pr"
done

# ------------------------------------------------------------------ I2. the forecast of the promotion
echo "=== I2. the forecast of the promotion to uat ==="
job p_promote integration "$LIST" ia-promotion-integration-uat
PI=$(promo_number ia-promotion-integration-uat)
printf 'export PI="%s"\n' "$PI" >>"$LOGS/promo-vars.sh"
assert_log I2 ia-promotion-integration-uat 0 "PI #$PI carries the eight stories" "assembled with 8 User Story\(ies\)"
status_check I2b ia-forecast-open "the copies run once with the shared step of #$SA; the repeat, the other phase and the same id on their own" \
  "--pr-ids $LIST --forecast uat --from-branch integration" \
  "P=$PI" \
  "F:$SA:e2e-shared-$SA=runs-at-deployment/deploy-only" "I:$SA:e2e-shared-$SA=none" \
  "F:$SB:e2e-shared-$SB=runs-at-deployment/identical-action" "I:$SB:e2e-shared-$SB=$SA:e2e-shared-$SA" \
  "I:$SW:e2e-shared-$SW=$SA:e2e-shared-$SA" "I:$SW:e2e-shared-again-$SW=none" \
  "I:$SP:e2e-shared-pre-$SP=none" "I:$SX:e2e-same-id=none" "I:$SY:e2e-same-id=none" \
  "I:$SC:e2e-shared-$SC=$SA:e2e-shared-$SA"

# ------------------------------------------------------------------ I3. the deployment of the promotion
echo "=== I3. the deployment of the promotion ==="
p_wait_merge_ref "$PI" >/dev/null 2>&1
job p_check "$PI" uat ia-check-promotion-uat
assert_log I3a ia-check-promotion-uat 0 "the validation runs no deployment-only action, so it merges nothing" "!same action as"
p_merge "$PI" >/dev/null || record "merge-$PI" FAIL "merge of #$PI"
rm -f "$COUNT_FILE"
job p_deploy uat ia-deploy-uat
assert_log I3 ia-deploy-uat 1 "one run of the shared step stands for the other Pull Requests; the repeat, the other phase and both same-id actions run; the failure stops the job" \
  "Running action E2E shared step before the deployment of PR $SP \(from PR #$SP\)" \
  "Running action $(shared "$SA")" \
  "Skipping action $(shared "$SB"): $COPY_OF_SA" \
  "Skipping action $(shared "$SW"): $COPY_OF_SA" \
  "Running action E2E shared step again of PR $SW \(from PR #$SW\)" \
  "Running action E2E same id, command A of PR $SX \(from PR #$SX\)" \
  "Running action E2E same id, command B of PR $SY \(from PR #$SY\)" \
  "Action E2E flaky post-deploy of PR $SF failed, stopping execution of further actions" \
  "Skipping action $(shared "$SC"): $COPY_OF_SA" \
  "!Skipping E2E same id.*already run in uat"
assert_runs I3b 3 "the shared step ran three times: before the deployment for #$SP, then for #$SA and again for #$SW"

# ------------------------------------------------------------------ I4. the state of each Pull Request
echo "=== I4. the Deployment Actions comment of each Pull Request ==="
status_check I4 ia-status-uat "the copies done with the note, the repeat and both same-id actions run, the failure failed" \
  "--pr-ids $LIST" \
  "S:$SA:e2e-shared-$SA:uat=success" \
  "S:$SB:e2e-shared-$SB:uat=success" "N:$SB:e2e-shared-$SB:uat~$NOTE" \
  "S:$SW:e2e-shared-$SW:uat=success" "N:$SW:e2e-shared-$SW:uat~$NOTE" "S:$SW:e2e-shared-again-$SW:uat=success" \
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

# ------------------------------------------------------------------ I7 I8. the backpromote of the window
if [ -n "${DEV_ORG:-}" ]; then
  echo "=== I7. the backpromote plan of the window ==="
  # From a branch of the developer, never from a major branch
  git checkout -q -f integration && git pull -q origin integration
  git checkout -q -B "e2e/identical-dev$SUFFIX"
  # A readable sandbox name: a scratch org would be named after its org id
  IA_SANDBOX="ia-dev${IA_RUN:-}"
  p_cli hardis:work:backpromote --agent --plan --json --target-org "$DEV_ORG" --parent-branch integration --sandbox-name "$IA_SANDBOX" --from-pull-request "$SA" \
    >"$LOGS/ia-backpromote-plan.json" 2>"$LOGS/ia-backpromote-plan.err"
  if out=$(node "$PLAN_CHECKER" "$(cygpath -m "$LOGS/ia-backpromote-plan.json" 2>/dev/null || echo "$LOGS/ia-backpromote-plan.json")" \
    U "I:$SA:e2e-shared-$SA=none" "I:$SB:e2e-shared-$SB=$SA:e2e-shared-$SA" "I:$SW:e2e-shared-$SW=$SA:e2e-shared-$SA" \
    "I:$SW:e2e-shared-again-$SW=none" "I:$SC:e2e-shared-$SC=$SA:e2e-shared-$SA" \
    "K:$SX:post:e2e-same-id" "K:$SY:post:e2e-same-id" "I:$SY:e2e-same-id=none" 2>&1); then
    record I7 OK "ia-backpromote-plan: the copies point at the shared step of #$SA, every action has its own key"
  else
    record I7 FAIL "ia-backpromote-plan: $(echo "$out" | grep -E '^FAIL' | tr '\n' ';')"
  fi
  echo "$out" >"$LOGS/ia-backpromote-plan.check"

  echo "=== I8. the backpromote run of the window ==="
  # One backpromote is one run: the shared step runs once for the Pull Requests that carry it, the
  # repeat of SW and the pre-deployment one run, both same-id actions run. SF only runs in uat.
  IA_RUN_ID=$(node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log((j.result||j.data||{}).runId||'')" <"$LOGS/ia-backpromote-plan.json")
  rm -f "$COUNT_FILE"
  p_cli hardis:work:backpromote --auto --json --target-org "$DEV_ORG" --parent-branch integration --sandbox-name "$IA_SANDBOX" --from-pull-request "$SA" \
    ${IA_RUN_ID:+--run-id "$IA_RUN_ID"} >"$LOGS/ia-backpromote-run.json" 2>"$LOGS/ia-backpromote-run.err"
  if out=$(node "$PLAN_CHECKER" "$(cygpath -m "$LOGS/ia-backpromote-run.json" 2>/dev/null || echo "$LOGS/ia-backpromote-run.json")" \
    "R:$SA:post:e2e-shared-$SA=run" "R:$SB:post:e2e-shared-$SB=identical" "R:$SW:post:e2e-shared-$SW=identical" \
    "R:$SW:post:e2e-shared-again-$SW=run" "R:$SP:pre:e2e-shared-pre-$SP=run" \
    "R:$SX:post:e2e-same-id=run" "R:$SY:post:e2e-same-id=run" "R:$SC:post:e2e-shared-$SC=identical" 2>&1); then
    record I8 OK "ia-backpromote-run: the copies are identical, the repeat, the other phase and both same-id actions run"
  else
    record I8 FAIL "ia-backpromote-run: $(echo "$out" | grep -E '^FAIL' | tr '\n' ';')"
  fi
  echo "$out" >"$LOGS/ia-backpromote-run.check"
  assert_runs I8b 3 "the backpromote ran the shared step three times: before the deployment for #$SP, then for #$SA and again for #$SW"
  status_check I8c ia-backpromote-rows "the copies are done in the Backpromotes comments of their own Pull Requests" "--pr-ids $SB,$SC --with-backpromotes" \
    "B:$SB:e2e-shared-$SB=success" "B:$SC:e2e-shared-$SC=success"
  git checkout -q -f integration
else
  record I7 SKIP "DEV_ORG not set: the backpromote plan and run of identical actions are not covered"
fi

# ------------------------------------------------------------------ I9. the branch config and a Pull Request
echo "=== I9. the same action in the uat config and in a Pull Request ==="
# The config is a source of its own: its action stands for the one of a Pull Request, and an action
# written twice in the config runs twice. A job runs the config actions first.
git checkout -q -f uat && git pull -q origin uat
UAT_CONFIG=config/branches/.sfdx-hardis.uat.yml
cat >>"$UAT_CONFIG" <<'YAML'
commandsPostDeploy:
  - id: e2e-config-shared
    label: E2E shared step of the uat config
    type: command
    command: >-
      node -e "require('fs').appendFileSync('e2e-identical-count.txt','r')"
    context: process-deployment-only
  - id: e2e-config-shared-again
    label: E2E shared step again of the uat config
    type: command
    command: >-
      node -e "require('fs').appendFileSync('e2e-identical-count.txt','r')"
    context: process-deployment-only
YAML
git add "$UAT_CONFIG" && git commit -qm "chore: the shared step in the uat config" && git push -q origin uat
CONFIG_COMMIT=$(git rev-parse HEAD)
SD=$(new_story 509-shared-d E2E_IA_D identical "the shared step, next to the same action in the uat config") || exit 1
printf 'export SD="%s"\n' "$SD" >>"$LOGS/promo-vars.sh"
p_merge "$SD" >/dev/null || record "merge-$SD" FAIL "merge of #$SD"
job p_promote integration "$SD" ia-promotion-config
PD=$(promo_number ia-promotion-config)
printf 'export PD="%s"\n' "$PD" >>"$LOGS/promo-vars.sh"
p_wait_merge_ref "$PD" >/dev/null 2>&1
job p_check "$PD" uat ia-check-promotion-config
p_merge "$PD" >/dev/null || record "merge-$PD" FAIL "merge of #$PD"
rm -f "$COUNT_FILE"
job p_deploy uat ia-deploy-uat-config
assert_log I9 ia-deploy-uat-config 0 "the config action runs, so does its repeat in the config, and the action of #$SD is done by the config one" \
  "Running action E2E shared step of the uat config" "Running action E2E shared step again of the uat config" \
  "Skipping action $(shared "$SD"): same action as E2E shared step of the uat config \\(branch or project config\\), run once for this deployment"
assert_runs I9b 2 "the shared step ran twice: the config action and its repeat in the config"
status_check I9c ia-status-config "the copy of #$SD is done in uat, its note names the config" "--pr-ids $SD" \
  "S:$SD:e2e-shared-$SD:uat=success" "N:$SD:e2e-shared-$SD:uat~of the branch or project config"
# The uat config of the other sections again
git checkout -q -f uat && git pull -q origin uat
git revert --no-edit "$CONFIG_COMMIT" >/dev/null && git push -q origin uat

# ------------------------------------------------------------------ I10. the validation job
echo "=== I10. the same action run by the validation job of a promotion ==="
# Context all: the validation job runs the actions too, once for the Pull Requests that carry the
# same one, and records the copy as done; the deployment job then finds both done in uat
SG=$(new_story 510-shared-check-g E2E_IA_G identical-check "the shared step with context all") || exit 1
SH=$(new_story 511-shared-check-h E2E_IA_H identical-check "the shared step with context all, in a second story") || exit 1
printf 'export SG="%s"\nexport SH="%s"\n' "$SG" "$SH" >>"$LOGS/promo-vars.sh"
for pr in "$SG" "$SH"; do
  p_merge "$pr" >/dev/null || record "merge-$pr" FAIL "merge of #$pr"
done
job p_promote integration "$SG,$SH" ia-promotion-check
PV=$(promo_number ia-promotion-check)
printf 'export PV="%s"\n' "$PV" >>"$LOGS/promo-vars.sh"
status_check I10a ia-forecast-check "the validation runs the shared step once: the copy of #$SH points at #$SG" \
  "--pr-ids $SG,$SH --forecast uat --from-branch integration" \
  "P=$PV" "F:$SG:e2e-check-shared-$SG=runs-at-validation/validation-first" "I:$SG:e2e-check-shared-$SG=none" \
  "F:$SH:e2e-check-shared-$SH=runs-at-validation/identical-action" "I:$SH:e2e-check-shared-$SH=$SG:e2e-check-shared-$SG"
p_wait_merge_ref "$PV" >/dev/null 2>&1
rm -f "$COUNT_FILE"
job p_check "$PV" uat ia-check-promotion-check
assert_log I10 ia-check-promotion-check 0 "the validation job runs the shared step for #$SG and records #$SH as done by it" \
  "Running action E2E shared check step of PR $SG \\(from PR #$SG\\)" \
  "Skipping action E2E shared check step of PR $SH \\(from PR #$SH\\): same action as E2E shared check step of PR $SG \\(#$SG\\), run once for this deployment"
assert_runs I10b 1 "the validation job ran the shared step once"
p_merge "$PV" >/dev/null || record "merge-$PV" FAIL "merge of #$PV"
rm -f "$COUNT_FILE"
job p_deploy uat ia-deploy-uat-check
assert_log I10c ia-deploy-uat-check 0 "the deployment job finds both done in uat by the validation job" \
  "Skipping E2E shared check step of PR $SG \\(from PR #$SG\\): already run in uat" \
  "Skipping E2E shared check step of PR $SH \\(from PR #$SH\\): already run in uat" "!Running action E2E shared check step"
assert_runs I10d 0 "the deployment job did not run the shared step again"

echo
echo "=== section 6sexies summary ==="
echo "$(grep -c '| OK |' "$RESULTS") OK"
echo "$(grep -c '| FAIL |' "$RESULTS") FAIL"
grep "| FAIL |" "$RESULTS" || true
echo "SECTION 6SEXIES DONE"
