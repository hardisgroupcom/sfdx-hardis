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
