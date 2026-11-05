#!/usr/bin/env bash
# GitHub Actions side of the real CI section (runbook section 6quinquies). Sourced by
# ci-workflows-run.sh when PROVIDER=github; do not run it on its own.
#
# Every ci-provider-<provider>.sh defines the same functions, so ci-workflows-run.sh never tests
# PROVIDER itself:
#
#   ci_provider_init                       checks the variables of the provider, before anything is built
#   ci_create_remote <auth url>            creates the repository, pushes main and the major branches
#                                          WITHOUT running CI, stores the logins, turns CI on; appends
#                                          the ids a later shell needs to $LOGS/ci-vars.sh
#   ci_open_draft <branch> <target> <title> <body file>   opens a draft, prints its number
#   ci_is_draft <number>                   exit 0 when the provider flags it as a draft
#   ci_wait_check <number> <head sha> <label>   waits for the validation job of that head
#   ci_wait_deploy <branch> <merge sha> <label> waits for the deployment job of that commit
#   ci_rerun <label> <label of the run to re-run>  runs the same validation job again, waits
#   ci_tick_manual_checkbox <number> <action id> <org branch>
#   ci_pr_comments <number> <label>        the comment bodies into $LOGS/<label>.log
#   ci_merge_sha <number>                  the merge commit of a merged Pull Request
#   ci_pr_head_sha <number>                the head commit the provider knows
#   ci_pr_comments_ids <number> <label>    the comments as a JSON array of {id, body}, sorted by
#                                          id, into $LOGS/<label>.json (two reads compare with cmp)
#
# The major branch deployment check (sf hardis:project:deploy:smart --check --major-branch-check,
# scenario major-branch-check):
#   ci_prepare_major_branch_check <auth url>   checks the check job is in the repository, and
#                                          creates what the provider needs to run it (Azure: the
#                                          pipeline definition); after ci_create_remote
#   start_major_branch_check <branch> [<label>]   starts the check of a major branch the way its
#                                          schedule would (label default mbc-<branch>); writes
#                                          $LOGS/<label>.start (ISO time) and <label>.trigger (how)
#   ci_major_branch_check_state <branch> [<label>]   prints pending, running or done
#   ci_wait_major_branch_check <branch> [<label>]    waits for the check job of that branch: same
#                                          .log, .code, .mode and ci-jobs.tsv line as the waits above
#   CI_MAJOR_BRANCH_CHECK_ALL              yes when one start checks every major branch (GitHub:
#                                          the matrix of the workflow), empty when it checks one
#
# and these variables:
#   CI_DRAFT_DESC                 what W3 proves on this provider
#   CI_SAFE_DIRECTORY_FILES       CI files W8 removes the safe.directory line from (empty: W8 skipped)
#   CI_SAFE_DIRECTORY_HINT        the pattern of the line the job must name
#   CI_SAFE_DIRECTORY_SKIP        why W8 is skipped, when it is
#   CI_DRAFT_LATE                 yes: W3 (the draft) runs after W4, for a provider short of minutes
#
# The wait functions write $LOGS/<label>.log (the job log), $LOGS/<label>.code (0 success, 1
# failure, 9 nothing to wait for), $LOGS/<label>.mode ("real CI", or "simulated (<why>)" when the
# provider ran the job simulator instead) and one line of $LOGS/ci-jobs.tsv (label, provider, mode,
# run id, result, seconds queued, seconds run).
#
#   REPO          owner/name of the repository to create; default <GH_E2E_OWNER or the gh login>/
#                 sfdx-hardis-promo-e2e-ci-<n>, <n> one more than the highest one of that owner

# shellcheck disable=SC2034 # read by ci-workflows-run.sh
CI_DRAFT_DESC="a GitHub draft (draft flag, no \"draft\" in the title) is not stopped, only warned"
CI_SAFE_DIRECTORY_FILES=".github/workflows/check-deploy.yml .github/workflows/process-deploy.yml"
CI_SAFE_DIRECTORY_HINT='git config --global --add safe.directory "[$]GITHUB_WORKSPACE"'
CI_SAFE_DIRECTORY_SKIP=""
# The workflow_dispatch run of check-major-branch-deploy.yml lists the major branches of the
# default branch and checks each of them in a matrix job
CI_MAJOR_BRANCH_CHECK_ALL=yes
GH_MAJOR_CHECK_WORKFLOW=check-major-branch-deploy.yml

