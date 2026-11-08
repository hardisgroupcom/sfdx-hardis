#!/usr/bin/env bash
# Development orgs list, end to end, in REAL CI jobs running sfdx-hardis built from the branch under
# test, the commands a developer runs on a workstation (bin/dev.js of this working copy), the
# "Development Orgs Dashboard" issue of the git provider, and the DevOps Pipeline of
# vscode-sfdx-hardis read headless (check-pipeline.cjs).
#
# A scratch org plays the three major branches, a second one is the developer's org. work:new
# registers the dev org, a merge into integration makes the deployment job count what it misses,
# a release manager moves it to uat, the merge of integration into uat is a vehicle that carries
# the first story, a backpromote brings the org up to date, then the org is removed.
#
#   PROVIDER=github bash devorgs-e2e.sh                     # the whole run (GitHub only for now)
#   PROVIDER=github RUN=<run> STEPS="pipeline-1 report" bash devorgs-e2e.sh   # replay steps
#
# Steps, in order: orgs repo new other-target merge-1 pipeline-1 edit vehicle backpromote
# pipeline-2 refresh remove report
#
# Settings (environment, then the .env of the sfdx-hardis working copy):
#   PROVIDER            github (default). The other providers need their local token variables wired
#   DEVHUB              Dev Hub that creates the two scratch orgs (default DevHub)
#   SFDX_HARDIS_BRANCH  branch of hardisgroupcom/sfdx-hardis the jobs build (default: current, pushed)
#   RUN                 run name (default devorgs-e2e-<provider>-<date>): WORK and LOGS under the OS temp dir
#   GitHub: GH_E2E_OWNER
#
# Results: $LOGS/results.tsv (id, OK|FAIL|SKIP, detail), report in $LOGS/report.md
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMO_SCRIPTS="$(cd "$HERE/../../promotion-branches/scripts" && pwd)"
export PROVIDER="${PROVIDER:-github}"
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/env-lib.sh"
e2e_defaults
e2e_load_env DEVHUB GH_E2E_OWNER
ROOT="$E2E_ROOT"
DEVHUB="${DEVHUB:-DevHub}"
STAMP="$(date +%m%d%H%M)"
RUN="${RUN:-devorgs-e2e-$PROVIDER-$(date +%Y%m%d-%H%M)}"
export WORK="${DEVORGS_WORK:-$E2E_TMP/$RUN}"
export LOGS="${DEVORGS_LOGS:-$E2E_TMP/$RUN-logs}"
SFDX_HARDIS_BRANCH="${SFDX_HARDIS_BRANCH:-$(git -C "$ROOT" branch --show-current)}"
STEPS="${STEPS:-orgs repo new other-target merge-1 pipeline-1 edit vehicle backpromote pipeline-2 refresh remove report}"
mkdir -p "$LOGS/bodies"
export RESULTS="$LOGS/results.tsv"
touch "$RESULTS" "$LOGS/run.env"
[ -f "$LOGS/ci-jobs.tsv" ] || printf 'label\tprovider\tmode\trun\tresult\tqueued_s\tran_s\tbuild_minutes\n' >"$LOGS/ci-jobs.tsv"
# shellcheck source=/dev/null
source "$LOGS/run.env"
# shellcheck source=/dev/null
[ -f "$LOGS/ci-vars.sh" ] && source "$LOGS/ci-vars.sh"
export MAJOR_ORG="${MAJOR_ORG:-devorgs-major-$STAMP}"
export DEV_ORG="${DEV_ORG:-devorgs-dev-$STAMP}"
# The git user of the clone: the developer who starts the User Stories
OWNER_NAME="E2E Owner"
OWNER_EMAIL="e2e-owner@example.com"
case "$PROVIDER" in
github)
  [ -n "${REPO:-}" ] || REPO="${GH_E2E_OWNER:-$(gh api user --jq .login)}/sfdx-hardis-devorgs-e2e-$STAMP"
  export REPO
  ;;
