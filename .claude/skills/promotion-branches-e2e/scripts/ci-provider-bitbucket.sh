#!/usr/bin/env bash
# Bitbucket Pipelines side of the real CI section (runbook section 6quinquies). Sourced by
# ci-workflows-run.sh when PROVIDER=bitbucket; do not run it on its own. The functions it defines are
# listed in ci-provider-github.sh.
#
# A private repository is created in the workspace, with the bitbucket-pipelines.yml of
# ci-workflows-prepare.cjs --provider bitbucket (checked as YAML and against the public schema before
# anything is created). The major branches are pushed while Pipelines is still off, then Pipelines is
# turned on through the API and the repository variables are set: SFDX_AUTH_URL_<BRANCH> (secured),
# CI_SFDX_HARDIS_BITBUCKET_TOKEN (secured) and CI_SFDX_HARDIS_BITBUCKET_EMAIL, the token of the person
# running the test, so the comments of the jobs are theirs and W2 can tick them.
#
# BUILD MINUTES. The free plan gives the workspace 50 build minutes a month, less than one run. The
# run uses real Bitbucket Pipelines while there are minutes, and when a pipeline cannot run because
# they are used up, every remaining job runs through the job simulator of e2e-lib-bitbucket.sh
# (bb_check, bb_deploy) on the same Pull Request, with the same assertions, and the run goes on.
# Used up means one of:
#   - a pipeline stays paused (state IN_PROGRESS or PENDING, stage PAUSED or HALTED) for
#     BB_CI_PAUSE_SECONDS: the pipeline file of this test has no deployment environment and no
#     manual step, so nothing else pauses it. Bitbucket shows "This pipeline was paused because
#     you've reached your monthly minutes quota" and never resumes it on its own;
#   - a pipeline ends with result ERROR and a message about minutes or quota;
#   - the API refuses to start a pipeline (POST /pipelines/) with a message about minutes or quota.
# Then the paused pipeline is stopped, Pipelines is turned off (no new paused pipeline on each later
# push), $LOGS/bb-minutes-gone holds the reason, and each job writes "real CI" or
# "simulated (build minutes used up)" in $LOGS/<label>.mode, $LOGS/ci-jobs.tsv and the result lines.
#
# Read from the environment, else from .env (env-lib.sh); nothing prints a token:
#
#   BB_WORKSPACE             workspace slug
#   BB_PROJECT_KEY           key of the project the repository is created in
#   ATLASSIAN_TOKEN / ATLASSIAN_EMAIL   Atlassian API token with Bitbucket scopes (repository read,
#                            write, admin; pull request read, write; pipeline read, write, variable)
#                            and its account email; BB_TOKEN / BB_EMAIL override them
#   BB_REPO                  optional: default sfdx-hardis-promo-e2e-ci-bb-<n>, <n> one more than the
#                            highest one of the workspace
#   BB_CI_SIMULATE_ONLY=1    no real pipeline at all (the minutes are known to be gone): every job is
#                            simulated, the CI files are still checked and pushed
#   BB_CI_PAUSE_SECONDS      a pause longer than this means the minutes are used up (default 90)
#   CI_WAIT_APPEAR_SECONDS   a pipeline to appear (default 600); after CI_WAIT_REQUEUE_SECONDS
#                            (default 240) without one, the pull request pipeline is started through
#                            the API (a draft, for instance)
#   CI_WAIT_QUEUE_SECONDS / CI_WAIT_JOB_SECONDS   a pipeline to start (1800) and to end (3600)

# shellcheck disable=SC2034 # read by ci-workflows-run.sh
CI_DRAFT_DESC="a Bitbucket draft (draft flag of the API, no \"draft\" in the title) is not stopped, only warned"
CI_SAFE_DIRECTORY_FILES=""
CI_SAFE_DIRECTORY_HINT=""
CI_SAFE_DIRECTORY_SKIP="GitHub only: the Bitbucket template has no safe.directory line, the runner owns its clone"
# The jobs only real CI proves (gate, checkbox, deployment after a merge) come first, while minutes last
CI_DRAFT_LATE=yes
BB_SIMULATED="simulated (build minutes used up)"