ci_provider_init() {
  if [ -z "${REPO:-}" ]; then
    local owner highest
    owner="${GH_E2E_OWNER:-$(gh api user --jq .login 2>/dev/null)}"
    : "${owner:?set REPO, or GH_E2E_OWNER, or log in with gh auth login}"
    highest=$(gh repo list "$owner" --limit 1000 --json name --jq '[.[].name | capture("^sfdx-hardis-promo-e2e-ci-(?<n>[0-9]+)$").n | tonumber] | max // 0' 2>/dev/null)
    REPO="$owner/sfdx-hardis-promo-e2e-ci-$((${highest:-0} + 1))"
  fi
  export REPO
  echo "GitHub repository to create: $REPO"
}

ci_create_remote() {
  local auth_url="$1" b
  # Actions off while the major branches are pushed: no deployment of the base project
  gh repo create "$REPO" --private >>"$LOGS/build.log" 2>&1 || {
    echo "repo create failed"
    return 1
  }
  gh api -X PUT "repos/$REPO/actions/permissions" -F enabled=false >/dev/null
  git remote add origin "https://github.com/$REPO.git"
  git push -q -u origin main
  git branch preprod && git branch uat && git branch integration
  git push -q origin preprod uat integration
  for b in INTEGRATION UAT PREPROD MAIN; do
    printf '%s' "$auth_url" | gh secret set "SFDX_AUTH_URL_$b" -R "$REPO" >/dev/null
  done
  gh api -X PUT "repos/$REPO/actions/permissions" -F enabled=true -f allowed_actions=all >/dev/null
  printf 'export REPO="%s"\n' "$REPO" >>"$LOGS/ci-vars.sh"
}

ci_open_draft() {
  local number
  number=$(gh pr create -R "$REPO" --draft --base "$2" --head "$1" --title "$3" --body-file "$4" 2>>"$LOGS/p-open.err")
  echo "${number##*/}"
}

ci_is_draft() { [ "$(gh pr view "$1" -R "$REPO" --json isDraft --jq .isDraft)" = "true" ]; }

ci_wait_check() { _gh_wait_workflow check-deploy.yml "$2" "$3"; }
ci_wait_deploy() { _gh_wait_workflow process-deploy.yml "$2" "$3"; }

# Re-run every job of a completed run, the way "Re-run all jobs" does, and wait for it. A rerun keeps
# its run id
ci_rerun() {
  local label="$1" from="$2" id
  id=$(cat "$LOGS/$from.run")
  gh run rerun "$id" -R "$REPO" >/dev/null 2>&1 || {
    echo 9 >"$LOGS/$label.code"
    return 1
  }
  sleep 15
  echo "$id" >"$LOGS/$label.run"
  _gh_wait_run_id "$id" "$label"
}

# Tick, in every comment of a Pull Request, the checkbox of a manual action for an org branch
ci_tick_manual_checkbox() {
  local pr="$1" action="$2" org="$3" ids cid
  ids=$(gh api "repos/$REPO/issues/$pr/comments" --paginate --jq ".[] | select(.body | contains(\"sfdx-hardis-manual-action id:$action org:$org\")) | .id")
  for cid in $ids; do
    gh api "repos/$REPO/issues/comments/$cid" --jq .body >"$LOGS/comment-$cid.md"
    ci_tick_in_file "$LOGS/comment-$cid.md" "$action" "$org" body
    gh api -X PATCH "repos/$REPO/issues/comments/$cid" --input "$LOGS/comment-$cid.md.json" >/dev/null && echo "ticked in comment $cid"
  done
}

ci_pr_comments() { gh api "repos/$REPO/issues/$1/comments" --paginate --jq '.[].body' >"$LOGS/$2.log" 2>&1; }
ci_merge_sha() { gh pr view "$1" -R "$REPO" --json mergeCommit --jq .mergeCommit.oid; }
ci_pr_head_sha() { gh pr view "$1" -R "$REPO" --json headRefOid --jq .headRefOid; }

# One line per page (an array as a JSON string), merged and sorted by id
ci_pr_comments_ids() {
  gh api "repos/$REPO/issues/$1/comments" --paginate --jq '[.[] | {id, body}] | @json' 2>>"$LOGS/$2.err" |
    node -e "let s='';process.stdin.setEncoding('utf8').on('data',c=>s+=c).on('end',()=>{const a=s.split('\n').filter(Boolean).flatMap(l=>JSON.parse(l));a.sort((x,y)=>String(x.id).localeCompare(String(y.id),undefined,{numeric:true}));process.stdout.write(JSON.stringify(a,null,1))})" >"$LOGS/$2.json"
}

