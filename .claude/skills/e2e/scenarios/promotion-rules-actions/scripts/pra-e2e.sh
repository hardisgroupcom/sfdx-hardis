#!/usr/bin/env bash
# Promotion branches + replacement rules + deployment actions, end to end, in REAL CI jobs (GitHub
# Actions or GitLab CI) running sfdx-hardis built from the branch under test.
#
# Three stories go into integration, two of them are promoted integration -> uat -> preprod -> main
# with promotion branches. After every deployment job the org is read: each replacement rule must
# have deployed the value of the branch the job deployed to, the deployment actions of the stories
# must have travelled with the promotions and run in each org branch, and no secret value may leave
# the CI variables.
#
#   PROVIDER=github bash pra-e2e.sh                     # the whole run
#   PROVIDER=gitlab bash pra-e2e.sh
#   PROVIDER=github RUN=<run> STEPS="main report" bash pra-e2e.sh   # replay steps of a run
#
# Steps, in order: org repo s1 s2 s3 uat preprod main extension report
#
# Settings (environment, then the .env of the sfdx-hardis working copy):
#   PROVIDER            github (default) or gitlab
#   DEVHUB              Dev Hub that creates the scratch org (default DevHub)
#   PRA_ORG             scratch org alias (default pra-e2e-<provider>), created when missing
#   SFDX_HARDIS_BRANCH  branch of hardisgroupcom/sfdx-hardis the jobs build (default: current, pushed)
#   PRA_TEST_LEVEL      NoTestRun (default: every deployment job is a full deployment) or RunLocalTests
#                       (S1 adds a test class, every deployment job must quick deploy its validation)
#   RUN                 run name (default pra-e2e-<provider>-<date>): WORK and LOGS under the OS temp dir
#   GitHub: GH_E2E_OWNER. GitLab: GITLAB_E2E_HOST, GITLAB_E2E_GROUP (see ci-provider-gitlab.sh)
#
# Results: $LOGS/results.txt (id | OK|FAIL|SKIP | detail), report in $LOGS/report.md
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMO_SCRIPTS="$(cd "$HERE/../../promotion-branches/scripts" && pwd)"
export PROVIDER="${PROVIDER:-github}"
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/env-lib.sh"
e2e_defaults
e2e_load_env DEVHUB PRA_ORG GH_E2E_OWNER GITLAB_E2E_HOST GITLAB_E2E_GROUP
ROOT="$E2E_ROOT"
DEVHUB="${DEVHUB:-DevHub}"
RUN="${RUN:-pra-e2e-$PROVIDER-$(date +%Y%m%d-%H%M)}"
export WORK="${PRA_WORK:-$E2E_TMP/$RUN}"
export LOGS="${PRA_LOGS:-$E2E_TMP/$RUN-logs}"
SFDX_HARDIS_BRANCH="${SFDX_HARDIS_BRANCH:-$(git -C "$ROOT" branch --show-current)}"
PRA_TEST_LEVEL="${PRA_TEST_LEVEL:-NoTestRun}"
export PRA_TEST_LEVEL
STEPS="${STEPS:-org repo s1 s2 s3 uat preprod main extension report}"
mkdir -p "$LOGS/bodies"
export RESULTS="$LOGS/results.txt"
touch "$RESULTS" "$LOGS/pra-vars.sh"
[ -f "$LOGS/ci-jobs.tsv" ] || printf 'label\tprovider\tmode\trun\tresult\tqueued_s\tran_s\tbuild_minutes\n' >"$LOGS/ci-jobs.tsv"
# shellcheck source=/dev/null
source "$LOGS/pra-vars.sh"
# shellcheck source=/dev/null
[ -f "$LOGS/ci-vars.sh" ] && source "$LOGS/ci-vars.sh"
# The org every major branch deploys to: a scratch org of its own per provider, so two runs can go in parallel
export ORG="${PRA_ORG:-pra-e2e-$PROVIDER}"
# A name of our own, unless a replay already knows it
case "$PROVIDER" in
github) [ -n "${REPO:-}" ] || REPO="${GH_E2E_OWNER:-$(gh api user --jq .login)}/sfdx-hardis-pra-e2e-$(date +%m%d%H%M)" && export REPO ;;
gitlab)
  # A replay reads PROJECT_PATH from ci-vars.sh: keep its name, or the report names a project that does not exist
  [ -n "${GITLAB_E2E_PROJECT:-}" ] || [ -z "${PROJECT_PATH:-}" ] || GITLAB_E2E_PROJECT="${PROJECT_PATH##*/}"
  [ -n "${GITLAB_E2E_PROJECT:-}" ] || GITLAB_E2E_PROJECT="sfdx-hardis-pra-e2e-gl-$(date +%m%d%H%M)"
  export GITLAB_E2E_PROJECT
  ;;
*)
  echo "PROVIDER=$PROVIDER: this scenario runs on github and gitlab"
  exit 2
  ;;
