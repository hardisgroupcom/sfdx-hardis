#!/usr/bin/env bash
# Runbook section 6bis, steps B0 to B17 and the Pull Request comment consistency checks C1 to C6, on
# any git provider, after backpromote-setup.sh. Prints one line per assertion and a summary, and writes
# $LOGS/results.txt.
#
#   export BP_PROVIDER_LIB=<path to e2e-lib.sh | e2e-lib-gitlab.sh | e2e-lib-azure.sh>
#   export <the provider library variables> WORK LOGS DEV API DEVHUB DEVORG DEVORG2 ORG
#   bash backpromote-steps.sh
set -uo pipefail
: "${BP_PROVIDER_LIB:?set BP_PROVIDER_LIB to the provider library}"
: "${DEVORG:?set DEVORG}" "${DEVORG2:?set DEVORG2}" "${ORG:?set ORG (a production org for B2)}"
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$BP_PROVIDER_LIB"
source "$LOGS/bp-vars.sh"
export BP_VAR_S1="$S1" BP_VAR_S2="$S2" BP_VAR_S3="$S3"
cd "$WORK" || exit 1
git checkout -q feature/E2E-401-dev || exit 1

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
check_comments() {
  local step="$1" expectations="$2"
  shift 2
  if backpromote_comments_check "$step" "$expectations" "$@" >"$LOGS/$step.check.txt" 2>&1; then
    record "$step" OK "$(tail -1 "$LOGS/$step.check.txt")"
  else
    record "$step" FAIL "$(grep -E 'FAIL|Error' "$LOGS/$step.check.txt" | head -8 | tr '\n' ';')"
  fi
}
json_field() {
  node -e "
const fs = require('fs');
const text = fs.readFileSync(process.argv[1], 'utf8');
let doc;
try { doc = JSON.parse(text); } catch {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && !doc; i++) { if (lines[i].trim() === '{') { try { doc = JSON.parse(lines.slice(i).join('\n')); } catch {} } }
}
const value = process.argv[2].split('.').reduce((o, k) => (o == null ? o : o[k]), doc);
console.log(typeof value === 'string' ? value : JSON.stringify(value));
" "$1" "$2"
}
# Merge commit of a Pull Request, read from a plan document listing it
commit_of() {
  node -e "
const fs = require('fs');
const text = fs.readFileSync(process.argv[1], 'utf8');
const doc = JSON.parse(text.substring(text.indexOf('{')));
const group = (doc.result.groups || []).find((g) => g.pullRequests.some((pr) => String(pr.id) === process.argv[2]));
console.log(group ? group.hash : '');
" "$LOGS/$1.json" "$2"
}
static_resources() {
  env -u NODE_OPTIONS sf data query --target-org "${1:-$DEVORG}" --query "SELECT Name FROM StaticResource WHERE Name LIKE 'E2E_S%' ORDER BY Name" --json |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).result.records.map(r=>r.Name).join(',')))"
}
apex_body() {
  env -u NODE_OPTIONS sf data query --use-tooling-api --target-org "$DEVORG" --query "SELECT Body FROM ApexClass WHERE Name = '$1'" --json |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).result.records[0].Body))"
}
# A story merged into integration, then brought into the developer branch. Sets STORY.
merge_story() {
  local branch="$1" title="$2"
  git push -q -u origin "$branch" || return 1
  STORY=$(bp_open_and_merge "$branch" "$title") || return 1
  git checkout -q feature/E2E-401-dev && git fetch -q origin && git merge -q --no-edit origin/integration
  echo "story $STORY merged: $branch"
}
DEVUSER=$(env -u NODE_OPTIONS sf org display --target-org "$DEVORG" --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).result.username))")

echo; echo "=== B0 not connected to the git provider ==="
e2e_backpromote_nogit_json bp-no-git --plan --from "$ROOT"
check_plan B0-plan bp-no-git "$BPX/not-connected.json"
(cd "$WORK" && bp_no_git_env node "$DEV" hardis:work:backpromote --agent --from "$ROOT" --target-org "$DEVORG") >"$LOGS/bp-no-git-run.log" 2>&1
code=$?
grep -qi "git provider" "$LOGS/bp-no-git-run.log" && [ "$code" != "0" ]
ok_if B0-run $? "exit=$code"

echo; echo "=== B1 org of a major branch ==="
printf 'targetUsername: %s\n' "$DEVUSER" >>config/branches/.sfdx-hardis.uat.yml
e2e_backpromote_json bp-refused-major --plan --from "$ROOT"
check_plan B1-plan bp-refused-major "$BPX/refused-major.json"
e2e_backpromote bp-refused-major-run --agent --from "$ROOT"
code=$?
grep -q "org of the uat branch" "$LOGS/bp-refused-major-run.log" && [ "$code" != "0" ]
ok_if B1-run $? "exit=$code"
git checkout -- config/branches

