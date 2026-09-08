#!/usr/bin/env bash
# Job simulators for the promotion branches end to end test, Azure DevOps flavour. Source this file.
#
#   export ORG AZ_ORG AZ_PROJECT AZ_REPO_ID AZ_REPO_NAME AZ_TOKEN WORK LOGS DEV
#   source .claude/skills/promotion-branches-e2e/scripts/e2e-lib-azure.sh
#
# sfdx-hardis picks Azure DevOps when SYSTEM_ACCESSTOKEN (or CI_SFDX_HARDIS_AZURE_TOKEN, or
# AZURE_DEVOPS_EXT_PAT) is set, and reads the repository and the Pull Request from
# BUILD_REPOSITORY_ID / SYSTEM_TEAMPROJECT / SYSTEM_PULLREQUEST_PULLREQUESTID, so running the CLI
# locally with those variables reproduces an Azure Pipelines job exactly.
#
#   ORG           target org username or alias
#   AZ_ORG        Azure DevOps organization name, e.g. nicolasvuillamy
#   AZ_PROJECT    team project holding the repository
#   AZ_REPO_ID    repository GUID (BUILD_REPOSITORY_ID)
#   AZ_REPO_NAME  repository name (BUILD_REPOSITORY_NAME)
#   AZ_TOKEN      personal access token, Code read/write + Pull Request threads read/write
#   WORK          local clone
#   LOGS          folder where each job log is written
#   DEV           path to bin/dev.js of the sfdx-hardis working copy under test

: "${ORG:?set ORG to the target org}"
: "${AZ_ORG:?set AZ_ORG to the Azure DevOps organization name}"
: "${AZ_PROJECT:?set AZ_PROJECT to the team project}"
: "${AZ_REPO_ID:?set AZ_REPO_ID to the repository GUID}"
: "${AZ_REPO_NAME:?set AZ_REPO_NAME to the repository name}"
: "${AZ_TOKEN:?set AZ_TOKEN to an Azure DevOps personal access token}"
: "${WORK:?set WORK to the local clone}"
: "${LOGS:?set LOGS to the log folder}"
: "${DEV:?set DEV to the path of bin/dev.js}"

mkdir -p "$LOGS"

AZ_COLLECTION="https://dev.azure.com/$AZ_ORG/"
AZ_REPO_API="${AZ_COLLECTION}${AZ_PROJECT}/_apis/git/repositories/$AZ_REPO_ID"

# The Azure DevOps REST API. `az repos` is not used: it needs the Azure CLI logged in, prints its
# own decorations, and cannot set the completion options the merge needs.
# Usage: az_api <method> <url> [curl args...]
az_api() {
  local method="$1" url="$2"
  shift 2
  curl -sS -u ":$AZ_TOKEN" -X "$method" -H "Content-Type: application/json" "$url" "$@"
}

# Every CLI call goes through this: NODE_OPTIONS is cleared because the VS Code inspector
# bootloader keeps node alive after the command ends, and the job then looks stuck.
az_ci_env() {
  env -u NODE_OPTIONS \
    CI=true \
    SYSTEM_ACCESSTOKEN="$AZ_TOKEN" \
    SYSTEM_COLLECTIONURI="$AZ_COLLECTION" \
    SYSTEM_TEAMPROJECT="$AZ_PROJECT" \
    BUILD_REPOSITORY_ID="$AZ_REPO_ID" \
    BUILD_REPOSITORY_NAME="$AZ_REPO_NAME" \
    BUILD_REPOSITORYNAME="$AZ_REPO_NAME" \
    BUILD_BUILD_ID="1" \
    BUILD_BUILDID="1" \
    SYSTEM_JOB_ID="1" \
    SYSTEM_JOB_DISPLAY_NAME="e2e" \
    "$@"
}

# One field of a Pull Request, as Azure DevOps knows it
# Usage: az_pr_field <pr id> <python expression over `d`>
az_pr_field() {
  curl -sS -u ":$AZ_TOKEN" "$AZ_REPO_API/pullrequests/$1?api-version=7.1" |
    python -c "import json,sys; d=json.load(sys.stdin); print($2)"
}