_bbci_json() {
  node -e "let s='';process.stdin.setEncoding('utf8').on('data',c=>s+=c).on('end',()=>{let d;try{d=JSON.parse(s)}catch(e){console.log('');return}const v=($1);console.log(v===undefined||v===null?'':v)})"
}

_bbci_path() { e2e_native_path "$1"; }

# Usage: _bbci_call <method> <url> <body out file> [curl args...]   (prints the HTTP code)
_bbci_call() {
  local method="$1" url="$2" out="$3"
  shift 3
  bb_api "$method" "$url" -o "$out" -w '%{http_code}' "$@"
}

ci_provider_init() {
  : "${BB_WORKSPACE:?set BB_WORKSPACE (environment or .env) to the workspace slug}"
  : "${BB_PROJECT_KEY:?set BB_PROJECT_KEY (environment or .env) to the project key}"
  BB_CI_PAUSE_SECONDS="${BB_CI_PAUSE_SECONDS:-90}"
  CI_WAIT_APPEAR_SECONDS="${CI_WAIT_APPEAR_SECONDS:-600}"
  CI_WAIT_REQUEUE_SECONDS="${CI_WAIT_REQUEUE_SECONDS:-240}"
  CI_WAIT_QUEUE_SECONDS="${CI_WAIT_QUEUE_SECONDS:-1800}"
  CI_WAIT_JOB_SECONDS="${CI_WAIT_JOB_SECONDS:-3600}"
  BB_REPO="${BB_REPO:-pending}"
  export BB_REPO
  # bb_api and the job simulators; nothing is called while sourcing
  # shellcheck source=/dev/null
  source "$SCRIPTS_DIR/e2e-lib-bitbucket.sh" || return 1
  local code
  code=$(_bbci_call GET "https://api.bitbucket.org/2.0/workspaces/$BB_WORKSPACE/projects/$BB_PROJECT_KEY" "$LOGS/.bb-project.json")
  rm -f "$LOGS/.bb-project.json"
  if [ "$code" != "200" ]; then
    echo "project $BB_PROJECT_KEY of workspace $BB_WORKSPACE answered HTTP $code: check the token and the names" >&2
    return 1
  fi
  if [ "$BB_REPO" = "pending" ]; then
    local highest
    highest=$(bb_api GET "https://api.bitbucket.org/2.0/repositories/$BB_WORKSPACE?pagelen=100&q=name~%22sfdx-hardis-promo-e2e-ci-bb-%22" |
      _bbci_json "Math.max(0,...(d.values||[]).map(r=>(r.slug.match(/^sfdx-hardis-promo-e2e-ci-bb-(\\d+)\$/)||[])[1]).filter(Boolean).map(Number))")
    BB_REPO="sfdx-hardis-promo-e2e-ci-bb-$((highest + 1))"
  fi
  export BB_REPO
  BB_API="https://api.bitbucket.org/2.0/repositories/$BB_WORKSPACE/$BB_REPO"
  if [ "${BB_CI_SIMULATE_ONLY:-}" = "1" ]; then
    echo "BB_CI_SIMULATE_ONLY=1: no real pipeline" >"$LOGS/bb-minutes-gone"
  else
    rm -f "$LOGS/bb-minutes-gone"
  fi
  echo "Bitbucket repository to create: $BB_WORKSPACE/$BB_REPO (project $BB_PROJECT_KEY)"
}