esac

# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/ci-provider-$PROVIDER.sh"
ci_provider_init || exit 1
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/section-lib.sh"
ci_tick_in_file() { :; } # no checkbox in this scenario

save() {
  printf 'export %s=%q\n' "$1" "$2" >>"$LOGS/pra-vars.sh"
  export "$1=$2"
}
step() { case " $STEPS " in *" $1 "*) return 0 ;; *) return 1 ;; esac }
say() { echo "[$(date +%T)] $*"; }
native() { cygpath -m "$1" 2>/dev/null || echo "$1"; }
provider_lib() {
  # The job helpers (p_open, p_merge, p_promote, p_cli...) need the repository to exist
  # shellcheck source=/dev/null
  source "$PROMO_SCRIPTS/promotion-provider.sh"
}
# sf can print a warning before its JSON: parse from the first brace
json_of() { node -e "const t=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(t.slice(t.indexOf('{')));const v=($1);process.stdout.write(v===undefined||v===null?'':String(v))}catch(e){}"; }
soql() {
  local out tooling="${2:-}"
  for _ in 1 2 3; do
    # shellcheck disable=SC2086 # optional flag
    out=$(env -u NODE_OPTIONS sf data query $tooling -o "$ORG" --json -q "$1" 2>/dev/null)
    if printf '%s' "$out" | grep -q '"status": 0'; then
      printf '%s' "$out"
      return 0
    fi
    sleep 5
  done
  printf '%s' "$out"
}
# The id of the action of a given label, in the actions file of a Pull Request
action_id() {
  node -e "
    const yaml = require(process.argv[1] + '/node_modules/js-yaml');
    const doc = yaml.load(require('fs').readFileSync(process.argv[2], 'utf8')) || {};
    const all = [...(doc.commandsPreDeploy || []), ...(doc.commandsPostDeploy || [])];
    const a = all.find((x) => x.label === process.argv[3]);
    process.stdout.write(a ? String(a.id) : '<none>');
  " "$ROOT" "$(native "$1")" "$2"
}
# Every secret value must stay out of the job logs and the Pull Request comments
assert_no_secret() {
  local id="$1" label="$2" b found=""
  for b in INTEGRATION UAT PREPROD MAIN; do
    local v="SECRET_$b"
    grep -qF -- "${!v}" "$LOGS/$label.log" 2>/dev/null && found+=" PRA_SECRET_$b"
  done
  if [ -n "$found" ]; then record "$id" FAIL "$label: secret value printed:$found"; else record "$id" OK "$label: no secret value in it"; fi
}
# A job that failed because its runner ran out of disk (shared GitLab runners at night) proves
# nothing about sfdx-hardis: run it again, up to twice, and say so in the results
retry_infra_failure() {
  local label="$1" attempt
  for attempt in 1 2; do
    [ "$(cat "$LOGS/$label.code" 2>/dev/null)" = "1" ] || return 0
    grep -qE "ENOSPC|no space left on device" "$LOGS/$label.log" 2>/dev/null || return 0
    record "$label-INFRA-$attempt" SKIP "$label failed with no space left on the runner: job run again"
    cp "$LOGS/$label.log" "$LOGS/$label.infra-$attempt.log"
    ci_rerun "$label-again" "$label"
    for ext in log code mode job run; do
      [ -f "$LOGS/$label-again.$ext" ] && cp "$LOGS/$label-again.$ext" "$LOGS/$label.$ext"
    done
  done
}
# Wait for the validation job of a Pull Request, its comments, then merge it and wait for the deployment
validate() {
  local number="$1" sha="$2" label="$3"
  ci_wait_check "$number" "$sha" "$label"
  retry_infra_failure "$label"
  ci_pr_comments "$number" "$label-comments"
  assert_no_secret "$label-NOSECRET" "$label"
  assert_no_secret "$label-comments-NOSECRET" "$label-comments"
}
merge_deploy() {
  local number="$1" branch="$2" label="$3"
  p_merge "$number" >/dev/null || record "merge-$number" FAIL "merge of #$number"
  ci_wait_deploy "$branch" "$(ci_merge_sha "$number")" "$label"
  retry_infra_failure "$label"
  if [ "$PRA_TEST_LEVEL" != NoTestRun ]; then
    assert_log "$label-QUICK" "$label" - "the deployment job quick deploys the validation of its target" "Successfully processed QuickDeploy for deploymentId" "!Unable to perform QuickDeploy"
  fi
  assert_no_secret "$label-NOSECRET" "$label"
  ci_pr_comments "$number" "$label-comments"
  assert_no_secret "$label-comments-NOSECRET" "$label-comments"
}
# The org after a deployment job: every rule value of the branch it deployed to
# Usage: check_org <id prefix> <branch> <endpoint> <uat only> <not main> <issue> <story or -> <apex host>
check_org() {
  local p="$1" branch="$2" endpoint="$3" uatonly="$4" notmain="$5" issue="$6" story="$7" host="$8" labels pair name want got secret_var
  labels=$(soql "SELECT Name, Value FROM ExternalString WHERE Name LIKE 'PRA_%'" --use-tooling-api)
  printf '%s' "$labels" >"$LOGS/$p-labels.json"
  secret_var="SECRET_${branch^^}"
  for pair in "PRA_Endpoint=$endpoint" "PRA_Secret=${!secret_var}" "PRA_Uat_Only=$uatonly" "PRA_Not_Main=$notmain" "PRA_Issue=$issue" ${story:+"PRA_Story=$story"}; do
    name="${pair%%=*}"
    want="${pair#*=}"
    [ "$want" = "-" ] && continue
    got=$(printf '%s' "$labels" | json_of "j.status!==0?'<query failed>':((j.result.records||[]).find(r=>r.Name==='$name')||{Value:'<missing>'}).Value")
    if [ "$got" = "$want" ]; then
      if [ "$name" = PRA_Secret ]; then
        record "$p-$name" OK "label $name holds PRA_SECRET_${branch^^}"
      else
        record "$p-$name" OK "label $name = $want"
      fi
    else
      [ "$name" = PRA_Secret ] && got="<another value, not PRA_SECRET_${branch^^}: $(printf '%s' "$got" | head -c 12)...>"
      record "$p-$name" FAIL "label $name: expected $([ "$name" = PRA_Secret ] && echo "PRA_SECRET_${branch^^}" || echo "$want"), got '$got'"
    fi
  done
  got=$(soql "SELECT Body FROM ApexClass WHERE Name = 'PRAEndpoints'" --use-tooling-api | json_of "j.status!==0?'<query failed>':(j.result.records[0]||{Body:'<missing>'}).Body")
  if printf '%s' "$got" | grep -qF "'$host/api'"; then record "$p-APEX" OK "PRAEndpoints.HOST = $host/api"; else record "$p-APEX" FAIL "PRAEndpoints.HOST: expected $host/api, got: $(printf '%s' "$got" | grep -o "HOST = '[^']*'" | head -1)"; fi
}
# The apex action of S1 wrote the label value it read in the org
check_apex_action() {
  local id="$1" endpoint="$2" n
  n=$(soql "SELECT COUNT() FROM Account WHERE Name = 'PRA_E2E_APEX' AND Site = '$endpoint'" | json_of "j.status===0?j.result.totalSize:undefined")
  if [ -z "$n" ]; then
    record "$id" FAIL "apex action account: query failed"
  elif [ "$n" -ge 1 ]; then
    record "$id" OK "the apex action of S1 read $endpoint in the org right after the deployment ($n)"
  else
    record "$id" FAIL "no account written with $endpoint: the apex action did not run, or read another label value"
  fi
}
create_action() {
  local pr="$1" key="$2"
  shift 2
  (cd "$WORK" && p_cli hardis:project:action:create --agent --scope pr --pr-id "$pr" "$@" --json >"$LOGS/create-$key.json" 2>&1)
  if grep -q '"status": 0' "$LOGS/create-$key.json"; then record "CREATE-$key" OK "action:create --agent $key on #$pr"; else record "CREATE-$key" FAIL "action:create --agent $key on #$pr, see create-$key.json"; fi
}
# The commands print a word built at run time, so the command text in a log never matches it
SEES_CMD='if grep -q https://git.pra.example.com force-app/main/default/labels/CustomLabels.labels-meta.xml; then echo PRA_WHEN_SEES_GIT""_VALUE; else echo PRA_WHEN_SEES_REPLACED""_VALUE; fi'
STORY_BRANCH_S1=feature/E2E-701-pra-endpoints
STORY_BRANCH_S2=feature/E2E-702-pra-story-rule
STORY_BRANCH_S3=feature/E2E-703-pra-issue-default

