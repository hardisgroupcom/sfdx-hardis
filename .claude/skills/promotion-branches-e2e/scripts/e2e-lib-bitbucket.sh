#!/usr/bin/env bash
# Job simulators for the promotion branches end to end test, Bitbucket Cloud flavour. Source this
# file, do not execute it.
#
#   export ORG BB_WORKSPACE BB_REPO BB_EMAIL BB_TOKEN WORK LOGS DEV
#   source .claude/skills/promotion-branches-e2e/scripts/e2e-lib-bitbucket.sh
#
# sfdx-hardis picks Bitbucket when BITBUCKET_WORKSPACE or CI_SFDX_HARDIS_BITBUCKET_TOKEN is set,
# and reads the repository and the Pull Request from BITBUCKET_REPO_SLUG / BITBUCKET_PR_ID, so
# running the CLI locally with those variables reproduces a Bitbucket Pipelines job exactly.
#
#   ORG           target org username or alias
#   BB_WORKSPACE  workspace slug, e.g. test-sfdx-hardis-2
#   BB_REPO       repository slug of the throwaway test repository
#   BB_EMAIL      Atlassian account email, empty for a workspace/repository Access Token
#   BB_TOKEN      Atlassian API token with Bitbucket scopes, or a Bitbucket Access Token
#   WORK          local clone
#   LOGS          folder where each job log is written
#   DEV           path to bin/dev.js of the sfdx-hardis working copy under test
#
# Credentials: an Atlassian API token authenticates as Basic auth with the account email as the
# username, and it must be an API token WITH SCOPES covering Bitbucket (a classic Atlassian API
# token answers "API Token provided has no Bitbucket scopes"). A Bitbucket workspace or repository
# Access Token authenticates as a Bearer token instead: leave BB_EMAIL empty for that one.

: "${ORG:?set ORG to the target org}"
: "${BB_WORKSPACE:?set BB_WORKSPACE to the workspace slug}"
: "${BB_REPO:?set BB_REPO to the repository slug}"
: "${BB_TOKEN:?set BB_TOKEN to a Bitbucket capable token}"
: "${WORK:?set WORK to the local clone}"
: "${LOGS:?set LOGS to the log folder}"
: "${DEV:?set DEV to the path of bin/dev.js}"
BB_EMAIL="${BB_EMAIL:-}"

mkdir -p "$LOGS"

BB_API="https://api.bitbucket.org/2.0/repositories/$BB_WORKSPACE/$BB_REPO"

# The Bitbucket Cloud REST API. Basic auth with the account email for an Atlassian API token,
# Bearer for a workspace or repository Access Token.
# Usage: bb_api <method> <url> [curl args...]
bb_api() {
  local method="$1" url="$2"
  shift 2
  if [ -n "$BB_EMAIL" ]; then
    curl -sS -u "$BB_EMAIL:$BB_TOKEN" -X "$method" -H "Content-Type: application/json" "$url" "$@"
  else
    curl -sS -H "Authorization: Bearer $BB_TOKEN" -X "$method" -H "Content-Type: application/json" "$url" "$@"
  fi
}

# Every CLI call goes through this: NODE_OPTIONS is cleared because the VS Code inspector
# bootloader keeps node alive after the command ends, and the job then looks stuck.
bb_ci_env() {
  env -u NODE_OPTIONS \
    CI=true \
    CI_SFDX_HARDIS_BITBUCKET_TOKEN="$BB_TOKEN" \
    CI_SFDX_HARDIS_BITBUCKET_EMAIL="$BB_EMAIL" \
    BITBUCKET_WORKSPACE="$BB_WORKSPACE" \
    BITBUCKET_REPO_SLUG="$BB_REPO" \
    BITBUCKET_BUILD_NUMBER="1" \
    "$@"
}

# One field of a Pull Request, as Bitbucket knows it
# Usage: bb_pr_field <id> <python expression over `d`>
bb_pr_field() {
  bb_api GET "$BB_API/pullrequests/$1" |
    python -c "import json,sys; d=json.load(sys.stdin); print($2)"
}

# Check out refs/pull-requests/<id>/merge as a Bitbucket Pipelines PR job would.
#
# Bitbucket recomputes that ref after a push to the source branch, so asking for it too early hands
# back the previous merge and the job validates a tree without the commit that was just pushed.
# The ref is fetched again until it holds the real head of the source branch.
# Usage: bb_fetch_merge_ref <id>
bb_fetch_merge_ref() {
  local pr="$1" source sha
  source=$(bb_pr_field "$pr" "d['source']['branch']['name']")
  for _ in $(seq 1 20); do
    sha=$(git ls-remote origin "refs/heads/$source" | cut -f1)
    if [ -n "$sha" ] &&
      git fetch -q origin "+refs/pull-requests/$pr/merge:refs/heads/prmerge-$pr" 2>/dev/null &&
      git merge-base --is-ancestor "$sha" "prmerge-$pr" 2>/dev/null; then
      return 0
    fi
    sleep 3
  done
  echo "merge ref of PR $pr never caught up with $source ($sha)" >&2
  return 1
}