ci_create_remote() {
  local auth_url="$1" b answer code user
  answer=$(bb_api POST "$BB_API" -d "{\"scm\":\"git\",\"is_private\":true,\"project\":{\"key\":\"$BB_PROJECT_KEY\"}}")
  if [ -z "$(printf '%s' "$answer" | _bbci_json 'd.full_name')" ]; then
    echo "repository creation failed: $(printf '%s' "$answer" | head -c 300)"
    return 1
  fi
  echo "[$(date +%T)] repository $BB_WORKSPACE/$BB_REPO created"
  # The token in an http.extraHeader of this clone only: the remote URL stays clean, which the
  # extension and check-pipeline.cjs read
  user="${BB_GIT_USER:-}"
  if [ -z "$user" ]; then
    if [ -n "$BB_EMAIL" ]; then user=x-bitbucket-api-token-auth; else user=x-token-auth; fi
  fi
  git remote add origin "https://bitbucket.org/$BB_WORKSPACE/$BB_REPO.git"
  git config --local "http.https://bitbucket.org/.extraHeader" "Authorization: Basic $(printf '%s:%s' "$user" "$BB_TOKEN" | base64 | tr -d '\n')"
  # Pipelines is off on a new repository: these pushes run nothing
  git push -q -u origin main || return 1
  git branch preprod && git branch uat && git branch integration
  git push -q origin preprod uat integration || return 1

  if [ -f "$LOGS/bb-minutes-gone" ]; then
    echo "[$(date +%T)] Pipelines left off: $(cat "$LOGS/bb-minutes-gone")"
  else
    code=$(_bbci_call PUT "$BB_API/pipelines_config" "$LOGS/.bb-config.json" -d '{"enabled":true}')
    if [ "$code" != "200" ] || [ "$(_bbci_json 'd.enabled===true?"yes":""' <"$LOGS/.bb-config.json")" != "yes" ]; then
      echo "Pipelines could not be turned on (HTTP $code): $(head -c 300 "$LOGS/.bb-config.json")"
      rm -f "$LOGS/.bb-config.json"
      return 1
    fi
    rm -f "$LOGS/.bb-config.json"
    echo "[$(date +%T)] Pipelines turned on"
  fi
  for b in INTEGRATION UAT PREPROD MAIN; do
    _bbci_set_variable "SFDX_AUTH_URL_$b" "$auth_url" true || return 1
  done
  _bbci_set_variable CI_SFDX_HARDIS_BITBUCKET_TOKEN "$BB_TOKEN" true || return 1
  if [ -n "$BB_EMAIL" ]; then
    _bbci_set_variable CI_SFDX_HARDIS_BITBUCKET_EMAIL "$BB_EMAIL" true || return 1
  fi
  printf 'export BB_WORKSPACE="%s" BB_REPO="%s"\n' "$BB_WORKSPACE" "$BB_REPO" >>"$LOGS/ci-vars.sh"
}

# Usage: _bbci_set_variable <key> <value> <secured true|false>   (the value never reaches the command line)
_bbci_set_variable() {
  local file code
  file="$(_bbci_path "$LOGS")/.bb-variable.json"
  VALUE="$2" node -e "require('fs').writeFileSync(process.argv[1],JSON.stringify({key:process.argv[2],value:process.env.VALUE,secured:process.argv[3]==='true'}))" "$file" "$1" "$3"
  code=$(_bbci_call POST "$BB_API/pipelines_config/variables/" "$file.answer" --data-binary "@$file")
  rm -f "$file"
  if [ "$code" != "201" ] && [ "$code" != "200" ]; then
    echo "variable $1 not created: HTTP $code $(head -c 300 "$file.answer")"
    rm -f "$file.answer"
    return 1
  fi
  rm -f "$file.answer"
}

ci_open_draft() {
  local file
  file="$(_bbci_path "$LOGS")/.bb-draft.json"
  node -e '
const fs = require("fs");
const [source, target, title, body, out] = process.argv.slice(1);
fs.writeFileSync(out, JSON.stringify({ title, description: fs.readFileSync(body, "utf8"), draft: true, close_source_branch: false,
  source: { branch: { name: source } }, destination: { branch: { name: target } } }));' "$1" "$2" "$3" "$(_bbci_path "$4")" "$file"
  bb_api POST "$BB_API/pullrequests" --data-binary "@$file" | _bbci_json 'd.id'
  rm -f "$file"
}