echo; echo "=== B2 production org ==="
e2e_backpromote_json bp-refused-prod --plan --from "$ROOT" --target-org "$ORG"
check_plan B2-plan bp-refused-prod "$BPX/refused-production.json"

echo; echo "=== B3 plan ==="
e2e_backpromote_json bp-plan-1 --plan --from "$ROOT"
check_plan B3-plan bp-plan-1 "$BPX/plan-1.json"
ORGID=$(json_field "$LOGS/bp-plan-1.json" result.targetOrg.orgId)
ORGNAME=$(json_field "$LOGS/bp-plan-1.json" result.targetOrg.orgName)
echo "ORGID=$ORGID ORGNAME=$ORGNAME"

echo; echo "=== B4 pick Pull Requests S1 and S3 ==="
e2e_backpromote bp-run-1-3 --agent --from "$ROOT" --pull-requests "$S1,$S3"
code=$?
ok_if B4-exit "$code" "exit=$code"
grep -q "E2E pre-deploy of PR $S1" "$LOGS/bp-run-1-3.log" && grep -q "E2E pre-deploy of PR $S3" "$LOGS/bp-run-1-3.log" && ! grep -q "of PR $S2" "$LOGS/bp-run-1-3.log"
ok_if B4-actions $? "pre actions of $S1 and $S3 only"
RES=$(static_resources)
[ "$RES" = "E2E_S1,E2E_S3" ]
ok_if B4-org $? "static resources: $RES"
! grep -qs "backpromoteState" config/user/.sfdx-hardis.*.yml
ok_if B4-nothing-local $? "no backpromoteState in config/user"
cat >"$LOGS/c1.json" <<JSON
{ "prs": {
  "$S1": { "orgCount": 1, "orgs": [{ "orgId": "$ORGID", "orgName": "$ORGNAME", "deployed": true, "actions": { "e2e-pre-$S1": "success", "e2e-manual-$S1": "manual" } }] },
  "$S2": { "absent": true },
  "$S3": { "orgCount": 1, "orgs": [{ "orgId": "$ORGID", "orgName": "$ORGNAME", "deployed": true, "actions": { "e2e-pre-$S3": "success" } }] }
} }
JSON
check_comments C1-comments "$LOGS/c1.json" "$S1" "$S2" "$S3"

echo; echo "=== B5 window after the last backpromoted, then --from ==="
e2e_backpromote_json bp-plan-2 --plan
check_plan B5-plan bp-plan-2 "$BPX/plan-2.json"
e2e_backpromote_json bp-plan-2-from --plan --from "$ROOT"
check_plan B5-plan-from bp-plan-2-from "$BPX/plan-2-from.json"

echo; echo "=== B6 the one left out, no actions ==="
e2e_backpromote bp-run-2 --agent --from "$ROOT" --pull-requests "$S2" --skip-actions
code=$?
ok_if B6-exit "$code" "exit=$code"
grep -q "skipped (--skip-actions)" "$LOGS/bp-run-2.log" && ! grep -q "E2E post-deploy of PR $S2" "$LOGS/bp-run-2.log"
ok_if B6-actions $? "actions skipped"
RES=$(static_resources)
[ "$RES" = "E2E_S1,E2E_S2,E2E_S3" ]
ok_if B6-org $? "static resources: $RES"
cat >"$LOGS/c2.json" <<JSON
{ "prs": {
  "$S2": { "orgCount": 1, "orgs": [{ "orgId": "$ORGID", "deployed": true, "actionsAbsent": ["e2e-post-$S2"] }] }
} }
JSON
check_comments C2-comments "$LOGS/c2.json" "$S2"

echo; echo "=== B7 unknown Pull Request ==="
e2e_backpromote bp-unknown --agent --pull-requests 99999
code=$?
grep -q "99999" "$LOGS/bp-unknown.log" && grep -q -- "--from" "$LOGS/bp-unknown.log" && [ "$code" != "0" ]
ok_if B7 $? "exit=$code"

echo; echo "=== B8 changed in the org and in integration ==="
sed -i "s/'promotion branches end to end test'/'changed in the dev org'/" force-app/main/default/classes/PromoE2EAlphaTest.cls
env -u NODE_OPTIONS sf project deploy start --metadata ApexClass:PromoE2EAlphaTest --target-org "$DEVORG" --ignore-conflicts >"$LOGS/bp-org-change-alpha.log" 2>&1
git checkout -- force-app/main/default/classes/PromoE2EAlphaTest.cls
git checkout -q -f integration && git pull -q origin integration && git checkout -q -b feature/E2E-105-apex
sed -i "s/'promotion branches end to end test'/'incoming from integration'/" force-app/main/default/classes/PromoE2EAlphaTest.cls
git commit -qam "feat: E2E-105 apex change"
merge_story feature/E2E-105-apex "E2E-105 apex change"
S7="$STORY"
e2e_backpromote_json bp-plan-3 --plan
check_plan B8-plan bp-plan-3 "$BPX/plan-3.json"

