#!/usr/bin/env bash
# Deployment action types end to end test: a throwaway private GitHub repository running the
# sfdx-hardis CI workflows built from the branch under test, one Pull Request to integration with one
# action of each impacted type created by action:create --agent, two project actions written by hand,
# then the validation job, the deployment job and a rerun of the deployment job, checked in the logs,
# in the Pull Request comments and in the org.
#
#   bash .claude/skills/e2e/scenarios/deployment-actions/scripts/da-e2e.sh            # the whole run
#   RUN=da-e2e-1 STEPS="assert-deploy report" bash .claude/skills/e2e/scenarios/deployment-actions/scripts/da-e2e.sh
#
# Steps: org repo pr check deploy assert-deploy rerun report
#
# Settings: ORG (scratch org alias, default da-e2e-int, created when missing), DEVHUB (default DevHub),
# SFDX_HARDIS_BRANCH (default: current branch, must be pushed), REPO, RUN.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The CI harness of the promotion-branches scenario, shared by every scenario
PROMO_SCRIPTS="$HERE/../../promotion-branches/scripts"
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/env-lib.sh"
e2e_load_env GH_E2E_OWNER
ROOT="$E2E_ROOT"

DEV_JS="$ROOT/bin/dev.js"
ORG="${ORG:-da-e2e-int}"
DEVHUB="${DEVHUB:-DevHub}"
RUN="${RUN:-da-e2e-$(date +%Y%m%d-%H%M)}"
WORK="${WORK:-$E2E_TMP/$RUN}"
LOGS="${LOGS:-$E2E_TMP/$RUN-logs}"
SFDX_HARDIS_BRANCH="${SFDX_HARDIS_BRANCH:-$(git -C "$ROOT" branch --show-current)}"
STEPS="${STEPS:-org repo pr check deploy assert-deploy rerun report}"
mkdir -p "$LOGS"
# shellcheck source=/dev/null
[ -f "$LOGS/run.env" ] && source "$LOGS/run.env"
export LOGS

result() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$LOGS/results.tsv"
  echo "[$2] $1 - $3"
}
assert_contains() { if grep -qF -- "$3" "$2"; then result "$1" OK "$4"; else result "$1" FAIL "$4 (missing: $3)"; fi; }
assert_absent() { if grep -qF -- "$3" "$2"; then result "$1" FAIL "$4 (found: $3)"; else result "$1" OK "$4"; fi; }
assert_count_ge() {
  local n
  n=$(grep -cF -- "$3" "$2")
  if [ "$n" -ge "$4" ]; then result "$1" OK "$5 ($n)"; else result "$1" FAIL "$5 (found $n, expected at least $4: $3)"; fi
}
save() {
  printf 'export %s=%q\n' "$1" "$2" >>"$LOGS/run.env"
  export "$1=$2"
}
step() { case " $STEPS " in *" $1 "*) return 0 ;; *) return 1 ;; esac }
# sf can print a warning before its JSON: parse from the first brace
json_field() { node -e "const t=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(t.slice(t.indexOf('{')));const v=($1);process.stdout.write(v===undefined||v===null?'':String(v))}catch(e){}"; }
soql() { sf data query -o "$ORG" --json -q "$1" 2>/dev/null; }
latest_uac() { soql "SELECT CreatedDate FROM UserAccessChange ORDER BY CreatedDate DESC LIMIT 1" | json_field "j.result.records[0]?.CreatedDate"; }
policy_status() { soql "SELECT Status FROM UserAccessPolicy WHERE DeveloperName = 'UAP_Spike_Policy'" | json_field "j.result.records[0]?.Status"; }
policy_id() { soql "SELECT Id FROM UserAccessPolicy WHERE DeveloperName = 'UAP_Spike_Policy'" | json_field "j.result.records[0]?.Id"; }
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/ci-provider-github.sh"

echo "Run $RUN - work $WORK - logs $LOGS - branch under test $SFDX_HARDIS_BRANCH - org $ORG"