ci_is_draft() { [ "$(bb_api GET "$BB_API/pullrequests/$1" | _bbci_json 'd.draft===true?"yes":""')" = "yes" ]; }

# The validation: the pull request pipeline of that head commit, or the simulator once minutes are gone
ci_wait_check() {
  local pr="$1" sha="$2" label="$3"
  echo "$pr" >"$LOGS/$label.pr"
  echo "$sha" >"$LOGS/$label.sha"
  _bbci_wait_pipeline check "$pr" "$sha" "$label" ""
}

# The deployment: the branch pipeline of the merge commit, or the simulator once minutes are gone
ci_wait_deploy() {
  echo "$1" >"$LOGS/$3.branch"
  _bbci_wait_pipeline deploy "$1" "$2" "$3" ""
}

# Start the pull request pipeline again (the Rerun button), then wait for it
ci_rerun() {
  local label="$1" from="$2" pr sha uuid
  pr=$(cat "$LOGS/$from.pr" 2>/dev/null)
  sha=$(cat "$LOGS/$from.sha" 2>/dev/null)
  echo "$pr" >"$LOGS/$label.pr"
  echo "$sha" >"$LOGS/$label.sha"
  if [ -f "$LOGS/bb-minutes-gone" ]; then
    _bbci_simulate check "$pr" "$label"
    return
  fi
  uuid=$(_bbci_trigger_pr_pipeline "$pr" "$sha") || {
    [ -f "$LOGS/bb-minutes-gone" ] && {
      _bbci_simulate check "$pr" "$label"
      return
    }
    echo "the pipeline of PR $pr could not be started again" >"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
    return 1
  }
  _bbci_wait_pipeline check "$pr" "$sha" "$label" "$uuid"
}

# Tick, in every comment of a Pull Request, the checkbox of a manual action for an org branch. The
# comments of the jobs are written with the token of the person running the test, who can edit them
ci_tick_manual_checkbox() {
  local pr="$1" action="$2" org="$3" ids cid file
  ids=$(bb_api GET "$BB_API/pullrequests/$pr/comments?pagelen=100" |
    _bbci_json "(d.values||[]).filter(c=>!c.deleted&&((c.content||{}).raw||'').includes('sfdx-hardis-manual-action id:$action org:$org')).map(c=>c.id).join(' ')")
  for cid in $ids; do
    file="$LOGS/comment-$cid.md"
    bb_api GET "$BB_API/pullrequests/$pr/comments/$cid" |
      node -e "let s='';process.stdin.setEncoding('utf8').on('data',c=>s+=c).on('end',()=>require('fs').writeFileSync(process.argv[1],(JSON.parse(s).content||{}).raw||''))" "$(_bbci_path "$file")"
    ci_tick_in_file "$file" "$action" "$org" raw
    node -e "const fs=require('fs');const f=process.argv[1];fs.writeFileSync(f,JSON.stringify({content:JSON.parse(fs.readFileSync(f,'utf8'))}))" "$(_bbci_path "$file.json")"
    bb_api PUT "$BB_API/pullrequests/$pr/comments/$cid" --data-binary "@$(_bbci_path "$file.json")" >/dev/null && echo "ticked in comment $cid"
  done
}

ci_pr_comments() {
  bb_api GET "$BB_API/pullrequests/$1/comments?pagelen=100" |
    _bbci_json "(d.values||[]).filter(c=>!c.deleted).map(c=>(c.content||{}).raw||'').join('\n')" >"$LOGS/$2.log" 2>&1
}

# The API answers 12 character hashes: the full one comes from the commit endpoint
_bbci_full_sha() {
  [ -n "$1" ] || return 0
  bb_api GET "$BB_API/commit/$1" | _bbci_json 'd.hash'
}