*)
  echo "PROVIDER=$PROVIDER: only github is wired for now (the local commands need the token variables of the provider)"
  exit 2
  ;;
esac

export SCRIPTS_DIR="$PROMO_SCRIPTS"
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/ci-provider-$PROVIDER.sh"
ci_provider_init || exit 1
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/section-lib.sh"
record() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$RESULTS"
  echo "[$2] $1 - $3"
}
ci_tick_in_file() { :; }
save() {
  printf 'export %s=%q\n' "$1" "$2" >>"$LOGS/run.env"
  export "$1=$2"
}
step() { case " $STEPS " in *" $1 "*) return 0 ;; *) return 1 ;; esac }
say() { echo "[$(date +%T)] $*"; }
native() { cygpath -m "$1" 2>/dev/null || echo "$1"; }
json_of() { node -e "const t=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(t.slice(t.indexOf('{')));const v=($1);process.stdout.write(v===undefined||v===null?'':String(v))}catch(e){}"; }
provider_lib() {
  # shellcheck source=/dev/null
  source "$PROMO_SCRIPTS/promotion-provider.sh"
}

# A command a developer runs on a workstation: bin/dev.js of this working copy, in the clone, with
# the git provider token the VS Code extension would pass. stdout in <label>.out, all in <label>.log
hardis() {
  local label="$1"
  shift
  (cd "$WORK" && env -u NODE_OPTIONS -u CI GITHUB_TOKEN="$(p_token)" node "$(native "$ROOT/bin/dev.js")" "$@") \
    >"$LOGS/$label.out" 2>"$LOGS/$label.err"
  echo $? >"$LOGS/$label.code"
  cat "$LOGS/$label.out" "$LOGS/$label.err" >"$LOGS/$label.log"
}
# The answer of a --json command: the last JSON document of its stdout
json_answer() { node -e "const t=require('fs').readFileSync(process.argv[1],'utf8');const i=t.lastIndexOf('{\n  \"status\"');process.stdout.write(i>=0?t.slice(i):t.slice(t.indexOf('{')))" "$(native "$LOGS/$1.out")" >"$LOGS/$1.json"; }
# sf hardis:project:dev-org:list into <label>.json
list_dev_orgs() {
  hardis "$1" hardis:project:dev-org:list --agent --json
  json_answer "$1"
}
# Usage: expect_json <id> <json file> <description> <condition>: the condition reads j (the
# document), d (j.result.devOrgs), org (the entry of the dev org) and dash (dashboard.json)
expect_json() {
  local id="$1" file="$2" desc="$3" cond="$4" out
  if out=$(DEV_ID="$DEV_ID" PR1="${PR1:-0}" PR_V="${PR_V:-0}" OWNER_EMAIL="$OWNER_EMAIL" node -e "
const fs=require('fs');
let j={};try{const t=fs.readFileSync(process.argv[1],'utf8');j=JSON.parse(t.slice(t.indexOf('{')))}catch(e){console.log('not JSON: '+process.argv[1]);process.exit(1)}
const d=(j.result||{}).devOrgs||{orgs:[]};
const org=(d.orgs||[]).find((o)=>o.orgId===process.env.DEV_ID)||null;
const dash=fs.existsSync(process.argv[2])?JSON.parse(fs.readFileSync(process.argv[2],'utf8')):{};
const PR1=Number(process.env.PR1), PR_V=Number(process.env.PR_V);
let ok=false;try{ok=!!($cond)}catch(e){console.log(String(e));process.exit(1)}
const brief=org?{targetBranch:org.targetBranch,owner:org.owner&&org.owner.email,users:(org.users||[]).map((u)=>u.email),isMine:org.isMine,lastBackpromote:org.lastBackpromote,behind:org.behind&&{count:org.behind.count,prs:org.behind.pullRequests.map((p)=>[p.number,p.vehicle,p.carried&&p.carried.map((c)=>c.number)])}}:{orgs:(d.orgs||[]).length,error:j.result&&j.result.errorKind,message:j.message};
console.log(JSON.stringify(brief));process.exit(ok?0:1)" "$(native "$file")" "$(native "$LOGS/dashboard.json")" 2>&1); then
    record "$id" OK "$desc"
  else
    record "$id" FAIL "$desc: $out"
  fi
}
# The "Development Orgs Dashboard" issue as the git provider holds it, into dashboard.json:
# the open issues of that title, the body, and the decoded comments
read_dashboard() {
  gh issue list -R "$REPO" --state open --search "\"Development Orgs Dashboard\" in:title" --json number,title,url >"$LOGS/dashboard-issues.json" 2>/dev/null
  local number
  number=$(node -e "const a=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const m=a.filter((i)=>i.title==='Development Orgs Dashboard');process.stdout.write(m.length?String(m[0].number):'')" "$(native "$LOGS/dashboard-issues.json")")
  if [ -z "$number" ]; then
    echo '{"issues":0}' >"$LOGS/dashboard.json"
    return
  fi
  gh api "repos/$REPO/issues/$number" --jq .body >"$LOGS/dashboard-body.md" 2>/dev/null
  gh api "repos/$REPO/issues/$number/comments" --paginate >"$LOGS/dashboard-comments.json" 2>/dev/null
  node -e "
const fs=require('fs');
const issues=JSON.parse(fs.readFileSync(process.argv[1],'utf8')).filter((i)=>i.title==='Development Orgs Dashboard');
const comments=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).map((c)=>{
  const m=(c.body||'').replace(/\s+/g,'').match(/\[sfdx-hardis-devorg-data:([A-Za-z0-9_-]+)\]/);
  if(!m){return {id:c.id,kind:null}}
  const data=JSON.parse(Buffer.from(m[1],'base64url').toString('utf8'));
  return {id:c.id,author:c.user&&c.user.login,kind:data.kind,orgId:data.orgId,removed:!!data.removed,targetBranch:data.targetBranch,branch:data.branch,merges:data.merges&&data.merges.map((x)=>[x.number,x.vehicle,x.carried&&x.carried.map((y)=>y.number)])};
});
fs.writeFileSync(process.argv[4],JSON.stringify({issues:issues.length,number:issues[0].number,body:fs.readFileSync(process.argv[3],'utf8'),comments},null,2));
" "$(native "$LOGS/dashboard-issues.json")" "$(native "$LOGS/dashboard-comments.json")" "$(native "$LOGS/dashboard-body.md")" "$(native "$LOGS/dashboard.json")"
}
# check-pipeline.cjs on the local clone with main checked out, fed the list of the dev orgs
# Usage: devorgs_pipeline <label> <list json> <devOrgNodes JSON>
devorgs_pipeline() {
  local label="$1" list="$2" nodes="$3" code
  printf '{ "label": "%s", "devOrgsFile": "%s", "devOrgNodes": %s }\n' "$label" "$(native "$list")" "$nodes" >"$LOGS/$label.expect.json"
  git -C "$WORK" checkout -q -f main
  git -C "$WORK" pull -q origin main
  env -u NODE_OPTIONS EXT="$EXT" WORK="$(native "$WORK")" PROVIDER_TOKEN="$(p_token)" \
    node "$PROMO_SCRIPTS/check-pipeline.cjs" "$(native "$LOGS/$label.expect.json")" --dump "$(native "$LOGS/$label.dump.json")" >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$code" >"$LOGS/$label.code"
  if [ "$code" = "0" ]; then
    record "${label^^}" OK "the DevOps Pipeline draws $nodes"
  else
    record "${label^^}" FAIL "$(grep -E '^FAIL|^Cannot load|^No active git provider|Error' "$LOGS/$label.log" | head -6 | tr '\n' ';')"
  fi
}