# --------------------------------------------------------------- org: the integration org, in a known state
prepare_org() {
  local label="$1"
  cat >"$LOGS/prepare-$label.apex" <<'APEX'
delete [SELECT Id FROM Account WHERE Name LIKE 'DA_E2E%'];
delete [SELECT Id FROM PermissionSetAssignment WHERE PermissionSet.Name = 'UAP_Spike_PS' AND Assignee.Username LIKE 'da-e2e-user%'];
for (CronTrigger ct : [SELECT Id FROM CronTrigger WHERE CronJobDetail.Name = 'E2EBatch_Schedule']) {
    System.abortJob(ct.Id);
}
APEX
  sf apex run -o "$ORG" --file "$LOGS/prepare-$label.apex" --json >"$LOGS/prepare-$label.json" 2>&1
  # The policy is active in the org before the deployment, as in a real project
  local id
  id=$(policy_id)
  [ -n "$id" ] && sf api request rest "services/data/v66.0/sobjects/UserAccessPolicy/$id" -X PATCH -b '{"Status":"Active"}' -o "$ORG" >/dev/null 2>&1
  save "UAC_BEFORE_$label" "$(latest_uac)"
  echo "org prepared ($label): policy $(policy_status), last access change ${UAC_BEFORE_DEPLOY:-}"
}

# A scratch org with User Access Policies on, the policy and its permission set in Design, and one
# Chatter Free user matching the policy: what the project deploys must already be there to be reset
bootstrap_org() {
  local boot="$LOGS/bootstrap"
  rm -rf "$boot" && mkdir -p "$boot/force-app/main/default/permissionsets" "$boot/force-app/main/default/useraccesspolicies" "$boot/config"
  printf '{"packageDirectories":[{"path":"force-app","default":true}],"sourceApiVersion":"66.0"}\n' >"$boot/sfdx-project.json"
  printf '{"orgName":"sfdx-hardis deployment actions e2e","edition":"Developer","settings":{"userManagementSettings":{"userAccessPoliciesEnabled":true}}}\n' >"$boot/config/project-scratch-def.json"
  if ! sf org display -o "$ORG" --json 2>/dev/null | grep -q '"connectedStatus": "Connected"\|"status": "Active"'; then
    sf org logout -o "$ORG" --no-prompt >/dev/null 2>&1
    (cd "$boot" && sf org create scratch --target-dev-hub "$DEVHUB" --alias "$ORG" --definition-file config/project-scratch-def.json --duration-days 2 --wait 20 --json >"$LOGS/org-create.json" 2>&1) || return 1
  fi
  WORK="$boot/project" bash "$HERE/da-build-project.sh" >>"$LOGS/build.log" 2>&1 || return 1
  cp "$boot/project/force-app/main/default/permissionsets/"* "$boot/force-app/main/default/permissionsets/"
  cp "$boot/project/force-app/main/default/useraccesspolicies/"* "$boot/force-app/main/default/useraccesspolicies/"
  (cd "$boot" && sf project deploy start -d force-app -o "$ORG" -w 20 --json >"$LOGS/bootstrap-deploy.json" 2>&1) || return 1
  local users profile_id
  users=$(soql "SELECT COUNT() FROM User WHERE Username LIKE 'da-e2e-user%' AND IsActive = true" | json_field "j.result.totalSize")
  if [ "${users:-0}" = "0" ]; then
    profile_id=$(soql "SELECT Id FROM Profile WHERE Name = 'Chatter Free User'" | json_field "j.result.records[0]?.Id")
    local name="da-e2e-user-$(date +%s)"
    sf data create record -o "$ORG" -s User -v "Username='$name@example.invalid' LastName='$name' Email='$name@example.invalid' Alias='dae2e' TimeZoneSidKey='Europe/Paris' LocaleSidKey='en_US' EmailEncodingKey='UTF-8' LanguageLocaleKey='en_US' ProfileId='$profile_id'" --json >"$LOGS/bootstrap-user.json" 2>&1 || return 1
  fi
}

