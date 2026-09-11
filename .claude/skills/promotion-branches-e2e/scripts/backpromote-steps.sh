#!/usr/bin/env bash
# Runbook section 6bis, steps B0 to B9, on any git provider, after backpromote-setup.sh. Prints one
# line per assertion and a summary, and writes $LOGS/results.txt.
#
#   export BP_PROVIDER_LIB=<path to e2e-lib.sh | e2e-lib-gitlab.sh | e2e-lib-azure.sh>
#   export <the provider library variables> WORK LOGS DEV API DEVHUB DEVORG DEVORG2 ORG
#   bash backpromote-steps.sh
#
# The developer branch feature/E2E-401-dev was created before S1 to S3 were merged in integration:
# it is behind, which is what a backpromote is for.
set -uo pipefail
: "${BP_PROVIDER_LIB:?set BP_PROVIDER_LIB to the provider library}"
: "${DEVORG:?set DEVORG}" "${DEVORG2:?set DEVORG2}" "${ORG:?set ORG (a production org for B2)}"
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$BP_PROVIDER_LIB"
source "$SCRIPTS_DIR/stories.sh"
source "$LOGS/bp-vars.sh"
export BP_VAR_S1="$S1" BP_VAR_S2="$S2" BP_VAR_S3="$S3"
cd "$WORK" || exit 1
git checkout -q feature/E2E-401-dev || exit 1
DEV_BRANCH=feature/E2E-401-dev

RESULTS="$LOGS/results.txt"
: >"$RESULTS"
record() { echo "$1 | $2 | $3" | tee -a "$RESULTS"; }
ok_if() { if [ "$2" = "0" ]; then record "$1" OK "$3"; else record "$1" FAIL "$3"; fi; }
check_plan() {
  if backpromote_check "$2" "$3" >"$LOGS/$1.check.txt" 2>&1; then
    record "$1" OK "$(tail -1 "$LOGS/$1.check.txt")"
  else
    record "$1" FAIL "$(grep -E 'FAIL|Error' "$LOGS/$1.check.txt" | head -8 | tr '\n' ';')"
  fi
}
static_resources() {
  env -u NODE_OPTIONS sf data query --target-org "${1:-$DEVORG}" --query "SELECT Name FROM StaticResource WHERE Name LIKE 'E2E_S%' ORDER BY Name" --json |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).result.records.map(r=>r.Name).join(',')))"
}
resource_body() {
  env -u NODE_OPTIONS sf data query --target-org "${2:-$DEVORG}" --query "SELECT Body FROM StaticResource WHERE Name = '$1'" --json |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).result.records[0];console.log(r?Buffer.from(r.Body||'','base64').toString():'')})"
}
# The source file of a story static resource
resource_file() { git ls-files "force-app/**/staticresources/$1.resource" "force-app/**/staticresources/$1.resource-*" | grep -v "meta.xml" | head -1; }
# A story merged into integration (a new resource, or a change of an existing one). Prints the number.
merge_story() {
  local branch="$1" resource="$2" title="$3" content="${4:-}"
  git checkout -q -f integration && git pull -q origin integration
  if [ -n "$content" ]; then
    git checkout -q -b "$branch"
    printf '%s\n' "$content" >"$(resource_file "$resource")"
    git commit -q -am "$title" && git push -q -u origin "$branch"
  else
    story_branch "$branch" integration "$resource" >&2 || return 1
  fi
  local number
  number=$(bp_open_and_merge "$branch" "$title") || return 1
  git checkout -q -f "$DEV_BRANCH"
  echo "$number"
}
DEVUSER=$(env -u NODE_OPTIONS sf org display --target-org "$DEVORG" --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).result.username))")

echo; echo "=== B0 from a major branch ==="
git checkout -q integration
e2e_backpromote_json bp-major-branch --plan --parentbranch integration
check_plan B0-plan bp-major-branch "$BPX/refused-major-branch.json"
e2e_backpromote bp-major-branch-run --auto --parentbranch integration
code=$?
grep -q "major branch" "$LOGS/bp-major-branch-run.log" && [ "$code" != "0" ]
ok_if B0-run $? "exit=$code"
git checkout -q "$DEV_BRANCH"

echo; echo "=== B1 org of a major branch ==="
printf 'targetUsername: %s\n' "$DEVUSER" >>config/branches/.sfdx-hardis.uat.yml
e2e_backpromote_json bp-refused-major --plan --parentbranch integration
check_plan B1-plan bp-refused-major "$BPX/refused-major-org.json"
git checkout -- config/branches