ci_prepare_major_branch_check() {
  if [ ! -f "$WORK/.github/workflows/$GH_MAJOR_CHECK_WORKFLOW" ]; then
    echo "no .github/workflows/$GH_MAJOR_CHECK_WORKFLOW in $WORK: the template was not written"
    return 1
  fi
}

# A workflow_dispatch of the check workflow on the default branch: its matrix checks every major
# branch, so a call within MBC_GH_REUSE_SECONDS (default 600) of the previous dispatch reuses that
# run instead of starting another one. The schedule of the workflow is not used: GitHub only runs
# it on the default branch, at its own time
start_major_branch_check() {
  local branch="$1" label="${2:-mbc-$1}" now last_epoch="" last_run="" id="" since default_branch
  now=$(date +%s)
  date -u +%Y-%m-%dT%H:%M:%SZ >"$LOGS/$label.start"
  [ -f "$LOGS/.gh-mbc-dispatch" ] && read -r last_epoch last_run <"$LOGS/.gh-mbc-dispatch"
  if [ -n "$last_run" ] && [ $((now - ${last_epoch:-0})) -lt "${MBC_GH_REUSE_SECONDS:-600}" ]; then
    echo "$last_run" >"$LOGS/$label.run"
    echo "workflow_dispatch run $last_run, started for an earlier branch: one run checks every major branch" >"$LOGS/$label.trigger"
    echo "[$(date +%T)] $label: run $last_run of the previous dispatch checks $branch too"
    return 0
  fi
  default_branch=$(gh repo view "$REPO" --json defaultBranchRef --jq .defaultBranchRef.name 2>/dev/null)
  since=$(date -u -d '-60 seconds' +%Y-%m-%dT%H:%M:%SZ)
  # A workflow pushed a moment ago can be unknown to the API for a while
  for _ in $(seq 1 10); do
    gh workflow run "$GH_MAJOR_CHECK_WORKFLOW" -R "$REPO" --ref "${default_branch:-main}" >>"$LOGS/$label.dispatch" 2>&1 && break
    sleep 6
  done
  for _ in $(seq 1 30); do
    id=$(gh run list -R "$REPO" --workflow "$GH_MAJOR_CHECK_WORKFLOW" --event workflow_dispatch -L 5 --json databaseId,createdAt \
      --jq "[.[] | select(.createdAt >= \"$since\")][0].databaseId // empty" 2>/dev/null)
    [ -n "$id" ] && break
    sleep 10
  done
  if [ -z "$id" ]; then
    echo "no workflow_dispatch run of $GH_MAJOR_CHECK_WORKFLOW appeared (see $label.dispatch)" >"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
    return 1
  fi
  echo "$id" >"$LOGS/$label.run"
  echo "$now $id" >"$LOGS/.gh-mbc-dispatch"
  echo "workflow_dispatch run $id on ${default_branch:-main} (its matrix checks every major branch)" >"$LOGS/$label.trigger"
  echo "[$(date +%T)] $label: workflow_dispatch run $id"
}

ci_major_branch_check_state() {
  local branch="$1" label="${2:-mbc-$1}" run status=""
  run=$(cat "$LOGS/$label.run" 2>/dev/null)
  [ -n "$run" ] || return 0
  read -r _ status _ <<<"$(_gh_mbc_job "$run" "$branch")"
  # no matrix job yet: the job that lists the branches runs, the run is what a user sees
  [ -n "$status" ] || status=$(gh run view "$run" -R "$REPO" --json status --jq .status 2>/dev/null)
  case "$status" in
  completed) echo "done" ;;
  in_progress) echo running ;;
  queued | waiting | requested | pending) echo pending ;;
  esac
}