ci_merge_sha() {
  local short=""
  for _ in $(seq 1 30); do
    short=$(bb_api GET "$BB_API/pullrequests/$1" | _bbci_json "d.state==='MERGED'&&d.merge_commit?d.merge_commit.hash:''")
    [ -n "$short" ] && break
    sleep 2
  done
  _bbci_full_sha "$short"
}

ci_pr_head_sha() { _bbci_full_sha "$(bb_api GET "$BB_API/pullrequests/$1" | _bbci_json 'd.source&&d.source.commit&&d.source.commit.hash')"; }

# Start the pull request pipeline of a Pull Request through the API. Prints its uuid; a refusal for
# minutes marks them as gone.
_bbci_trigger_pr_pipeline() {
  local pr="$1" sha="$2" source target target_sha file code
  source=$(bb_pr_field "$pr" "d['source']['branch']['name']")
  target=$(bb_pr_field "$pr" "d['destination']['branch']['name']")
  target_sha=$(git -C "$WORK" ls-remote origin "refs/heads/$target" | cut -f1)
  file="$(_bbci_path "$LOGS")/.bb-trigger.json"
  code=$(_bbci_call POST "$BB_API/pipelines/" "$file" -d "{\"target\":{\"type\":\"pipeline_pullrequest_target\",\"source\":\"$source\",\"destination\":\"$target\",
    \"destination_commit\":{\"hash\":\"$target_sha\"},\"commit\":{\"type\":\"commit\",\"hash\":\"$sha\"},
    \"pullrequest\":{\"id\":\"$pr\"},\"selector\":{\"type\":\"pull-requests\",\"pattern\":\"**\"}}}")
  if [ "$code" = "201" ] || [ "$code" = "200" ]; then
    _bbci_json 'd.uuid' <"$file"
    rm -f "$file"
    return 0
  fi
  if grep -qiE "minute|quota" "$file"; then
    _bbci_minutes_gone "" "starting a pipeline answered HTTP $code: $(_bbci_json '(d.error&&d.error.message)||""' <"$file")"
  else
    echo "[$(date +%T)] starting the pipeline of PR $pr answered HTTP $code: $(head -c 300 "$file")"
  fi
  rm -f "$file"
  return 1
}

# The newest pipeline of a Pull Request head or of a branch commit. Prints its uuid.
_bbci_find_pipeline() {
  local kind="$1" key="$2" sha="$3"
  bb_api GET "$BB_API/pipelines/?sort=-created_on&pagelen=50" | KIND="$kind" KEY="$key" SHA="$sha" _bbci_json "(()=>{const e=process.env;
    const same=h=>!!h&&(h.startsWith(e.SHA)||e.SHA.startsWith(h));
    const p=(d.values||[]).find(p=>{const t=p.target||{};return e.KIND==='check'
      ?t.type==='pipeline_pullrequest_target'&&String((t.pullrequest||{}).id)===e.KEY&&same((t.commit||{}).hash)
      :t.type==='pipeline_ref_target'&&t.ref_name===e.KEY&&same((t.commit||{}).hash)});return p?p.uuid:''})()"
}

# A pull request pipeline for another head of the same Pull Request only burns minutes: stop it
_bbci_stop_superseded() {
  local pr="$1" sha="$2" uuids uuid
  uuids=$(bb_api GET "$BB_API/pipelines/?sort=-created_on&pagelen=50" | PR="$pr" SHA="$sha" _bbci_json "(d.values||[]).filter(p=>{const t=p.target||{};const h=(t.commit||{}).hash||'';
    return t.type==='pipeline_pullrequest_target'&&String((t.pullrequest||{}).id)===process.env.PR&&h&&!h.startsWith(process.env.SHA)&&!process.env.SHA.startsWith(h)&&(p.state||{}).name!=='COMPLETED'}).map(p=>p.uuid).join(' ')")
  for uuid in $uuids; do
    bb_api POST "$BB_API/pipelines/$uuid/stopPipeline" >/dev/null
    echo "[$(date +%T)] pipeline $uuid of PR $pr stopped: it validates a previous head"
  done
}