if step org; then
  bootstrap_org || {
    result ORG FAIL "org $ORG not created or prepared, see org-create.json, bootstrap-deploy.json, bootstrap-user.json"
    exit 1
  }
  AUTH_URL=$(sf org auth show-sfdx-auth-url -o "$ORG" --json 2>/dev/null | json_field "j.result.sfdxAuthUrl")
  [[ "$AUTH_URL" == force://* ]] || {
    result ORG FAIL "no sfdxAuthUrl for $ORG"
    exit 1
  }
  printf '%s' "$AUTH_URL" >"$LOGS/auth-url.txt"
  prepare_org DEPLOY
  if [ "$(policy_status)" = "Active" ]; then result ORG OK "org $ORG ready, policy Active before the deployment"; else result ORG FAIL "policy not active before the deployment"; fi
fi

# --------------------------------------------------------------- repo: project, workflows, remote, secrets
if step repo; then
  WORK="$WORK" bash "$HERE/da-build-project.sh" >>"$LOGS/build.log" 2>&1 || {
    result REPO FAIL "project not built"
    exit 1
  }
  node "$PROMO_SCRIPTS/ci-workflows-prepare.cjs" --provider github "$ROOT" "$WORK" "$SFDX_HARDIS_BRANCH" >>"$LOGS/build.log" 2>&1 || {
    result REPO FAIL "workflows not written, see build.log"
    exit 1
  }
  (cd "$WORK" && git add -A && git commit -q -m "CI workflows of the sfdx-hardis branch $SFDX_HARDIS_BRANCH")
  if [ -z "${REPO:-}" ]; then
    owner="${GH_E2E_OWNER:-$(gh api user --jq .login)}"
    highest=$(gh repo list "$owner" --limit 1000 --json name --jq '[.[].name | capture("^sfdx-hardis-da-e2e-(?<n>[0-9]+)$").n | tonumber] | max // 0')
    REPO="$owner/sfdx-hardis-da-e2e-$((${highest:-0} + 1))"
  fi
  save REPO "$REPO"
  (
    cd "$WORK" || exit 1
    gh repo create "$REPO" --private >>"$LOGS/build.log" 2>&1 || exit 1
    gh api -X PUT "repos/$REPO/actions/permissions" -F enabled=false >/dev/null
    git remote add origin "https://github.com/$REPO.git"
    git push -q -u origin main
    for b in integration uat preprod; do git branch "$b" && git push -q origin "$b"; done
    for b in INTEGRATION UAT PREPROD MAIN; do gh secret set "SFDX_AUTH_URL_$b" -R "$REPO" <"$LOGS/auth-url.txt" >/dev/null; done
    gh api -X PUT "repos/$REPO/actions/permissions" -F enabled=true -f allowed_actions=all >/dev/null
  ) || {
    result REPO FAIL "repository $REPO not created"
    exit 1
  }
  result REPO OK "repository $REPO, branches main integration uat preprod, secrets set"
fi

# --------------------------------------------------------------- pr: one action of each type, created by the CLI
create_action() {
  local id="$1"
  shift
  (cd "$WORK" && GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY="$REPO" node "$DEV_JS" hardis:project:action:create --agent --scope pr --pr-id "$PR_NUMBER" "$@" --json >"$LOGS/create-$id.json" 2>&1)
  if grep -q '"status": 0' "$LOGS/create-$id.json"; then result "CREATE-$id" OK "action:create --agent $id"; else result "CREATE-$id" FAIL "action:create --agent $id, see create-$id.json"; fi
}

if step pr; then
  (
    cd "$WORK" || exit 1
    git checkout -q integration && git pull -q origin integration
    git checkout -q -b feature/da-e2e
    sed -i 's#<value>version 1</value>#<value>version 2</value>#' force-app/main/default/labels/CustomLabels.labels-meta.xml
    git commit -q -am "Change the label" && git push -q -u origin feature/da-e2e
  )
  printf 'Deployment action types end to end test\n' >"$LOGS/pr-body.md"
  pr=$(gh pr create -R "$REPO" --base integration --head feature/da-e2e --title "Deployment action types e2e" --body-file "$LOGS/pr-body.md")
  save PR_NUMBER "${pr##*/}"
  create_action pre-command --when pre-deploy --type command --label "DA E2E pre command" --command "echo DA_E2E_PRE_COMMAND_MARKER" --context all
  create_action pre-remove --when pre-deploy --type remove-packagexml-items --label "DA E2E remove skipped class" --packagexml-items "ApexClass:E2ESkipped"
  create_action post-apex --when post-deploy --type apex --label "DA E2E apex account" --apex-script scripts/apex/da-e2e-account.apex
  create_action post-run-batch --when post-deploy --type run-batch --label "DA E2E run batch" --class-name E2EBatch --run-mode wait --wait-timeout 10
  create_action post-schedule --when post-deploy --type schedule-batch --label "DA E2E schedule batch" --class-name E2EBatch --cron-expression "0 0 3 * * ?"
  create_action post-uap --when post-deploy --type user-access-policy --label "DA E2E policy apply to all" --policies UAP_Spike_Policy --apply-to-all
  create_action post-manual --when post-deploy --type manual --label "DA E2E manual step" --instructions "Check the e2e org"
  # Refusals of the generic checks, against the branch under test
  (cd "$WORK" && node "$DEV_JS" hardis:project:action:create --agent --scope pr --pr-id "$PR_NUMBER" --when pre-deploy --type user-access-policy --label x --policies A --json >"$LOGS/refuse-phase.json" 2>&1)
  assert_contains REFUSE-PHASE "$LOGS/refuse-phase.json" "can only run post-deploy" "a user-access-policy action is refused before the deployment"
  (cd "$WORK" && node "$DEV_JS" hardis:project:action:create --agent --scope pr --pr-id "$PR_NUMBER" --when post-deploy --type apex --label x --apex-script scripts/apex/da-e2e-account.apex --batch-size 5 --json >"$LOGS/refuse-flag.json" 2>&1)
  assert_contains REFUSE-FLAG "$LOGS/refuse-flag.json" "only apply to the run-batch type" "a run-batch flag is refused on another type"
  F="$WORK/scripts/actions/.sfdx-hardis.$PR_NUMBER.yml"
  cp "$F" "$LOGS/pr-actions.yml"
  assert_contains YAML-UAP-ONCE "$F" "runOnlyOnceByOrg: false" "the user-access-policy action runs at every deployment"
  assert_contains YAML-RUN-BATCH "$F" "className: E2EBatch" "run-batch parameters collected by its provider"
  assert_contains YAML-REMOVE "$F" "ApexClass:E2ESkipped" "remove-packagexml-items items stored"
  (cd "$WORK" && git add -A && git commit -q -m "Deployment actions" && git push -q)
fi

# --------------------------------------------------------------- check: the validation job
if step check; then
  # The commit pushed last: GitHub can still answer the previous head right after a push, whose run
  # the push cancels
  head_sha=$(git -C "$WORK" rev-parse HEAD)
  ci_wait_check "$PR_NUMBER" "$head_sha" check
  if [ "$(cat "$LOGS/check.code")" = "0" ]; then result CHECK OK "validation job succeeded"; else
    result CHECK FAIL "validation job failed, see check.log"
    CHECK_FAILED=1
  fi
  L="$LOGS/check.log"
  assert_contains CHECK-PRE-COMMAND "$L" "DA_E2E_PRE_COMMAND_MARKER" "pre command (context all) runs in the validation"
  assert_contains CHECK-REMOVE "$L" "Removed 1 item(s) from" "remove-packagexml-items runs in the validation"
  assert_absent CHECK-NO-UAP "$L" "Activating user access policy" "no policy activated by a validation"
  assert_absent CHECK-NO-APPLY "$L" "applied to all users" "no Apply To All in a validation"
  assert_absent CHECK-NO-PROJECT-ONCE "$L" "DA_E2E_PROJECT_ONCE_MARKER" "no deployment-only command in a validation"
  ci_pr_comments "$PR_NUMBER" check-comments
  C="$LOGS/check-comments.log"
  for label in "DA E2E pre command" "DA E2E remove skipped class" "DA E2E apex account" "DA E2E run batch" "DA E2E schedule batch" "DA E2E policy apply to all" "DA E2E manual step"; do
    assert_contains "CHECK-COMMENT-${label// /-}" "$C" "$label" "action listed in the Pull Request comments"
  done
fi

# --------------------------------------------------------------- deploy: merge, deployment job
if step deploy && [ -n "${CHECK_FAILED:-}" ]; then
  result DEPLOY SKIP "validation failed: the Pull Request is not merged"
elif step deploy; then
  gh pr merge "$PR_NUMBER" -R "$REPO" --merge >>"$LOGS/build.log" 2>&1
  sleep 10
  merge_sha=$(gh pr view "$PR_NUMBER" -R "$REPO" --json mergeCommit --jq .mergeCommit.oid)
  save MERGE_SHA "$merge_sha"
  ci_wait_deploy integration "$merge_sha" deploy
  if [ "$(cat "$LOGS/deploy.code")" = "0" ]; then result DEPLOY OK "deployment job succeeded"; else result DEPLOY FAIL "deployment job failed, see deploy.log"; fi
fi

# --------------------------------------------------------------- assert-deploy: logs, comments, org
if step assert-deploy; then
  L="$LOGS/deploy.log"
  # context all + runOnlyOnceByOrg: the validation job ran it, so it counts as done in integration
  assert_contains DEP-PRE-COMMAND "$L" "Skipping DA E2E pre command (from PR #$PR_NUMBER): already run in integration" "pre command run by the validation is not run again"
  assert_contains DEP-REMOVE "$L" "Removed 1 item(s) from" "E2ESkipped removed from the deployment package"
  assert_contains DEP-PROJECT-ONCE "$L" "DA_E2E_PROJECT_ONCE_MARKER" "project command ran"
  assert_contains DEP-UAP-ACTIVATED "$L" "User access policy UAP_Spike_Policy is active" "the deployment reset the policy and the action activated it"
  assert_contains DEP-UAP-APPLIED "$L" "User access policy UAP_Spike_Policy was applied to all users" "Apply To All ran in the CI container"
  assert_contains DEP-SCHEDULE "$L" "Successfully scheduled job 'E2EBatch_Schedule'" "schedule-batch scheduled the class"
  # The org
  status=$(policy_status)
  if [ "$status" = "Active" ]; then result ORG-POLICY OK "policy Active after the deployment"; else result ORG-POLICY FAIL "policy is $status after the deployment"; fi
  uac=$(latest_uac)
  if [ -n "$uac" ] && [ "$uac" != "${UAC_BEFORE_DEPLOY:-}" ]; then result ORG-UAC OK "new UserAccessChange ($uac)"; else result ORG-UAC FAIL "no new UserAccessChange (before ${UAC_BEFORE_DEPLOY:-none}, now ${uac:-none})"; fi
  n=$(soql "SELECT COUNT() FROM PermissionSetAssignment WHERE PermissionSet.Name = 'UAP_Spike_PS' AND Assignee.Username LIKE 'da-e2e-user%'" | json_field "j.result.totalSize")
  if [ "${n:-0}" -ge 1 ]; then result ORG-PSA OK "Apply To All gave the permission set back ($n users)"; else result ORG-PSA FAIL "no permission set assignment restored"; fi
  desc=$(soql "SELECT Description FROM Account WHERE Name = 'DA_E2E_APEX' LIMIT 1" | json_field "j.result.records[0]?.Description")
  if [ "$desc" = "batched-by-da-e2e" ]; then result ORG-APEX-BATCH OK "apex created the account, run-batch updated it"; else result ORG-APEX-BATCH FAIL "account description: '${desc:-<no account>}'"; fi
  n=$(soql "SELECT COUNT() FROM CronTrigger WHERE CronJobDetail.Name = 'E2EBatch_Schedule'" | json_field "j.result.totalSize")
  if [ "${n:-0}" = "1" ]; then result ORG-CRON OK "E2EBatch_Schedule scheduled"; else result ORG-CRON FAIL "scheduled jobs: ${n:-0}"; fi
  n=$(soql "SELECT COUNT() FROM ApexClass WHERE Name = 'E2ESkipped'" | json_field "j.result.totalSize")
  if [ "${n:-0}" = "0" ]; then result ORG-SKIPPED OK "E2ESkipped not deployed"; else result ORG-SKIPPED FAIL "E2ESkipped is in the org"; fi
  ci_pr_comments "$PR_NUMBER" deploy-comments
  C="$LOGS/deploy-comments.log"
  assert_contains DEP-COMMENT-MANUAL "$C" "DA E2E manual step" "manual step in the comments"
  assert_absent DEP-COMMENT-FAILED "$C" "❌" "no failed action in the comments"
fi

# --------------------------------------------------------------- rerun: once per org versus every deployment
if step rerun; then
  prepare_org RERUN
  ci_rerun deploy-rerun deploy
  if [ "$(cat "$LOGS/deploy-rerun.code")" = "0" ]; then result RERUN OK "deployment job rerun succeeded"; else result RERUN FAIL "deployment job rerun failed, see deploy-rerun.log"; fi
  L="$LOGS/deploy-rerun.log"
  assert_contains RERUN-PRE-ONCE "$L" "DA E2E pre command (from PR #$PR_NUMBER): already run" "pre command skipped: already run in the org"
  assert_contains RERUN-APEX-ONCE "$L" "DA E2E apex account (from PR #$PR_NUMBER): already run" "apex action skipped: already run"
  assert_contains RERUN-BATCH-ONCE "$L" "DA E2E run batch (from PR #$PR_NUMBER): already run" "run-batch skipped: already run"
  assert_absent RERUN-PROJECT-UAP-RAN "$L" "DA E2E project policy every time: already run" "project policy action without runOnlyOnceByOrg runs again"
  assert_absent RERUN-PR-UAP-RAN "$L" "DA E2E policy apply to all (from PR #$PR_NUMBER): already run" "PR policy action runs again"
  assert_contains RERUN-UAP-APPLIED "$L" "User access policy UAP_Spike_Policy was applied to all users" "Apply To All ran again"
  n=$(soql "SELECT COUNT() FROM PermissionSetAssignment WHERE PermissionSet.Name = 'UAP_Spike_PS' AND Assignee.Username LIKE 'da-e2e-user%'" | json_field "j.result.totalSize")
  if [ "${n:-0}" -ge 1 ]; then result RERUN-ORG-PSA OK "permission set given back again ($n users)"; else result RERUN-ORG-PSA FAIL "no permission set assignment after the rerun"; fi
  status=$(policy_status)
  if [ "$status" = "Active" ]; then result RERUN-ORG-POLICY OK "policy Active after the rerun"; else result RERUN-ORG-POLICY FAIL "policy is $status after the rerun"; fi
  # Accounts were deleted before the rerun and the apex action did not run again
  n=$(soql "SELECT COUNT() FROM Account WHERE Name = 'DA_E2E_APEX'" | json_field "j.result.totalSize")
  if [ "${n:-0}" = "0" ]; then result RERUN-ORG-APEX OK "apex action not run twice"; else result RERUN-ORG-APEX FAIL "apex action ran again ($n accounts)"; fi
fi

# --------------------------------------------------------------- report
if step report; then
  ok=$(grep -c $'\tOK\t' "$LOGS/results.tsv")
  fail=$(grep -c $'\tFAIL\t' "$LOGS/results.tsv")
  {
    echo "# Deployment action types e2e - $RUN"
    echo
    echo "- sfdx-hardis branch: $SFDX_HARDIS_BRANCH ($(git -C "$ROOT" rev-parse --short HEAD))"
    echo "- repository: https://github.com/${REPO:-?} (Pull Request #${PR_NUMBER:-?})"
    echo "- org: $ORG"
    echo "- result: $ok OK, $fail FAIL"
    echo
    echo "| Check | Result | Detail |"
    echo "|-------|--------|--------|"
    awk -F'\t' '{gsub(/\|/,"\\|",$3); printf "| %s | %s | %s |\n", $1, $2, $3}' "$LOGS/results.tsv"
  } >"$LOGS/report.md"
  echo "Report: $LOGS/report.md ($ok OK, $fail FAIL)"
fi
