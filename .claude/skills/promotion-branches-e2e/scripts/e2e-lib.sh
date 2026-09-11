#!/usr/bin/env bash
# Job simulators for the promotion branches end to end test. Source this file, do not execute it.
#
#   export ORG REPO WORK LOGS DEV
#   source .claude/skills/promotion-branches-e2e/scripts/e2e-lib.sh
#
# GitHub Actions is not needed: sfdx-hardis resolves the Pull Request from the environment, so
# running the CLI locally with the right variables reproduces a real job exactly.
#
#   ORG   target org username or alias
#   REPO  owner/name of the throwaway test repository
#   WORK  local clone of that repository
#   LOGS  folder where each job log is written
#   DEV   path to bin/dev.js of the sfdx-hardis working copy under test

: "${ORG:?set ORG to the target org}"
: "${REPO:?set REPO to owner/name of the test repository}"
: "${WORK:?set WORK to the local clone}"
: "${LOGS:?set LOGS to the log folder}"
: "${DEV:?set DEV to the path of bin/dev.js}"

mkdir -p "$LOGS"

# Every CLI call goes through this: NODE_OPTIONS is cleared because the VS Code inspector
# bootloader keeps node alive after the command ends, and the job then looks stuck.
e2e_ci_env() {
  env -u NODE_OPTIONS \
    CI=true \
    GITHUB_TOKEN="$(gh auth token)" \
    GITHUB_REPOSITORY="$REPO" \
    GITHUB_REPOSITORY_OWNER="${REPO%%/*}" \
    GITHUB_SERVER_URL="https://github.com" \
    "$@"
}

# Validation job: GitHub Actions checks out refs/pull/<N>/merge
# Usage: e2e_check <pr number> <target branch> <log label>
e2e_check() {
  local pr="$1" target="$2" label="$3" code
  cd "$WORK" || return 1
  git checkout -q -f --detach HEAD
  git fetch -q origin "+refs/pull/$pr/merge:refs/heads/prmerge-$pr" || return 1
  git checkout -q -f "prmerge-$pr" || return 1
  e2e_ci_env \
    GITHUB_REF_NAME="$pr/merge" \
    GITHUB_REF="refs/pull/$pr/merge" \
    FORCE_TARGET_BRANCH="$target" \
    CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Deployment job: GitHub Actions checks out the target branch at the merge commit
# Usage: e2e_deploy <target branch> <log label>
e2e_deploy() {
  local target="$1" label="$2" code
  cd "$WORK" || return 1
  git checkout -q -f "$target" && git pull -q origin "$target"
  e2e_ci_env \
    GITHUB_REF_NAME="$target" \
    GITHUB_REF="refs/heads/$target" \
    CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --target-org "$ORG" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Assemble a promotion, agent mode so nothing prompts
# Usage: e2e_promote <source branch> <comma separated PR numbers> <log label> [extra flags...]
e2e_promote() {
  local source="$1" prs="$2" label="$3" code
  shift 3
  cd "$WORK" || return 1
  git checkout -q -f "$source" && git pull -q origin "$source"
  env -u NODE_OPTIONS \
    GITHUB_TOKEN="$(gh auth token)" \
    GITHUB_REPOSITORY="$REPO" \
    GITHUB_REPOSITORY_OWNER="${REPO%%/*}" \
    GITHUB_SERVER_URL="https://github.com" \
    CONFIG_BRANCH="$source" \
    node "$DEV" hardis:project:promotion:create --agent \
    --source-branch "$source" --pull-requests "$prs" "$@" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Release notes of the last go-live merged into main
# Usage: e2e_release_notes <log label> [extra flags, e.g. --include-promotions]
e2e_release_notes() {
  local label="$1" code
  shift
  cd "$WORK" || return 1
  git checkout -q -f main && git pull -q origin main
  e2e_ci_env \
    GITHUB_REF_NAME=main \
    CONFIG_BRANCH=main \
    node "$DEV" hardis:doc:release-notes --mode post --target-branch main \
    --merge-commit "$(git log --merges -1 --format=%H)" --no-pdf --agent "$@" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# The lines worth reading in a job log
# Usage: e2e_grep <log file>
e2e_grep() {
  grep -aE "PromotionBranch|Pull Request scope|Test classes selected|^ - Promo|Final test level|Delta deployment has been|Found [0-9]+ (Pre|Post)-deployment|Running action|Skipping .*action|Manual action|Successfully (checked|deployed)|Deployment mode|Error \(SfError\)|carries|already" "$1"
}

# Dump the Pull Requests and their comments in the provider agnostic shape audit-pr-comments.cjs
# reads. Usage: dump_pr_comments <out.json> [pr number ...]  (all Pull Requests when none is given)
dump_pr_comments() {
  local out="$1"
  shift
  REPO="$REPO" python -c "
import json, os, subprocess, sys

REPO = os.environ['REPO']

def gh(path):
    return json.loads(subprocess.check_output(['gh', 'api', path, '--paginate'], encoding='utf-8'))

wanted = set(int(a) for a in sys.argv[2:])
prs = []
for raw in gh('repos/%s/pulls?state=all&per_page=100' % REPO):
    if wanted and raw['number'] not in wanted:
        continue
    comments = [{'id': str(c['id']), 'body': c.get('body') or '', 'url': c.get('html_url') or ''}
                for c in gh('repos/%s/issues/%s/comments?per_page=100' % (REPO, raw['number']))]
    prs.append({'number': raw['number'], 'title': raw.get('title') or '',
                'sourceBranch': raw['head']['ref'], 'targetBranch': raw['base']['ref'],
                'state': 'merged' if raw.get('merged_at') else raw.get('state'),
                'description': raw.get('body') or '',
                'comments': comments})
json.dump({'provider': 'github', 'prs': prs}, open(sys.argv[1], 'w', encoding='utf-8'), indent=1)
print('dumped %d Pull Requests to %s' % (len(prs), sys.argv[1]))
" "$out" "$@"
}

# Where this library sits, so the pipeline check can find its script next to it
E2E_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# What the vscode-sfdx-hardis DevOps Pipeline shows right now: the User Stories of each branch
# node, its counter bubble, and the open promotion drawn on a merge arrow. Run it before and after
# every promotion operation, with the expectations of that point of the run.
# Usage: pipeline_check <log label> [expectations file]
pipeline_check() {
  local label="$1" expect="${2:-}" code
  env -u NODE_OPTIONS EXT="${EXT:-C:/git/vscode-sfdx-hardis}" WORK="$WORK" PROVIDER_TOKEN="$(gh auth token)" node "$E2E_SCRIPTS_DIR/check-pipeline.cjs" ${expect:+"$expect"} >"$LOGS/$label.log" 2>&1
  code=$?
  cat "$LOGS/$label.log"
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}