# Validation job: Bitbucket Pipelines checks out the merge of the Pull Request
# Usage: bb_check <pr id> <target branch> <log label>
bb_check() {
  local pr="$1" target="$2" label="$3" code
  cd "$WORK" || return 1
  git checkout -q -f --detach HEAD
  bb_fetch_merge_ref "$pr" || return 1
  git checkout -q -f "prmerge-$pr" || return 1
  bb_ci_env \
    BITBUCKET_PR_ID="$pr" \
    BITBUCKET_BRANCH="pull-requests/$pr/merge" \
    CI_COMMIT_REF_NAME="pull-requests/$pr/merge" \
    FORCE_TARGET_BRANCH="$target" \
    CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Deployment job: Bitbucket Pipelines checks out the target branch at the merge commit
# Usage: bb_deploy <target branch> <log label>
bb_deploy() {
  local target="$1" label="$2" code
  cd "$WORK" || return 1
  git checkout -q -f "$target" && git pull -q origin "$target"
  bb_ci_env \
    BITBUCKET_BRANCH="$target" \
    CI_COMMIT_REF_NAME="$target" \
    CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --target-org "$ORG" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Assemble a promotion, agent mode so nothing prompts
# Usage: bb_promote <source branch> <comma separated PR ids> <log label> [extra flags...]
bb_promote() {
  local source="$1" prs="$2" label="$3" code
  shift 3
  cd "$WORK" || return 1
  git checkout -q -f "$source" && git pull -q origin "$source"
  bb_ci_env \
    BITBUCKET_BRANCH="$source" \
    CI_COMMIT_REF_NAME="$source" \
    CONFIG_BRANCH="$source" \
    node "$DEV" hardis:project:promotion:create --agent \
    --source-branch "$source" --pull-requests "$prs" "$@" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Release notes of the last go-live merged into main
# Usage: bb_release_notes <log label> [extra flags, e.g. --include-promotions]
bb_release_notes() {
  local label="$1" code
  shift
  cd "$WORK" || return 1
  git checkout -q -f main && git pull -q origin main
  bb_ci_env \
    BITBUCKET_BRANCH=main \
    CI_COMMIT_REF_NAME=main \
    CONFIG_BRANCH=main \
    node "$DEV" hardis:doc:release-notes --mode post --target-branch main \
    --merge-commit "$(git log --merges -1 --format=%H)" --no-pdf --agent "$@" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Open a Pull Request and echo its id
# Usage: bb_pr_create <source branch> <target branch> <title> <description file, or - for none>
bb_pr_create() {
  local source="$1" target="$2" title="$3" body_file="$4" payload
  payload=$(python -c "
import io, json, sys
body = io.open(sys.argv[4], encoding='utf-8').read() if sys.argv[4] != '-' else ''
print(json.dumps({'title': sys.argv[3], 'description': body,
                  'source': {'branch': {'name': sys.argv[1]}},
                  'destination': {'branch': {'name': sys.argv[2]}},
                  'close_source_branch': False}))
" "$source" "$target" "$title" "$body_file")
  bb_api POST "$BB_API/pullrequests" -d "$payload" |
    python -c "
import json, sys
d = json.load(sys.stdin)
if not d.get('id'):
    print('PR CREATION FAILED', json.dumps(d)[:400], file=sys.stderr); sys.exit(1)
print(d['id'])
"
}

# Merge a Pull Request with a real merge commit, never squashing: the -x trailers of the
# cherry-picks must survive.
# Usage: bb_pr_merge <id>
bb_pr_merge() {
  local pr="$1" state
  bb_api POST "$BB_API/pullrequests/$pr/merge" \
    -d '{"merge_strategy": "merge_commit", "close_source_branch": false}' >/dev/null
  for _ in $(seq 1 30); do
    state=$(bb_pr_field "$pr" "d.get('state')")
    if [ "$state" = "MERGED" ]; then
      echo "merged"
      return 0
    fi
    sleep 2
  done
  echo "MERGE FAILED for PR $pr, last state $state" >&2
  return 1
}

# The lines worth reading in a job log. Same expression as the GitHub library.
if ! declare -f e2e_grep >/dev/null 2>&1; then
  e2e_grep() {
    grep -aE "PromotionBranch|Pull Request scope|Test classes selected|^ - Promo|Final test level|Delta deployment has been|Found [0-9]+ (Pre|Post)-deployment|Running action|Skipping .*action|Manual action|Successfully (checked|deployed)|Deployment mode|Error \(SfError\)|carries|already" "$1"
  }
fi