say "run $RUN - provider $PROVIDER - work $WORK - logs $LOGS - branch under test $SFDX_HARDIS_BRANCH - org $ORG"

# ------------------------------------------------------------------ org: one scratch org for the four branches
if step org; then
  if ! env -u NODE_OPTIONS sf org display -o "$ORG" --json 2>/dev/null | grep -qE '"connectedStatus": "Connected"|"status": "Active"'; then
    env -u NODE_OPTIONS sf org logout -o "$ORG" --no-prompt >/dev/null 2>&1
    env -u NODE_OPTIONS sf org create scratch --target-dev-hub "$DEVHUB" --alias "$ORG" --edition developer --duration-days 2 --wait 30 --json >"$LOGS/org-create.json" 2>&1 || {
      record ORG FAIL "scratch org not created, see org-create.json"
      exit 1
    }
  fi
  AUTH_URL=$(env -u NODE_OPTIONS sf org auth show-sfdx-auth-url -o "$ORG" --json 2>/dev/null | json_of "j.result.sfdxAuthUrl")
  [[ "$AUTH_URL" == force://* ]] || {
    record ORG FAIL "no sfdxAuthUrl for $ORG"
    exit 1
  }
  printf '%s' "$AUTH_URL" >"$LOGS/auth-url.txt"
  # A reused org must not hold what the apex action of a previous run wrote
  printf "delete [SELECT Id FROM Account WHERE Name = 'PRA_E2E_APEX'];
" >"$LOGS/org-reset.apex"
  env -u NODE_OPTIONS sf apex run -o "$ORG" --file "$(native "$LOGS/org-reset.apex")" --json >"$LOGS/org-reset.json" 2>&1
  grep -q '"status": 0' "$LOGS/org-reset.json" || {
    record ORG FAIL "org not reset, see org-reset.json"
    exit 1
  }
  env -u NODE_OPTIONS sf org display -o "$ORG" --json >"$LOGS/org-display.json" 2>/dev/null
  save ORG_USERNAME "$(json_of "j.result.username" <"$LOGS/org-display.json")"
  save ORG_INSTANCE "$(json_of "j.result.instanceUrl" <"$LOGS/org-display.json")"
  # One value per branch, never printed: the run asserts the org holds the one of its branch
  stamp=$(date +%s)
  for b in INTEGRATION UAT PREPROD MAIN; do save "SECRET_$b" "praSec${b,,}${stamp}Zq9"; done
  record ORG OK "scratch org $ORG ready ($ORG_USERNAME)"
fi

# ------------------------------------------------------------------ repo: project, CI files, remote, secrets, issue
if step repo; then
  WORK="$WORK" API=67.0 bash "$HERE/pra-build-project.sh" >"$LOGS/build.log" 2>&1 || {
    record REPO FAIL "project not built, see build.log"
    exit 1
  }
  cd "$WORK" || exit 1
  for f in config/branches/.sfdx-hardis.*.yml; do
    printf 'targetUsername: %s\ninstanceUrl: %s\n' "$ORG_USERNAME" "$ORG_INSTANCE" >>"$f"
  done
  node "$PROMO_SCRIPTS/ci-workflows-prepare.cjs" --provider "$PROVIDER" "$ROOT" "$(native "$WORK")" "$SFDX_HARDIS_BRANCH" >>"$LOGS/build.log" 2>&1 || {
    record REPO FAIL "CI files not written, see build.log"
    exit 1
  }
  if [ "$PROVIDER" = github ]; then
    # GitHub secrets reach a step only through its env: map them like a project maps its own
    node -e "
      const fs=require('fs');
      for (const f of ['.github/workflows/check-deploy.yml','.github/workflows/process-deploy.yml']) {
        let s=fs.readFileSync(f,'utf8');
        s=s.replace(/^(\s*)SFDX_AUTH_URL_INTEGRATION:.*$/m, (m,i)=>m+['INTEGRATION','UAT','PREPROD','MAIN'].map(b=>'\n'+i+'PRA_SECRET_'+b+': \${{ secrets.PRA_SECRET_'+b+' }}').join(''));
        if(!s.includes('PRA_SECRET_MAIN')) { console.error('no SFDX_AUTH_URL_INTEGRATION line in '+f); process.exit(1); }
        fs.writeFileSync(f,s);
      }" || {
      record REPO FAIL "secrets not mapped in the workflows"
      exit 1
    }
  fi
  git add -A && git commit -qm "chore: CI files of the sfdx-hardis branch $SFDX_HARDIS_BRANCH"
  : >"$LOGS/ci-vars.sh"
  ci_create_remote "$(cat "$LOGS/auth-url.txt")" || {
    record REPO FAIL "remote not created, see build.log"
    exit 1
  }
  # shellcheck source=/dev/null
  source "$LOGS/ci-vars.sh"
  for b in INTEGRATION UAT PREPROD MAIN; do
    v="SECRET_$b"
    if [ "$PROVIDER" = github ]; then
      printf '%s' "${!v}" | gh secret set "PRA_SECRET_$b" -R "$REPO" >/dev/null || record "REPO-SECRET-$b" FAIL "secret PRA_SECRET_$b not set"
    else
      _glci_set_variable "PRA_SECRET_$b" "${!v}" >/dev/null || record "REPO-SECRET-$b" FAIL "variable PRA_SECRET_$b not set"
    fi
  done
  provider_lib
  # The preprod value of pra-issue lives in the git provider issue, no commit
  (cd "$WORK" && git checkout -q -f integration && p_cli hardis:project:replacement:update --agent --layer issue --id pra-issue --value-for preprod=from-issue --json >"$LOGS/issue-update.json" 2>&1)
  if grep -q '"status": 0' "$LOGS/issue-update.json"; then record REPO-ISSUE OK "replacement rules issue holds pra-issue preprod=from-issue"; else record REPO-ISSUE FAIL "replacement:update --layer issue failed, see issue-update.json"; fi
  record REPO OK "repository ${REPO:-$PROJECT_PATH} with main integration uat preprod, 4 logins, 4 PRA_SECRET_<BRANCH>"