say "run $RUN - provider $PROVIDER - work $WORK - logs $LOGS - branch under test $SFDX_HARDIS_BRANCH"

# ------------------------------------------------------------------ orgs: the major org and the dev org
if step orgs; then
  for alias in "$MAJOR_ORG" "$DEV_ORG"; do
    if ! env -u NODE_OPTIONS sf org display -o "$alias" --json 2>/dev/null | grep -qE '"connectedStatus": "Connected"|"status": "Active"'; then
      env -u NODE_OPTIONS sf org create scratch --target-dev-hub "$DEVHUB" --alias "$alias" --edition developer --duration-days 2 --wait 30 --json >"$LOGS/org-create-$alias.json" 2>&1 || {
        record ORGS FAIL "scratch org $alias not created, see org-create-$alias.json"
        exit 1
      }
    fi
  done
  save MAJOR_ORG "$MAJOR_ORG"
  save DEV_ORG "$DEV_ORG"
  AUTH_URL=$(env -u NODE_OPTIONS sf org auth show-sfdx-auth-url -o "$MAJOR_ORG" --json 2>/dev/null | json_of "j.result.sfdxAuthUrl")
  [[ "$AUTH_URL" == force://* ]] || {
    record ORGS FAIL "no sfdxAuthUrl for $MAJOR_ORG"
    exit 1
  }
  printf '%s' "$AUTH_URL" >"$LOGS/auth-url.txt"
  env -u NODE_OPTIONS sf org display -o "$MAJOR_ORG" --json >"$LOGS/major-display.json" 2>/dev/null
  save ORG_USERNAME "$(json_of "j.result.username" <"$LOGS/major-display.json")"
  save ORG_INSTANCE "$(json_of "j.result.instanceUrl" <"$LOGS/major-display.json")"
  env -u NODE_OPTIONS sf org display -o "$DEV_ORG" --json >"$LOGS/dev-display.json" 2>/dev/null
  save DEV_ID "$(json_of "j.result.id" <"$LOGS/dev-display.json")"
  save DEV_USERNAME "$(json_of "j.result.username" <"$LOGS/dev-display.json")"
  record ORGS OK "major org $MAJOR_ORG ($ORG_USERNAME) for integration, uat and main; dev org $DEV_ORG ($DEV_ID)"
fi

# ------------------------------------------------------------------ repo: project, CI files, remote, logins
if step repo; then
  WORK="$WORK" API="$API" bash "$HERE/devorgs-build-project.sh" >"$LOGS/build.log" 2>&1 || {
    record REPO FAIL "project not built, see build.log"
    exit 1
  }
  cd "$WORK" || exit 1
  git config user.name "$OWNER_NAME"
  git config user.email "$OWNER_EMAIL"
  for f in config/branches/.sfdx-hardis.*.yml; do
    printf 'targetUsername: %s\ninstanceUrl: %s\n' "$ORG_USERNAME" "$ORG_INSTANCE" >>"$f"
  done
  node "$PROMO_SCRIPTS/ci-workflows-prepare.cjs" --provider "$PROVIDER" "$ROOT" "$(native "$WORK")" "$SFDX_HARDIS_BRANCH" >>"$LOGS/build.log" 2>&1 || {
    record REPO FAIL "CI files not written, see build.log"
    exit 1
  }
  git add -A && git commit -qm "chore: CI files of the sfdx-hardis branch $SFDX_HARDIS_BRANCH"
  : >"$LOGS/ci-vars.sh"
  ci_create_remote "$(cat "$LOGS/auth-url.txt")" >>"$LOGS/build.log" 2>&1 || {
    record REPO FAIL "remote not created, see build.log"
    exit 1
  }
  # shellcheck source=/dev/null
  source "$LOGS/ci-vars.sh"
  save REPO_READY 1
  record REPO OK "repository $REPO with main integration uat, the CI files of $SFDX_HARDIS_BRANCH, the logins"
fi
if [ -n "${REPO_READY:-}" ]; then provider_lib; fi

# ------------------------------------------------------------------ new: work:new registers the dev org
if step new; then
  say "new: work:new in the dev org, target integration"
  cd "$WORK" || exit 1
  git checkout -q -f main
  read_dashboard
  expect_json NEW-NO-DASHBOARD "$LOGS/dashboard.json" "no Development Orgs Dashboard before the first registration" "dash.issues===0"
  hardis new-1 hardis:work:new --agent --task-name "DEVORGS-1 First story" --target-branch integration --target-org "$DEV_ORG"
  assert_log NEW new-1 0 "work:new registers the dev org it works in" "registered for target branch integration"
  save B1 "$(git -C "$WORK" branch --show-current)"
  read_dashboard
  expect_json NEW-DASHBOARD "$LOGS/dashboard.json" "one open Development Orgs Dashboard issue, one comment for the dev org, a text that says not to edit it" \
    "dash.issues===1 && dash.comments.filter((c)=>c.kind==='org'&&c.orgId===process.env.DEV_ID).length===1 && /Do not edit this text/.test(dash.body) && /Target branch integration/.test(dash.body)"
  list_dev_orgs list-new
  expect_json NEW-LIST "$LOGS/list-new.json" "the list holds the dev org: target integration, the git user owns it and it is mine, nothing counted yet" \
    "org && org.targetBranch==='integration' && org.owner.email===process.env.OWNER_EMAIL && org.isMine===true && org.behind===null && org.orgType==='scratch'"
fi

# ------------------------------------------------------------------ other-target: one target branch per org
if step other-target; then
  say "other-target: work:new in the same org, target uat"
  hardis new-2 hardis:work:new --agent --task-name "DEVORGS-2 Other target" --target-branch uat --target-org "$DEV_ORG"
  assert_log OTHER-TARGET new-2 0 "work:new on another target branch warns and keeps the registered one" "is registered for target branch integration, not uat"
  list_dev_orgs list-other
  expect_json OTHER-TARGET-LIST "$LOGS/list-other.json" "the registered target branch is still integration" "org && org.targetBranch==='integration'"
  git -C "$WORK" checkout -q -f "$B1"
fi

# ------------------------------------------------------------------ merge-1: a story merged into integration
if step merge-1; then
  say "merge-1: a story merged into integration, the deployment job counts it for the dev org"
  cd "$WORK" || exit 1
  git checkout -q -f "$B1"
  sed -i 's#<value>base</value>#<value>first story</value>#' force-app/main/default/labels/CustomLabels.labels-meta.xml
  git commit -qam "DEVORGS-1: label value" && git push -q -u origin "$B1"
  printf 'DEVORGS-1: the label value of the first story.\n' >"$LOGS/bodies/story-1.md"
  PR1=$(p_open "$B1" integration "DEVORGS-1 First story" "$LOGS/bodies/story-1.md") || {
    record MERGE-1-PR FAIL "Pull Request not opened"
    exit 1
  }
  save PR1 "$PR1"
  ci_wait_check "$PR1" "$(git rev-parse HEAD)" check-1
  assert_log MERGE-1-CHECK check-1 0 "the validation of #$PR1 succeeds" "Deploying|deploy"
  p_merge "$PR1" >/dev/null || {
    record MERGE-1 FAIL "merge of #$PR1"
    exit 1
  }
  ci_wait_deploy integration "$(ci_merge_sha "$PR1")" deploy-1
  assert_log MERGE-1-DEPLOY deploy-1 0 "the deployment job of integration updates the development orgs list" "Development orgs list updated"
  read_dashboard
  expect_json MERGE-1-DASHBOARD "$LOGS/dashboard.json" "the dashboard holds the merged Pull Requests of integration, written by the CI job" \
    "dash.comments.some((c)=>c.kind==='branch'&&c.branch==='integration'&&c.merges.some((m)=>m[0]===PR1))"
  list_dev_orgs list-merge-1
  expect_json MERGE-1-LIST "$LOGS/list-merge-1.json" "the dev org misses one Pull Request, #$PR1" \
    "org && org.behind && org.behind.count===1 && org.behind.pullRequests[0].number===PR1 && org.behind.pullRequests[0].vehicle===false"
fi

# ------------------------------------------------------------------ pipeline-1: the dev org under integration, with its bubble
if step pipeline-1; then
  devorgs_pipeline pipeline-1 "$LOGS/list-merge-1.json" "{ \"devOrgs\": { \"$DEV_ID\": 1 }, \"featureBranches\": { \"$DEV_ID\": null } }"
fi

# ------------------------------------------------------------------ edit: a release manager moves the org to uat
if step edit; then
  say "edit: register --org-id moves the org to uat, with a new owner"
  hardis edit hardis:project:dev-org:register --agent --org-id "$DEV_ID" --target-branch uat \
    --owner "E2E Lead <e2e-lead@example.com>" --users "$OWNER_NAME <$OWNER_EMAIL>, E2E Dev <e2e-dev@example.com>"
  assert_log EDIT edit 0 "register --org-id changes the target branch, the owner and the users" "registered for target branch uat"
  list_dev_orgs list-edit
  expect_json EDIT-LIST "$LOGS/list-edit.json" "target uat, owner e2e-lead, the git user is still one of the users (mine), nothing counted for uat yet" \
    "org && org.targetBranch==='uat' && org.owner.email==='e2e-lead@example.com' && org.users.map((u)=>u.email).sort().join()==='e2e-dev@example.com,'+process.env.OWNER_EMAIL && org.isMine===true && org.behind===null"
fi

# ------------------------------------------------------------------ vehicle: integration merged into uat
if step vehicle; then
  say "vehicle: integration merged into uat, carrying #$PR1"
  cd "$WORK" || exit 1
  printf 'Sync integration into uat.\n' >"$LOGS/bodies/vehicle.md"
  PR_V=$(p_open integration uat "Sync integration into uat" "$LOGS/bodies/vehicle.md") || {
    record VEHICLE-PR FAIL "Pull Request not opened"
    exit 1
  }
  save PR_V "$PR_V"
  # The head of the Pull Request as the provider has it: the local origin/integration is not fetched
  ci_wait_check "$PR_V" "$(ci_pr_head_sha "$PR_V")" check-v
  assert_log VEHICLE-CHECK check-v 0 "the validation of #$PR_V succeeds" "Deploying|deploy"
  p_merge "$PR_V" >/dev/null || {
    record VEHICLE FAIL "merge of #$PR_V"
    exit 1
  }
  ci_wait_deploy uat "$(ci_merge_sha "$PR_V")" deploy-v
  assert_log VEHICLE-DEPLOY deploy-v 0 "the deployment job of uat updates the development orgs list" "Development orgs list updated"
  list_dev_orgs list-vehicle
  expect_json VEHICLE-LIST "$LOGS/list-vehicle.json" "the dev org misses one Pull Request, #$PR_V, a vehicle carrying #$PR1" \
    "org && org.behind && org.behind.count===1 && org.behind.pullRequests[0].number===PR_V && org.behind.pullRequests[0].vehicle===true && (org.behind.pullRequests[0].carried||[]).some((c)=>c.number===PR1)"
fi

# ------------------------------------------------------------------ backpromote: the org is brought up to date
if step backpromote; then
  say "backpromote: uat into the dev org"
  cd "$WORK" || exit 1
  git checkout -q -f main
  hardis bp-plan hardis:work:backpromote --plan --json --target-org "$DEV_ORG" --parent-branch uat
  json_answer bp-plan
  RUN_ID=$(json_of "j.result.runId||j.data&&j.data.runId" <"$LOGS/bp-plan.json")
  START=$(json_of "(()=>{const r=j.result||j.data||{};const prs=(r.pullRequests||[]).map((p)=>p.number).filter((n)=>n>0);return prs.includes($PR1)?$PR1:prs[prs.length-1]})()" <"$LOGS/bp-plan.json")
  if [ -z "$RUN_ID" ] || [ -z "$START" ]; then
    record BACKPROMOTE FAIL "no runId or no start Pull Request in the plan, see bp-plan.json"
  else
    hardis bp-run hardis:work:backpromote --agent --json --run-id "$RUN_ID" --target-org "$DEV_ORG" --parent-branch uat --from-pull-request "$START"
    json_answer bp-run
    assert_log BACKPROMOTE bp-run 0 "the backpromote of uat into the dev org runs (start #$START)" '"status": "ok"|"status": "nothingToDo"'
    list_dev_orgs list-backpromote
    expect_json BACKPROMOTE-LIST "$LOGS/list-backpromote.json" "the backpromote is recorded from uat and the dev org misses nothing anymore" \
      "org && org.lastBackpromote && org.lastBackpromote.parentBranch==='uat' && org.behind && org.behind.count===0"
  fi
  git -C "$WORK" checkout -q -f main
fi

# ------------------------------------------------------------------ pipeline-2: no bubble once up to date
if step pipeline-2; then
  devorgs_pipeline pipeline-2 "$LOGS/list-backpromote.json" "{ \"devOrgs\": { \"$DEV_ID\": \"none\" } }"
fi

# ------------------------------------------------------------------ refresh: list --refresh from a workstation
if step refresh; then
  hardis list-refresh hardis:project:dev-org:list --agent --json --refresh
  json_answer list-refresh
  expect_json REFRESH "$LOGS/list-refresh.json" "list --refresh lists the merged Pull Requests of uat again from the workstation (no job link), the count stays 0" \
    "org && org.behind && org.behind.count===0 && d.branches.some((b)=>b.name==='uat'&&b.jobUrl===null)"
fi

# ------------------------------------------------------------------ remove: the release manager removes the org
if step remove; then
  hardis remove hardis:project:dev-org:remove --agent --org-id "$DEV_ID"
  assert_log REMOVE remove 0 "dev-org:remove removes the org" "removed from the development orgs list"
  list_dev_orgs list-remove
  expect_json REMOVE-LIST "$LOGS/list-remove.json" "the list is empty" "!org && d.orgs.length===0"
  read_dashboard
  expect_json REMOVE-DASHBOARD "$LOGS/dashboard.json" "the dashboard says no org is registered" "/No development org is registered/.test(dash.body)"
  devorgs_pipeline pipeline-3 "$LOGS/list-remove.json" "{ \"devOrgs\": { \"$DEV_ID\": null } }"
fi

# ------------------------------------------------------------------ report
if step report; then
  {
    echo "# Development orgs list end to end - $RUN"
    echo
    echo "- Provider: $PROVIDER, repository: $REPO"
    echo "- sfdx-hardis branch: $SFDX_HARDIS_BRANCH ($(git -C "$ROOT" rev-parse --short HEAD))"
    echo "- Major org: $MAJOR_ORG, dev org: $DEV_ORG ($DEV_ID)"
    echo "- Pull Requests: story #${PR1:-?}, vehicle #${PR_V:-?}"
    echo
    echo "| Check | Result | Detail |"
    echo "|-------|--------|--------|"
    node -e "
const rows=require('fs').readFileSync(process.argv[1],'utf8').trim().split('\n').map((l)=>l.split('\t'));
const last=new Map();for(const r of rows){last.set(r[0],r)}
for(const r of last.values()){console.log('| '+r[0]+' | '+r[1]+' | '+(r[2]||'').replace(/\|/g,'/')+' |')}" "$(native "$RESULTS")"
  } >"$LOGS/report.md"
  echo "Report: $LOGS/report.md"
  # The last result of each check, as in the report: a replayed check replaces its failure
  grep -E '^\| [A-Z0-9-]+ \| FAIL \|' "$LOGS/report.md" || echo "No FAIL in the report"
fi