# state|stage|result|message of a pipeline
_bbci_state() {
  bb_api GET "$BB_API/pipelines/$1" | _bbci_json "[(d.state||{}).name||'',((d.state||{}).stage||{}).name||'',((d.state||{}).result||{}).name||'',(((d.state||{}).result||{}).error||{}).message||''].join('|')"
}

# Wait for a pipeline to appear, start and end; fall back to the simulator when the minutes are gone.
# Usage: _bbci_wait_pipeline <check|deploy> <pr id|branch> <sha> <label> [uuid of a pipeline already started]
_bbci_wait_pipeline() {
  local kind="$1" key="$2" sha="$3" label="$4" uuid="${5:-}" waited=0 triggered="" state stage result message paused_since=""
  if [ -f "$LOGS/bb-minutes-gone" ]; then
    _bbci_simulate "$kind" "$key" "$label"
    return
  fi
  while [ -z "$uuid" ] && [ "$waited" -lt "$CI_WAIT_APPEAR_SECONDS" ]; do
    [ "$kind" = "check" ] && _bbci_stop_superseded "$key" "$sha"
    uuid=$(_bbci_find_pipeline "$kind" "$key" "$sha")
    [ -n "$uuid" ] && break
    if [ "$kind" = "check" ] && [ -z "$triggered" ] && [ "$waited" -ge "$CI_WAIT_REQUEUE_SECONDS" ]; then
      triggered=yes
      uuid=$(_bbci_trigger_pr_pipeline "$key" "$sha") || uuid=""
      if [ -f "$LOGS/bb-minutes-gone" ]; then
        _bbci_simulate "$kind" "$key" "$label"
        return
      fi
      [ -n "$uuid" ] && break
    fi
    sleep 15
    waited=$((waited + 15))
  done
  if [ -z "$uuid" ]; then
    echo "no $kind pipeline for $key at $sha after ${CI_WAIT_APPEAR_SECONDS}s" >"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
    echo "[$(date +%T)] $label: no pipeline"
    return 1
  fi
  echo "$uuid" >"$LOGS/$label.pipeline"
  waited=0
  while [ "$waited" -lt $((CI_WAIT_QUEUE_SECONDS + CI_WAIT_JOB_SECONDS)) ]; do
    IFS='|' read -r state stage result message <<<"$(_bbci_state "$uuid")"
    [ "$state" = "COMPLETED" ] && break
    if [ "$stage" = "PAUSED" ] || [ "$stage" = "HALTED" ]; then
      paused_since="${paused_since:-$waited}"
      if [ $((waited - paused_since)) -ge "$BB_CI_PAUSE_SECONDS" ]; then
        _bbci_minutes_gone "$uuid" "pipeline $uuid ${state}/${stage} for ${BB_CI_PAUSE_SECONDS}s${message:+: $message}"
        _bbci_simulate "$kind" "$key" "$label"
        return
      fi
    else
      paused_since=""
    fi
    sleep 15
    waited=$((waited + 15))
  done
  if [ "$state" = "COMPLETED" ] && [ "$result" = "ERROR" ] && printf '%s' "$message" | grep -qiE "minute|quota"; then
    _bbci_minutes_gone "" "pipeline $uuid ended in ERROR: $message"
    _bbci_simulate "$kind" "$key" "$label"
    return
  fi
  _bbci_finish_pipeline "$uuid" "$label" "$state" "$result"
}