fi
# GitLab: the library needs the project id, known once the repo step ran
if [ "$PROVIDER" = github ] || [ -n "${PROJECT_ID:-}" ]; then provider_lib; fi

# ------------------------------------------------------------------ s1: every rule-bound item changes, with its actions
# S1 touches every label and the Apex class, so every promotion carrying it deploys them (delta deployments)
if step s1; then
  say "S1: endpoints"
  cd "$WORK" || exit 1
  git checkout -q -f integration && git pull -q origin integration
  git checkout -q -B "$STORY_BRANCH_S1"
  sed -i -E 's#<shortDescription>(PRA_[A-Za-z_]+)</shortDescription>#<shortDescription>\1 v1</shortDescription>#' force-app/main/default/labels/CustomLabels.labels-meta.xml
  sed -i 's#^public with sharing class PRAEndpoints {#// S1: the host the rules replace\npublic with sharing class PRAEndpoints {#' force-app/main/default/classes/PRAEndpoints.cls
  if [ "$PRA_TEST_LEVEL" != NoTestRun ]; then
    # A validation that ran tests can be quick deployed
    printf '@isTest
private class PRAEndpointsTest {
    @isTest
    static void hostIsSet() {
        System.assert(PRAEndpoints.HOST.startsWith(%shttps://%s));
    }
}
' "'" "'" >force-app/main/default/classes/PRAEndpointsTest.cls
    cp force-app/main/default/classes/PRAEndpoints.cls-meta.xml force-app/main/default/classes/PRAEndpointsTest.cls-meta.xml
  fi
  if [ "$(grep -c ' v1</shortDescription>' force-app/main/default/labels/CustomLabels.labels-meta.xml)" != 5 ] || ! grep -q '^// S1' force-app/main/default/classes/PRAEndpoints.cls; then
    record S1-EDIT FAIL "the S1 edits did not apply"
    exit 1
  fi
  git add force-app && git commit -qm "feat: PRA endpoints" && git push -q -u origin "$STORY_BRANCH_S1"
  printf 'S1: every label bound to a replacement rule, the Apex host, and actions that read what the deployment changed.\n' >"$LOGS/bodies/s1.md"
  S1=$(p_open "$STORY_BRANCH_S1" integration "E2E-701 PRA endpoints" "$LOGS/bodies/s1.md") || exit 1
  save S1 "$S1"
  create_action "$S1" s1-pre --when pre-deploy --type command --label "PRA pre command" --command "${SEES_CMD//WHEN/PRE}" --context all
  create_action "$S1" s1-post --when post-deploy --type command --label "PRA post command" --command "${SEES_CMD//WHEN/POST}" --context process-deployment-only
  create_action "$S1" s1-apex --when post-deploy --type apex --label "PRA apex account" --apex-script scripts/apex/pra-account.apex --context process-deployment-only
  create_action "$S1" s1-manual --when post-deploy --type manual --label "PRA manual check" --instructions "Read the PRA_Endpoint label of the org"
  F="scripts/actions/.sfdx-hardis.$S1.yml"
  cp "$F" "$LOGS/s1-actions.yml"
  save S1_PRE "$(action_id "$F" "PRA pre command")"
  save S1_POST "$(action_id "$F" "PRA post command")"
  save S1_APEX "$(action_id "$F" "PRA apex account")"
  save S1_MANUAL "$(action_id "$F" "PRA manual check")"
  git add scripts/actions && git commit -qm "chore: actions of #$S1" && git push -q
  say "S1=#$S1"
  validate "$S1" "$(git rev-parse HEAD)" s1-check
  assert_log S1-CHECK s1-check 0 "the validation applies the integration value of every rule but pra-uat-only, the pre command sees the git files" \
    "Applying replacement rules for integration" ": pra-endpoint" ": pra-secret" ": pra-not-main" ": pra-issue" ": pra-apex-host" "!: pra-uat-only" \
    "PRA_PRE_SEES_GIT_VALUE" "!PRA_PRE_SEES_REPLACED_VALUE" "!secret not found"
  assert_log S1-CHECK-COMMENT s1-check-comments - "the validation comment has the rules of integration and the actions of S1" \
    "Replacement rules for .integration." "PRA pre command" "PRA apex account" "PRA manual check"
  merge_deploy "$S1" integration s1-deploy
  assert_log S1-DEPLOY s1-deploy 0 "the deployment applies the rules of integration, the post command sees the files of git again, the apex action runs" \
    "Applying replacement rules for integration" "Restored [0-9]+ files changed by the replacement rules" \
    "PRA_POST_SEES_GIT_VALUE" "!PRA_POST_SEES_REPLACED_VALUE" "PRA apex account" "!: pra-uat-only"
  check_org S1-ORG integration https://int.pra.example.com git-value not-main project-value "" https://int-api.pra.example.com
  check_apex_action S1-ORG-APEX-ACTION https://int.pra.example.com
fi

# ------------------------------------------------------------------ s2: a new rule travels with its story
if step s2; then
  say "S2: a story that adds a label and the rule for it"
  cd "$WORK" || exit 1
  git checkout -q -f integration && git pull -q origin integration
  git checkout -q -B "$STORY_BRANCH_S2"
  # Inserted before PRA_Uat_Only (labels stay sorted), whatever the line endings of the clone
  node -e "
    const fs=require('fs'); const f='force-app/main/default/labels/CustomLabels.labels-meta.xml';
    const s=fs.readFileSync(f,'utf8'); const eol=s.includes('\r\n')?'\r\n':'\n';
    const at=s.lastIndexOf('<labels>', s.indexOf('<fullName>PRA_Uat_Only</fullName>'));
    if(s.indexOf('<fullName>PRA_Uat_Only</fullName>')<0||at<0){process.exit(1)}
    const start=s.lastIndexOf('\n', at)+1;
    const label=['    <labels>','        <fullName>PRA_Story</fullName>','        <language>en_US</language>','        <protected>false</protected>','        <shortDescription>PRA_Story</shortDescription>','        <value>story-git</value>','    </labels>',''].join(eol);
    fs.writeFileSync(f, s.slice(0,start)+label+s.slice(start));" || {
    record S2-EDIT FAIL "the PRA_Story label could not be inserted"
    exit 1
  }
  cat >>config/.sfdx-hardis.yml <<'YAML'
  # Added by story S2, with its label
  - id: pra-story
    type: xml-value
    files: "**/labels/CustomLabels.labels-meta.xml"
    xmlPath: CustomLabels/labels[fullName=PRA_Story]/value
    values:
      default: story-default
      preprod: story-preprod
YAML
  grep -q '<fullName>PRA_Story</fullName>' force-app/main/default/labels/CustomLabels.labels-meta.xml || {
    record S2-EDIT FAIL "no PRA_Story label after the edit"
    exit 1
  }
  git add force-app config && git commit -qm "feat: PRA story label and its rule" && git push -q -u origin "$STORY_BRANCH_S2"
  printf 'S2: a new label and the replacement rule for it, plus a removal of the Apex class for main only.\n' >"$LOGS/bodies/s2.md"
  S2=$(p_open "$STORY_BRANCH_S2" integration "E2E-702 PRA story rule" "$LOGS/bodies/s2.md") || exit 1
  save S2 "$S2"
  create_action "$S2" s2-remove --when pre-deploy --type remove-packagexml-items --label "PRA remove apex for main" --packagexml-items "ApexClass:PRAEndpoints" --include-target-branches main
  F="scripts/actions/.sfdx-hardis.$S2.yml"
  cp "$F" "$LOGS/s2-actions.yml"
  save S2_REMOVE "$(action_id "$F" "PRA remove apex for main")"
  git add scripts/actions && git commit -qm "chore: actions of #$S2" && git push -q
  say "S2=#$S2"
  validate "$S2" "$(git rev-parse HEAD)" s2-check
  assert_log S2-CHECK s2-check 0 "the rule added by the story applies in its own validation; the main-only removal does not run" \
    "Applying replacement rules for integration" ": pra-story" "!Removed [0-9]+ item\(s\) from"
  merge_deploy "$S2" integration s2-deploy
  assert_log S2-DEPLOY s2-deploy 0 "the deployment applies the rule of the story" ": pra-story" "!Removed [0-9]+ item\(s\) from"
  check_org S2-ORG integration https://int.pra.example.com git-value not-main project-value story-default https://int-api.pra.example.com
fi

# ------------------------------------------------------------------ s3: a rule change that stays in integration
if step s3; then
  say "S3: a change of a rule value, never promoted"
  cd "$WORK" || exit 1
  git checkout -q -f integration && git pull -q origin integration
  git checkout -q -B "$STORY_BRANCH_S3"
  sed -i 's#<shortDescription>PRA_Issue v1</shortDescription>#<shortDescription>PRA_Issue s3</shortDescription>#' force-app/main/default/labels/CustomLabels.labels-meta.xml
  sed -i 's#default: project-value#default: s3-value#' config/.sfdx-hardis.yml
  if ! grep -q 'PRA_Issue s3<' force-app/main/default/labels/CustomLabels.labels-meta.xml || ! grep -q 'default: s3-value' config/.sfdx-hardis.yml; then
    record S3-EDIT FAIL "the S3 edits did not apply"
    exit 1
  fi
  git add force-app config && git commit -qm "feat: PRA issue default changed" && git push -q -u origin "$STORY_BRANCH_S3"
  printf 'S3: changes the default value of pra-issue. It stays in integration: the promotions must not carry it.\n' >"$LOGS/bodies/s3.md"
  S3=$(p_open "$STORY_BRANCH_S3" integration "E2E-703 PRA issue default" "$LOGS/bodies/s3.md") || exit 1
  save S3 "$S3"
  say "S3=#$S3"
  validate "$S3" "$(git rev-parse HEAD)" s3-check
  assert_log S3-CHECK s3-check 0 "the validation of S3 applies its own value" ": pra-issue"
  merge_deploy "$S3" integration s3-deploy
  assert_log S3-DEPLOY s3-deploy 0 "the deployment of S3" ": pra-issue"
  check_org S3-ORG integration https://int.pra.example.com git-value not-main s3-value story-default https://int-api.pra.example.com
fi

# ------------------------------------------------------------------ a promotion: create, validate, merge, deploy
# Usage: promote <source> <target> <id prefix>; sets PROMO_NUMBER (empty when none was created)
promote() {
  PROMO_NUMBER=""
  local source="$1" target="$2" p="$3" number
  say "promotion $source -> $target of #$S1 #$S2"
  p_promote "$source" "$S1,$S2" "$p-promote" >/dev/null
  echo $? >"$LOGS/$p-promote.code"
  number=$(promo_number "$p-promote")
  if [ -z "$number" ]; then
    record "$p-PROMOTE" FAIL "no promotion Pull Request created, see $p-promote.log"
    return 1
  fi
  save "PROMO_${target^^}" "$number"
  record "$p-PROMOTE" OK "promotion #$number $source -> $target carries #$S1 and #$S2"
  # What the promotion branch holds: the config of S2, never the value of S3
  git -C "$WORK" fetch -q origin
  local head
  head=$(ci_pr_head_sha "$number")
  if git -C "$WORK" show "$head:config/.sfdx-hardis.yml" >"$LOGS/$p-config.yml" 2>/dev/null; then
    if grep -q "id: pra-story" "$LOGS/$p-config.yml" && ! grep -q "s3-value" "$LOGS/$p-config.yml"; then
      record "$p-CONFIG" OK "the promotion carries the rule of S2 and not the value of S3"
    else
      record "$p-CONFIG" FAIL "promotion config: pra-story $(grep -c 'id: pra-story' "$LOGS/$p-config.yml"), s3-value $(grep -c s3-value "$LOGS/$p-config.yml")"
    fi
  else
    record "$p-CONFIG" FAIL "head $head of #$number not fetched"
  fi
  validate "$number" "$head" "${p,,}-check"
  PROMO_NUMBER="$number"
}

# ------------------------------------------------------------------ uat
if step uat; then
  promote integration uat UAT
  P="$PROMO_NUMBER"
  assert_log UAT-CHECK uat-check 0 "the validation of the promotion applies the rules of uat: the branch file value, the uat-only rule; the pre command of S1 runs for uat" \
    "Applying replacement rules for uat" ": pra-endpoint" ": pra-uat-only" ": pra-not-main" ": pra-story" ": pra-apex-host" ": pra-secret" \
    "PRA_PRE_SEES_GIT_VALUE" "!secret not found" "!Removed [0-9]+ item\(s\) from"
  assert_log UAT-CHECK-COMMENT uat-check-comments - "the validation comment has the rules of uat and the actions the promotion carries" \
    "Replacement rules for .uat." "PRA pre command" "PRA apex account"
  merge_deploy "$P" uat uat-deploy
  assert_log UAT-DEPLOY uat-deploy 0 "the deployment of the promotion applies the rules of uat and runs the actions of S1 in uat" \
    "Applying replacement rules for uat" ": pra-uat-only" "PRA_POST_SEES_GIT_VALUE" "PRA apex account" "!Removed [0-9]+ item\(s\) from"
  check_org UAT-ORG uat https://uat-branch.pra.example.com uat-only not-main project-value story-default https://uat-api.pra.example.com
  check_apex_action UAT-ORG-APEX-ACTION https://uat-branch.pra.example.com
  status_check UAT-STATUS uat-status "statuses of the actions of S1 in uat" "--pr-ids $S1" \
    "S:$S1:$S1_POST:uat=success" "S:$S1:$S1_APEX:uat=success" "S:$S1:$S1_MANUAL:uat=manual"
fi

# ------------------------------------------------------------------ preprod
if step preprod; then
  promote uat preprod PREPROD
  P="$PROMO_NUMBER"
  assert_log PREPROD-CHECK preprod-check 0 "the validation applies the rules of preprod: the issue value, the story value, not the uat-only rule" \
    "Applying replacement rules for preprod" ": pra-issue" ": pra-story" ": pra-not-main" "!: pra-uat-only" "!secret not found"
  assert_log PREPROD-CHECK-COMMENT preprod-check-comments - "the validation comment has the rules of preprod and says the issue changed one" \
    "Replacement rules for .preprod." "issue"
  merge_deploy "$P" preprod preprod-deploy
  assert_log PREPROD-DEPLOY preprod-deploy 0 "the deployment applies the rules of preprod and runs the actions of S1 in preprod" \
    "Applying replacement rules for preprod" "PRA_POST_SEES_GIT_VALUE" "PRA apex account" "!: pra-uat-only"
  check_org PREPROD-ORG preprod https://preprod.pra.example.com git-value not-main from-issue story-preprod https://preprod-api.pra.example.com
  check_apex_action PREPROD-ORG-APEX-ACTION https://preprod.pra.example.com
fi

# ------------------------------------------------------------------ main
if step main; then
  promote preprod main MAIN
  P="$PROMO_NUMBER"
  assert_log MAIN-CHECK main-check 0 "the validation applies the rules of main: no pra-not-main; the main-only action of S2 removes the Apex class, so pra-apex-host has nothing to change" \
    "Applying replacement rules for main" ": pra-endpoint" "!: pra-not-main" "!: pra-uat-only" "Removed 1 item\(s\) from" "!: pra-apex-host"
  merge_deploy "$P" main main-deploy
  assert_log MAIN-DEPLOY main-deploy 0 "the deployment to main: rules of main, the Apex class left out by the action of S2, the actions of S1 run" \
    "Applying replacement rules for main" "!: pra-not-main" "Removed 1 item\(s\) from" "!: pra-apex-host" "PRA_POST_SEES_GIT_VALUE" "PRA apex account"
  # The Apex class was not deployed: the org keeps the host of preprod
  check_org MAIN-ORG main https://prod.pra.example.com git-value git-value project-value story-default https://preprod-api.pra.example.com
  check_apex_action MAIN-ORG-APEX-ACTION https://prod.pra.example.com
  status_check MAIN-STATUS main-status "statuses of the actions in main" "--pr-ids $S1,$S2" \
    "S:$S1:$S1_POST:main=success" "S:$S1:$S1_APEX:main=success"
fi

# ------------------------------------------------------------------ extension: what VS Code shows
if step extension; then
  p_pr_modal_check --json "$(native "$LOGS")/pr-modal.json" >"$LOGS/pr-modal.log" 2>&1
  echo $? >"$LOGS/pr-modal.code"
  assert_log X1 pr-modal 0 "the Pull Request modal tabs show what the provider holds"
  printf '{ "label": "end of the run", "windows": { "integration": [%s] }, "arrows": { "integration>uat": null, "uat>preprod": null, "preprod>main": null } }\n' "$S3" >"$LOGS/pipeline-expect.json"
  pipeline_check pipeline "$(native "$LOGS/pipeline-expect.json")" >/dev/null
  echo $? >"$LOGS/pipeline.code"
  assert_log X2 pipeline 0 "the DevOps Pipeline shows S3 alone in integration, no open promotion"
fi

# ------------------------------------------------------------------ report (the last result of each id)
if step report; then
  awk -F' \\| ' '{last[$1]=$0; if(!($1 in seen)){order[++n]=$1; seen[$1]=1}} END{for(i=1;i<=n;i++) print last[order[i]]}' "$RESULTS" >"$LOGS/results-last.txt"
  ok=$(grep -c ' | OK | ' "$LOGS/results-last.txt")
  fail=$(grep -c ' | FAIL | ' "$LOGS/results-last.txt")
  skip=$(grep -c ' | SKIP | ' "$LOGS/results-last.txt")
  {
    echo "# Promotion + replacement rules + deployment actions e2e - $RUN"
    echo
    echo "- provider: $PROVIDER, repository: ${REPO:-$GL_HOST/${PROJECT_PATH:-?}}"
    echo "- sfdx-hardis branch: $SFDX_HARDIS_BRANCH ($(git -C "$ROOT" rev-parse --short HEAD))"
    echo "- org: scratch org $ORG, testLevel $PRA_TEST_LEVEL"
    echo "- stories: S1 #${S1:-?}, S2 #${S2:-?}, S3 #${S3:-?}; promotions: uat #${PROMO_UAT:-?}, preprod #${PROMO_PREPROD:-?}, main #${PROMO_MAIN:-?}"
    echo "- result: $ok OK, $fail FAIL, $skip SKIP"
    echo
    echo "| Check | Result | Detail |"
    echo "|-------|--------|--------|"
    sed -E 's/\|/\\|/g; s/^(.*) \\\| (OK|FAIL|SKIP) \\\| (.*)$/| \1 | \2 | \3 |/' "$LOGS/results-last.txt"
    echo
    echo "## CI jobs"
    echo
    echo '```'
    column -t -s $'\t' "$LOGS/ci-jobs.tsv" 2>/dev/null || cat "$LOGS/ci-jobs.tsv"
    echo '```'
  } >"$LOGS/report.md"
  say "report: $LOGS/report.md ($ok OK, $fail FAIL, $skip SKIP)"
fi
echo "PRA E2E DONE"