ci_wait_major_branch_check() {
  local branch="$1" label="${2:-mbc-$1}" run job="" status="" conclusion="" waited=0 queue run_s
  run=$(cat "$LOGS/$label.run" 2>/dev/null)
  if [ -z "$run" ]; then
    echo "no run started for the check of $branch" >"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
    return 1
  fi
  while [ "$waited" -lt "${CI_WAIT_JOB_SECONDS:-3600}" ]; do
    read -r job status conclusion <<<"$(_gh_mbc_job "$run" "$branch")"
    [ "$status" = "completed" ] && break
    # the run ended with no job for this branch: no config file of it on the default branch
    if [ -z "$job" ] && [ "$(gh run view "$run" -R "$REPO" --json status --jq .status 2>/dev/null)" = "completed" ]; then
      break
    fi
    sleep 20
    waited=$((waited + 20))
  done
  if [ -z "$job" ]; then
    echo "run $run has no \"Check Major Branch Deployment ($branch)\" job" >"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
    echo "[$(date +%T)] $label: no job for $branch in run $run"
    return 1
  fi
  echo "$job" >"$LOGS/$label.job"
  gh run view -R "$REPO" --job "$job" --log 2>&1 | sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r//g' >"$LOGS/$label.log"
  if [ "$status" != "completed" ]; then
    printf '\nE2E: job %s still %s after %ss (CI_WAIT_JOB_SECONDS)\n' "$job" "${status:-unknown}" "${CI_WAIT_JOB_SECONDS:-3600}" >>"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
  elif [ "$conclusion" = "success" ]; then
    echo 0 >"$LOGS/$label.code"
  else
    echo 1 >"$LOGS/$label.code"
  fi
  echo "real CI" >"$LOGS/$label.mode"
  read -r queue run_s <<<"$(gh api "repos/$REPO/actions/jobs/$job" \
    --jq '[((.started_at|fromdate)-(.created_at|fromdate)),((.completed_at|fromdate)-(.started_at|fromdate))]|map(tostring)|join(" ")' 2>/dev/null)"
  printf '%s\tgithub\treal CI\t%s\t%s\t%s\t%s\t\n' "$label" "$job" "${conclusion:-$status}" "${queue:-}" "${run_s:-}" >>"$LOGS/ci-jobs.tsv"
  echo "[$(date +%T)] $label: job $job ${conclusion:-$status} (queued ${queue:-?}s, ran ${run_s:-?}s)"
}

# The latest run of a workflow for a commit, waited for until it completes. A pull_request run is
# listed under the head commit of the Pull Request, a push run under the merge commit
_gh_wait_workflow() {
  local wf="$1" sha="$2" label="$3" id=""
  for _ in $(seq 1 60); do
    id=$(gh run list -R "$REPO" --workflow "$wf" --commit "$sha" -L 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)
    [ -n "$id" ] && break
    sleep 10
  done
  if [ -z "$id" ]; then
    echo "no $wf run for $sha" >"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
    return 1
  fi
  echo "$id" >"$LOGS/$label.run"
  _gh_wait_run_id "$id" "$label"
}

_gh_wait_run_id() {
  local id="$1" label="$2" status conclusion
  for _ in $(seq 1 180); do
    status=$(gh run view "$id" -R "$REPO" --json status --jq .status 2>/dev/null)
    [ "$status" = "completed" ] && break
    sleep 20
  done
  conclusion=$(gh run view "$id" -R "$REPO" --json conclusion --jq .conclusion 2>/dev/null)
  # the latest attempt of the run
  gh run view "$id" -R "$REPO" --log >"$LOGS/$label.log" 2>&1
  if [ "$conclusion" = "success" ]; then echo 0 >"$LOGS/$label.code"; else echo 1 >"$LOGS/$label.code"; fi
  echo "real CI" >"$LOGS/$label.mode"
  # created to started is the queue, started to updated the run (of the latest attempt)
  local queue run
  read -r queue run <<<"$(gh run view "$id" -R "$REPO" --json createdAt,startedAt,updatedAt \
    --jq '[((.startedAt|fromdate)-(.createdAt|fromdate)),((.updatedAt|fromdate)-(.startedAt|fromdate))]|map(tostring)|join(" ")' 2>/dev/null)"
  printf '%s\tgithub\treal CI\t%s\t%s\t%s\t%s\t\n' "$label" "$id" "$conclusion" "${queue:-}" "${run:-}" >>"$LOGS/ci-jobs.tsv"
  echo "[$(date +%T)] $label: run $id $conclusion (queued ${queue:-?}s, ran ${run:-?}s)"
}

# "id status conclusion" of the matrix job of a branch in a check run: the job is named
# "Check Major Branch Deployment (<branch>)", the name the extension looks for
_gh_mbc_job() {
  gh api "repos/$REPO/actions/runs/$1/jobs?per_page=100" \
    --jq ".jobs[] | select(.name | endswith(\"($2)\")) | \"\(.id) \(.status) \(.conclusion // \"\")\"" 2>/dev/null | head -1
}