echo; echo "=== B1c parent branch not a major branch ==="
e2e_backpromote_json bp-refused-parent --plan --parentbranch feature/E2E-105-apex
check_plan B1c-plan bp-refused-parent "$BPX/refused-parent.json"

echo; echo "=== B2 production org ==="
e2e_backpromote_json bp-refused-prod --plan --parentbranch integration --target-org "$ORG"
check_plan B2-plan bp-refused-prod "$BPX/refused-production.json"

echo; echo "=== B3 plan: S1 to S3 wait in integration ==="
PROGRESS_FILE="$(cygpath -m "$LOGS" 2>/dev/null || echo "$LOGS")/bp-plan-1.progress.jsonl"
rm -f "$PROGRESS_FILE"
SFDX_HARDIS_PROGRESS_FILE="$PROGRESS_FILE" e2e_backpromote_json bp-plan-1 --plan --parentbranch integration
check_plan B3-plan bp-plan-1 "$BPX/plan-1.json"
grep -q '"step":"fetch"' "$PROGRESS_FILE" && grep -q '"step":"delta"' "$PROGRESS_FILE"
ok_if B3-progress $? "$(wc -l <"$PROGRESS_FILE" | tr -d ' ') progress lines"
[ "$(git branch --show-current)" = "$DEV_BRANCH" ] && [ -z "$(git status --porcelain)" ]
ok_if B3-read-only $? "still on $(git branch --show-current), clean tree"

echo; echo "=== B4 run: merge and deploy S1 to S3 ==="
BEFORE=$(git rev-parse HEAD)
e2e_backpromote bp-run-1 --auto --parentbranch integration
ok_if B4-exit $? "exit code"
git log -1 --format=%s | grep -q "backpromote integration"
ok_if B4-merge-commit $? "$(git log -1 --format=%s)"
[ "$(static_resources)" = "E2E_S1,E2E_S2,E2E_S3" ]
ok_if B4-org $? "resources: $(static_resources)"
grep -q "e2e-pre-$S1\|E2E-101 pre" "$LOGS/bp-run-1.log" && grep -q "e2e-post-$S2\|E2E-102 post" "$LOGS/bp-run-1.log"
ok_if B4-actions $? "pre and post actions ran"
git merge-base --is-ancestor origin/integration HEAD && [ "$(git rev-list --count "$BEFORE..HEAD")" -ge 1 ]
ok_if B4-branch $? "integration merged into $DEV_BRANCH"
e2e_backpromote_json bp-plan-2 --plan --parentbranch integration
check_plan B4-plan-after bp-plan-2 "$BPX/plan-up-to-date.json"

echo; echo "=== B5 pending org changes are saved first ==="
S1_FILE=$(resource_file E2E_S1)
cp "$S1_FILE" "$LOGS/E2E_S1.saved"
printf 'changed directly in the org\n' >"$S1_FILE"
(env -u NODE_OPTIONS sf project deploy start --source-dir "$S1_FILE" --target-org "$DEVORG" --ignore-conflicts --wait 30) >"$LOGS/bp-org-change.log" 2>&1
git checkout -- "$S1_FILE"
S4=$(merge_story feature/E2E-104-delta E2E_S4 "E2E-104 delta") || exit 1
export BP_VAR_S4="$S4"
e2e_backpromote_json bp-plan-3 --plan --parentbranch integration
check_plan B5-plan bp-plan-3 "$BPX/plan-org-changes.json"
e2e_backpromote bp-run-2 --auto --parentbranch integration
ok_if B5-exit $? "exit code"
git log -3 --format=%s | grep -q "save the changes of"
ok_if B5-save-commit $? "$(git log -3 --format=%s | tr '\n' ';')"
grep -q "changed directly in the org" "$S1_FILE"
ok_if B5-org-change-kept $? "the org change is in the branch"
[ "$(static_resources)" = "E2E_S1,E2E_S2,E2E_S3,E2E_S4" ]
ok_if B5-org $? "resources: $(static_resources)"

echo; echo "=== B6 conflict: overwrite with the parent branch version ==="
S2_FILE=$(resource_file E2E_S2)
printf 'my version of S2\n' >"$S2_FILE" && git commit -q -am "E2E-401 changes S2"
S5=$(merge_story feature/E2E-105-epsilon E2E_S2 "E2E-105 epsilon" "their version of S2") || exit 1
export BP_VAR_S5="$S5"
e2e_backpromote_json bp-plan-4 --plan --parentbranch integration
check_plan B6-plan bp-plan-4 "$BPX/plan-conflict.json"
e2e_backpromote bp-run-3 --auto --parentbranch integration --on-conflict "$S2_FILE=overwrite"
ok_if B6-exit $? "exit code"
grep -q "their version of S2" "$S2_FILE" && ! grep -q "<<<<<<<" "$S2_FILE"
ok_if B6-overwritten $? "$(head -1 "$S2_FILE")"
[ "$(resource_body E2E_S2)" = "their version of S2" ]
ok_if B6-org $? "org body: $(resource_body E2E_S2)"