# Check out refs/pull/<id>/merge as an Azure Pipelines PR validation job would.
#
# Azure recomputes that ref asynchronously after a push to the source branch: asking for it too
# early hands back the previous merge, and the job then validates a tree without the commit that
# was just pushed. That looks like a product bug and is not one, so the ref is fetched again until
# it holds the real head of the source branch.
# Usage: az_fetch_merge_ref <pr id>
az_fetch_merge_ref() {
  local pr="$1" source sha
  source=$(az_pr_field "$pr" "d['sourceRefName'].replace('refs/heads/','')")
  for _ in $(seq 1 20); do
    sha=$(git ls-remote origin "refs/heads/$source" | cut -f1)
    if [ -n "$sha" ] &&
      git fetch -q origin "+refs/pull/$pr/merge:refs/heads/prmerge-$pr" 2>/dev/null &&
      git merge-base --is-ancestor "$sha" "prmerge-$pr" 2>/dev/null; then
      return 0
    fi
    sleep 3
  done
  echo "merge ref of PR $pr never caught up with $source ($sha)" >&2
  return 1
}

# Validation job: Azure Pipelines checks out refs/pull/<id>/merge
# Usage: az_check <pr id> <target branch> <log label>
az_check() {
  local pr="$1" target="$2" label="$3" code
  cd "$WORK" || return 1
  git checkout -q -f --detach HEAD
  az_fetch_merge_ref "$pr" || return 1
  git checkout -q -f "prmerge-$pr" || return 1
  az_ci_env \
    SYSTEM_PULLREQUEST_PULLREQUESTID="$pr" \
    CI_COMMIT_REF_NAME="refs/pull/$pr/merge" \
    BUILD_SOURCEBRANCHNAME="merge" \
    FORCE_TARGET_BRANCH="$target" \
    CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Deployment job: Azure Pipelines checks out the target branch at the merge commit
# Usage: az_deploy <target branch> <log label>
az_deploy() {
  local target="$1" label="$2" code
  cd "$WORK" || return 1
  git checkout -q -f "$target" && git pull -q origin "$target"
  az_ci_env \
    CI_COMMIT_REF_NAME="$target" \
    BUILD_SOURCEBRANCHNAME="$target" \
    CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --target-org "$ORG" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Assemble a promotion, agent mode so nothing prompts
# Usage: az_promote <source branch> <comma separated PR ids> <log label> [extra flags...]
az_promote() {
  local source="$1" prs="$2" label="$3" code
  shift 3
  cd "$WORK" || return 1
  git checkout -q -f "$source" && git pull -q origin "$source"
  az_ci_env \
    CI_COMMIT_REF_NAME="$source" \
    BUILD_SOURCEBRANCHNAME="$source" \
    CONFIG_BRANCH="$source" \
    node "$DEV" hardis:project:promotion:create --agent \
    --source-branch "$source" --pull-requests "$prs" "$@" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Release notes of the last go-live merged into main
# Usage: az_release_notes <log label> [extra flags, e.g. --include-promotions]
az_release_notes() {
  local label="$1" code
  shift
  cd "$WORK" || return 1
  git checkout -q -f main && git pull -q origin main
  az_ci_env \
    CI_COMMIT_REF_NAME=main \
    BUILD_SOURCEBRANCHNAME=main \
    CONFIG_BRANCH=main \
    node "$DEV" hardis:doc:release-notes --mode post --target-branch main \
    --merge-commit "$(git log --merges -1 --format=%H)" --no-pdf --agent "$@" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Open a Pull Request and echo its id.
# Azure caps a Pull Request description at 4000 characters and rejects a longer one, so the body is
# posted as is and the caller keeps its descriptions short.
# Usage: az_pr_create <source branch> <target branch> <title> <description file, or - for none>
az_pr_create() {
  local source="$1" target="$2" title="$3" body_file="$4" payload
  payload=$(python -c "
import io, json, sys
body = io.open(sys.argv[4], encoding='utf-8').read() if sys.argv[4] != '-' else ''
print(json.dumps({'sourceRefName': 'refs/heads/' + sys.argv[1],
                  'targetRefName': 'refs/heads/' + sys.argv[2],
                  'title': sys.argv[3], 'description': body}))
" "$source" "$target" "$title" "$body_file")
  az_api POST "$AZ_REPO_API/pullrequests?api-version=7.1" -d "$payload" |
    python -c "
import json, sys
d = json.load(sys.stdin)
if not d.get('pullRequestId'):
    print('PR CREATION FAILED', json.dumps(d)[:400], file=sys.stderr); sys.exit(1)
print(d['pullRequestId'])
"
}

# Complete a Pull Request with a real merge commit, never squashing: the -x trailers of the
# cherry-picks must survive. Azure computes mergeability asynchronously and refuses the completion
# while it is still checking, then completes the merge itself asynchronously too.
# Usage: az_pr_merge <pr id>
az_pr_merge() {
  local pr="$1" status sha payload
  for _ in $(seq 1 30); do
    status=$(az_pr_field "$pr" "d.get('mergeStatus')")
    case "$status" in
    queued | notSet | "" | None) sleep 2 ;;
    *) break ;;
    esac
  done
  if [ "$status" != "succeeded" ]; then
    echo "PR $pr is not mergeable: mergeStatus=$status" >&2
    return 1
  fi
  sha=$(az_pr_field "$pr" "d['lastMergeSourceCommit']['commitId']")
  payload=$(python -c "
import json, sys
print(json.dumps({'status': 'completed',
                  'lastMergeSourceCommit': {'commitId': sys.argv[1]},
                  'completionOptions': {'mergeStrategy': 'noFastForward',
                                        'deleteSourceBranch': False,
                                        'bypassPolicy': True,
                                        'bypassReason': 'promotion branches end to end test'}}))
" "$sha")
  az_api PATCH "$AZ_REPO_API/pullrequests/$pr?api-version=7.1" -d "$payload" >/dev/null
  # The completion is queued: wait until Azure has actually written the merge commit
  for _ in $(seq 1 30); do
    status=$(az_pr_field "$pr" "str(d.get('status')) + ':' + str(d.get('mergeStatus'))")
    case "$status" in
    completed:succeeded)
      echo "merged"
      return 0
      ;;
    *) sleep 2 ;;
    esac
  done
  echo "MERGE FAILED for PR $pr, last state $status" >&2
  return 1
}

# The lines worth reading in a job log. Same expression as the GitHub library.
if ! declare -f e2e_grep >/dev/null 2>&1; then
  e2e_grep() {
    grep -aE "PromotionBranch|Pull Request scope|Test classes selected|^ - Promo|Final test level|Delta deployment has been|Found [0-9]+ (Pre|Post)-deployment|Running action|Skipping .*action|Manual action|Successfully (checked|deployed)|Deployment mode|Error \(SfError\)|carries|already" "$1"
  }
fi

# Dump the Pull Requests and their comment threads in the provider agnostic shape
# audit-pr-comments.cjs reads.
# Usage: dump_pr_comments <out.json> [pr id ...]   (all Pull Requests when none is given)
dump_pr_comments() {
  local out="$1"
  shift
  AZ_REPO_API="$AZ_REPO_API" AZ_TOKEN="$AZ_TOKEN" python -c "
import json, os, subprocess, sys

API, TOKEN = os.environ['AZ_REPO_API'], os.environ['AZ_TOKEN']

def get(url):
    return json.loads(subprocess.check_output(['curl', '-sS', '-u', ':' + TOKEN, url]))

wanted = set(int(a) for a in sys.argv[2:])
prs = []
listed = get(API + '/pullrequests?searchCriteria.status=all&' + chr(36) + 'top=500&api-version=7.1')['value']
for raw in listed:
    pr_id = raw['pullRequestId']
    if wanted and pr_id not in wanted:
        continue
    # the list API truncates the description at 400 characters: read the full Pull Request
    full = get('%s/pullrequests/%s?api-version=7.1' % (API, pr_id))
    comments = []
    for thread in get('%s/pullrequests/%s/threads?api-version=7.1' % (API, pr_id))['value']:
        if thread.get('isDeleted'):
            continue
        for c in thread.get('comments') or []:
            if c.get('isDeleted'):
                continue
            comments.append({'id': '%s-%s' % (thread.get('id'), c.get('id')),
                             'body': c.get('content') or '',
                             'url': ''})
    prs.append({'number': pr_id, 'title': raw.get('title') or '',
                'sourceBranch': (raw.get('sourceRefName') or '').replace('refs/heads/', ''),
                'targetBranch': (raw.get('targetRefName') or '').replace('refs/heads/', ''),
                'state': raw.get('status') or '',
                'description': full.get('description') or '',
                'comments': comments})
json.dump({'provider': 'azure', 'prs': prs}, open(sys.argv[1], 'w', encoding='utf-8'), indent=1)
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
  env -u NODE_OPTIONS     EXT="${EXT:-C:/git/vscode-sfdx-hardis}"     WORK="$WORK"     PROVIDER_TOKEN="$AZ_TOKEN"     node "$E2E_SCRIPTS_DIR/check-pipeline.cjs" ${expect:+"$expect"}     >"$LOGS/$label.log" 2>&1
  code=$?
  cat "$LOGS/$label.log"
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}