echo; echo "=== B9 prepare the merge ==="
e2e_backpromote_json bp-prepare --pull-requests "$S7" --prepare-merge ApexClass:PromoE2EAlphaTest
check_plan B9-prepare bp-prepare "$BPX/prepare.json"
CLS=force-app/main/default/classes/PromoE2EAlphaTest.cls
grep -q "^<<<<<<< your org" "$CLS" && grep -q "^||||||| last backpromoted" "$CLS" && grep -q "^>>>>>>> integration" "$CLS"
ok_if B9-markers $? "$(grep -c '^<<<<<<<' "$CLS") block(s)"
ls hardis-report/backpromote-merge-prompt-*.md >/dev/null 2>&1
ok_if B9-prompt-file $? "$(ls hardis-report/backpromote-merge-prompt-*.md 2>/dev/null | tail -1)"
NEXT=$(json_field "$LOGS/bp-prepare.json" result.nextCommand)
echo "nextCommand: $NEXT"

echo; echo "=== B10 markers left ==="
eval "e2e_backpromote bp-merged-markers --agent ${NEXT#sf hardis:work:backpromote }"
code=$?
grep -q "Solve the conflict markers left" "$LOGS/bp-merged-markers.log" && [ "$code" != "0" ]
ok_if B10 $? "exit=$code"

echo; echo "=== B11 merge solved and deployed ==="
node -e "const fs=require('fs');const f='$CLS';const s=fs.readFileSync(f,'utf8');fs.writeFileSync(f,s.replace(/<<<<<<< your org\r?\n([\s\S]*?)\r?\n\|\|\|\|\|\|\| [\s\S]*?\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> integration/,(m,org,inc)=>org+'\n'+inc))"
eval "e2e_backpromote bp-merged --agent ${NEXT#sf hardis:work:backpromote }"
code=$?
ok_if B11-exit "$code" "exit=$code"
grep -q "Commit the merged files" "$LOGS/bp-merged.log"
ok_if B11-commit-message $? "commit reminder"
BODY=$(apex_body PromoE2EAlphaTest)
echo "$BODY" | grep -q "changed in the dev org" && echo "$BODY" | grep -q "incoming from integration"
ok_if B11-org $? "org body keeps both lines"
DIRTY=$(git status --porcelain | grep -v "hardis-report/" | tr '\n' ' ')
[ "$DIRTY" = " M $CLS " ]
ok_if B11-tree $? "status: $DIRTY"
git commit -qam "chore: keep the org change of PromoE2EAlphaTest"
cat >"$LOGS/c3.json" <<JSON
{ "prs": { "$S7": { "orgCount": 1, "orgs": [{ "orgId": "$ORGID", "deployed": true }] } } }
JSON
check_comments C3-comments "$LOGS/c3.json" "$S7"

echo; echo "=== B12 keep the org version ==="
BETA=force-app/main/default/classes/PromoE2EBetaTest.cls
sed -i "s/'promotion branches end to end test'/'kept in the dev org'/" "$BETA"
env -u NODE_OPTIONS sf project deploy start --metadata ApexClass:PromoE2EBetaTest --target-org "$DEVORG" --ignore-conflicts >"$LOGS/bp-org-change-beta.log" 2>&1
git checkout -- "$BETA"
git checkout -q -f integration && git pull -q origin integration && git checkout -q -b feature/E2E-106-apex
sed -i "s/'promotion branches end to end test'/'not deployed by the backpromote'/" "$BETA"
git commit -qam "feat: E2E-106 apex change"
merge_story feature/E2E-106-apex "E2E-106 apex change"
S8="$STORY"
e2e_backpromote bp-keep-org --agent --pull-requests "$S8" --exclude-metadata ApexClass:PromoE2EBetaTest
code=$?
ok_if B12-exit "$code" "exit=$code"
grep -q "left out of the deployment" "$LOGS/bp-keep-org.log"
ok_if B12-log $? "exclusion logged"
apex_body PromoE2EBetaTest | grep -q "kept in the dev org"
ok_if B12-org $? "org keeps its own PromoE2EBetaTest"