echo; echo "=== B7 conflict: merge by hand, the merge waits, then continues ==="
S3_FILE=$(resource_file E2E_S3)
printf 'my version of S3\n' >"$S3_FILE" && git commit -q -am "E2E-401 changes S3"
S6=$(merge_story feature/E2E-106-zeta E2E_S3 "E2E-106 zeta" "their version of S3") || exit 1
e2e_backpromote bp-run-4 --auto --parentbranch integration
ok_if B7-stops $? "exit code (the merge waits, exit 0)"
git rev-parse -q --verify MERGE_HEAD >/dev/null && grep -q "<<<<<<<" "$S3_FILE"
ok_if B7-merge-waiting $? "MERGE_HEAD set, markers in $S3_FILE"
ls "$WORK"/hardis-report/backpromote-merge-prompt*.md >/dev/null 2>&1
ok_if B7-prompt $? "coding agent prompt saved"
e2e_backpromote_json bp-plan-5 --plan --parentbranch integration
check_plan B7-plan-waiting bp-plan-5 "$BPX/plan-merge-waiting.json"
printf 'my version and their version of S3\n' >"$S3_FILE"
e2e_backpromote_json bp-plan-6 --plan --parentbranch integration
check_plan B7-plan-solved bp-plan-6 "$BPX/plan-merge-solved.json"
e2e_backpromote bp-run-5 --auto --parentbranch integration
ok_if B7-continues $? "exit code"
! git rev-parse -q --verify MERGE_HEAD >/dev/null && git log -1 --format=%s | grep -q "backpromote integration"
ok_if B7-merge-committed $? "$(git log -1 --format=%s)"
[ "$(resource_body E2E_S3)" = "my version and their version of S3" ]
ok_if B7-org $? "org body: $(resource_body E2E_S3)"

echo; echo "=== B8 an item left out stays pending, deletions skipped ==="
git checkout -q -f integration && git pull -q origin integration
git checkout -q -b feature/E2E-107-eta
story_branch feature/E2E-107-eta integration E2E_S7 >/dev/null 2>&1 || true
git rm -q "$(resource_file E2E_S4)" "$(resource_file E2E_S4)-meta.xml" 2>/dev/null || git rm -q -r "$(dirname "$(resource_file E2E_S4)")/E2E_S4"* 2>/dev/null
git commit -q -am "E2E-107 eta: add S7, remove S4" && git push -q -u origin feature/E2E-107-eta
S7=$(bp_open_and_merge feature/E2E-107-eta "E2E-107 eta") || exit 1
git checkout -q -f "$DEV_BRANCH"
e2e_backpromote_json bp-plan-7 --plan --parentbranch integration
check_plan B8-plan bp-plan-7 "$BPX/plan-deletion.json"
e2e_backpromote bp-run-6 --auto --parentbranch integration --exclude-metadata StaticResource:E2E_S7 --skip-destructive
ok_if B8-exit $? "exit code"
[ "$(static_resources)" = "E2E_S1,E2E_S2,E2E_S3,E2E_S4" ]
ok_if B8-org $? "S7 not deployed, S4 kept: $(static_resources)"
env -u NODE_OPTIONS sf project deploy preview --target-org "$DEVORG" --json 2>/dev/null | grep -q "E2E_S7"
ok_if B8-pending $? "E2E_S7 stays pending in the source tracking"

echo; echo "=== B9 a second developer, another org, gets everything ==="
git checkout -q -b feature/E2E-402-dev "$ROOT"
e2e_backpromote_json bp-plan-8 --plan --parentbranch integration --target-org "$DEVORG2"
check_plan B9-plan bp-plan-8 "$BPX/plan-second-org.json"
e2e_backpromote bp-run-7 --auto --parentbranch integration --target-org "$DEVORG2"
ok_if B9-exit $? "exit code"
[ "$(static_resources "$DEVORG2")" = "E2E_S1,E2E_S2,E2E_S3,E2E_S7" ]
ok_if B9-org $? "resources: $(static_resources "$DEVORG2")"
git checkout -q "$DEV_BRANCH"

echo; echo "=== summary ==="
grep -c "| OK |" "$RESULTS" | xargs -I{} echo "{} OK"
grep -c "| FAIL |" "$RESULTS" | xargs -I{} echo "{} FAIL"
grep "| FAIL |" "$RESULTS" || true
echo "STEPS DONE"