# The log of every step without colors, the exit code and the timings (queue apart from run)
_bbci_finish_pipeline() {
  local uuid="$1" label="$2" state="$3" result="$4" pipeline queue run minutes steps step
  echo "real CI" >"$LOGS/$label.mode"
  pipeline=$(bb_api GET "$BB_API/pipelines/$uuid")
  steps=$(bb_api GET "$BB_API/pipelines/$uuid/steps/?pagelen=100")
  queue=$(printf '%s' "$pipeline" | STEPS="$steps" _bbci_json "(()=>{const s=JSON.parse(process.env.STEPS).values||[];const st=s.map(x=>Date.parse(x.started_on)).filter(n=>!isNaN(n));return st.length?Math.round((Math.min(...st)-Date.parse(d.created_on))/1000):''})()")
  run=$(printf '%s' "$pipeline" | STEPS="$steps" _bbci_json "(()=>{const s=JSON.parse(process.env.STEPS).values||[];const st=s.map(x=>Date.parse(x.started_on)).filter(n=>!isNaN(n));return st.length&&d.completed_on?Math.round((Date.parse(d.completed_on)-Math.min(...st))/1000):''})()")
  minutes=$(printf '%s' "$pipeline" | _bbci_json 'd.build_seconds_used!==undefined?Math.ceil(d.build_seconds_used/60):""')
  : >"$LOGS/$label.log"
  for step in $(printf '%s' "$steps" | _bbci_json '(d.values||[]).map(s=>s.uuid).join(" ")'); do
    bb_api GET "$BB_API/pipelines/$uuid/steps/$step/log" -L | sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r//g' >>"$LOGS/$label.log"
  done
  case "$state:$result" in
  COMPLETED:SUCCESSFUL) echo 0 >"$LOGS/$label.code" ;;
  COMPLETED:*) echo 1 >"$LOGS/$label.code" ;;
  *)
    printf '\nE2E: pipeline %s still %s (CI_WAIT_QUEUE_SECONDS + CI_WAIT_JOB_SECONDS)\n' "$uuid" "${state:-unknown}" >>"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
    ;;
  esac
  printf '%s\tbitbucket\treal CI\t%s\t%s\t%s\t%s\t%s\n' "$label" "$uuid" "${result:-$state}" "${queue:-}" "${run:-}" "${minutes:-}" >>"$LOGS/ci-jobs.tsv"
  echo "[$(date +%T)] $label: pipeline $uuid ${result:-$state} (queued ${queue:-?}s, ran ${run:-?}s, ${minutes:-?} build minutes)"
}

# The minutes are gone: stop the paused pipeline, turn Pipelines off, remember why
# Usage: _bbci_minutes_gone <uuid or empty> <reason>
_bbci_minutes_gone() {
  [ -n "$1" ] && bb_api POST "$BB_API/pipelines/$1/stopPipeline" >/dev/null
  bb_api PUT "$BB_API/pipelines_config" -d '{"enabled":false}' >/dev/null
  echo "$2" >"$LOGS/bb-minutes-gone"
  echo "[$(date +%T)] BUILD MINUTES USED UP ($2): Pipelines turned off, every remaining job runs through the simulator"
}

# The job simulator of e2e-lib-bitbucket.sh on the same Pull Request or branch, same log and code files
# Usage: _bbci_simulate <check|deploy> <pr id|branch> <label>
_bbci_simulate() {
  local kind="$1" key="$2" label="$3" target code
  if [ "$kind" = "check" ]; then
    target=$(bb_pr_field "$key" "d['destination']['branch']['name']")
    bb_check "$key" "$target" "$label" >"$LOGS/$label.sim" 2>&1
    code=$?
  else
    bb_deploy "$key" "$label" >"$LOGS/$label.sim" 2>&1
    code=$?
  fi
  [ "$code" -gt 1 ] && code=1
  echo "$code" >"$LOGS/$label.code"
  echo "$BB_SIMULATED" >"$LOGS/$label.mode"
  printf '%s\tbitbucket\t%s\t-\texit %s\t\t\t\n' "$label" "$BB_SIMULATED" "$code" >>"$LOGS/ci-jobs.tsv"
  echo "[$(date +%T)] $label: $BB_SIMULATED, exit $code"
}