echo; echo "=== B13 declined deletions ==="
git checkout -q -f integration && git pull -q origin integration && git checkout -q -b feature/E2E-107-delete
git rm -q force-app/main/default/staticresources/E2E_S1.resource force-app/main/default/staticresources/E2E_S1.resource-meta.xml
git commit -qm "feat: E2E-107 remove E2E_S1"
merge_story feature/E2E-107-delete "E2E-107 delete E2E_S1"
S9="$STORY"
e2e_backpromote_json bp-plan-4 --plan
check_plan B13-plan bp-plan-4 "$BPX/plan-4.json"
e2e_backpromote bp-skip-destructive --agent --pull-requests "$S9" --skip-destructive
code=$?
ok_if B13-exit "$code" "exit=$code"
static_resources | grep -q "E2E_S1"
ok_if B13-org $? "E2E_S1 still in the org"
echo '{ "exitStatus": 0, "status": "upToDate" }' >"$LOGS/uptodate.json"
e2e_backpromote_json bp-plan-uptodate --plan
check_plan B13-uptodate bp-plan-uptodate "$LOGS/uptodate.json"
cat >"$LOGS/c4.json" <<JSON
{ "prs": {
  "$S8": { "orgCount": 1, "orgs": [{ "orgId": "$ORGID", "deployed": true }] },
  "$S9": { "orgCount": 1, "orgs": [{ "orgId": "$ORGID", "deployed": true }] }
} }
JSON
check_comments C4-comments "$LOGS/c4.json" "$S8" "$S9"

echo; echo "=== B14 dirty tree ==="
echo "x" >>NOTES.md
e2e_backpromote_json bp-dirty --plan
check_plan B14-plan bp-dirty "$BPX/dirty.json"
git checkout -- NOTES.md

echo; echo "=== B16 a second org (a refreshed sandbox) sees everything pending ==="
DEVORG="$DEVORG2" e2e_backpromote_json bp-new-org --plan --from "$ROOT"
check_plan B16-plan bp-new-org "$BPX/new-org.json"
ORG2ID=$(json_field "$LOGS/bp-new-org.json" result.targetOrg.orgId)
ORG2NAME=$(json_field "$LOGS/bp-new-org.json" result.targetOrg.orgName)

echo; echo "=== B17 backpromote S3 into the second org: one comment, two rows ==="
DEVORG="$DEVORG2" e2e_backpromote bp-new-org-run --agent --from "$ROOT" --pull-requests "$S3"
code=$?
ok_if B17-exit "$code" "exit=$code"
cat >"$LOGS/c5.json" <<JSON
{ "prs": {
  "$S3": { "orgCount": 2, "orgs": [
    { "orgId": "$ORGID", "orgName": "$ORGNAME", "deployed": true, "actions": { "e2e-pre-$S3": "success" } },
    { "orgId": "$ORG2ID", "orgName": "$ORG2NAME", "deployed": true, "actions": { "e2e-pre-$S3": "success" } }
  ] },
  "$S1": { "orgCount": 1 }
} }
JSON
check_comments C5-comments "$LOGS/c5.json" "$S1" "$S3"

echo; echo "=== C6 every history comment of the repository ==="
e2e_backpromote_json bp-plan-final --plan --from "$ROOT"
cat >"$LOGS/c6.json" <<JSON
{ "prs": {
  "$S1": { "orgCount": 1, "orgs": [{ "orgId": "$ORGID", "deployed": true, "commit": "$(commit_of bp-plan-final "$S1")" }] },
  "$S2": { "orgCount": 1, "orgs": [{ "orgId": "$ORGID", "deployed": true, "commit": "$(commit_of bp-plan-final "$S2")" }] },
  "$S3": { "orgCount": 2, "orgs": [{ "orgId": "$ORGID", "commit": "$(commit_of bp-plan-final "$S3")" }, { "orgId": "$ORG2ID", "commit": "$(commit_of bp-plan-final "$S3")" }] },
  "$S7": { "orgCount": 1, "orgs": [{ "orgId": "$ORGID", "deployed": true, "commit": "$(commit_of bp-plan-final "$S7")" }] },
  "$S8": { "orgCount": 1, "orgs": [{ "orgId": "$ORGID", "deployed": true, "commit": "$(commit_of bp-plan-final "$S8")" }] },
  "$S9": { "orgCount": 1, "orgs": [{ "orgId": "$ORGID", "deployed": true, "commit": "$(commit_of bp-plan-final "$S9")" }] }
} }
JSON
check_comments C6-comments "$LOGS/c6.json"

echo; echo "=== SUMMARY ==="
cat "$RESULTS"
echo "OK: $(grep -c '| OK |' "$RESULTS")  FAIL: $(grep -c '| FAIL |' "$RESULTS")"
