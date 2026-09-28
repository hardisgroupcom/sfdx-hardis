#!/usr/bin/env bash
# Regression check of the promotion branches feature on Azure DevOps: run the same CI jobs with a
# given sfdx-hardis checkout and store their logs, so two runs (main vs the branch under test,
# feature off) can be compared line by line with ab-diff.py.
#
# Usage: ab-run-azure.sh <label> <off|on> <feature PR> <feature target> <major PR> <major target> <deploy branch>
#
# Needs the same environment as e2e-lib-azure.sh (ORG, AZ_ORG, AZ_PROJECT, AZ_REPO_ID,
# AZ_REPO_NAME, AZ_TOKEN, WORK, LOGS, DEV), and that library sourced for az_fetch_merge_ref and
# az_ci_env.
#
# Copy this script (and ab-diff.py) outside the sfdx-hardis working copy before running the pair:
# checking out origin/main takes .claude/skills away with it.
set -u

# The job simulators live in a function library. `bash ab-run-azure.sh` is a child process, so it
# does not inherit the functions the caller sourced: source the library that sits next to this
# script, which is why the pair is copied outside the sfdx-hardis working copy as one folder.
if ! declare -f az_ci_env >/dev/null 2>&1; then
  # shellcheck source=/dev/null
  . "$(dirname "$0")/e2e-lib-azure.sh"
fi

LABEL="$1"
MODE="$2"
FEATURE_PR="$3"
FEATURE_TARGET="$4"
MAJOR_PR="$5"
MAJOR_TARGET="$6"
DEPLOY_BRANCH="$7"
OUT="$LOGS/ab-$LABEL"
mkdir -p "$OUT"
cd "$WORK" || exit 1

set_flag() {
  if [ "$MODE" = "off" ]; then
    sed -i 's/^enablePromotionBranches: true$/enablePromotionBranches: false/' config/.sfdx-hardis.yml
  fi
}
restore_flag() { git checkout -q -- config/.sfdx-hardis.yml; }

run_check() {
  local pr="$1" target="$2" name="$3" code
  git checkout -q -f --detach HEAD
  az_fetch_merge_ref "$pr" || return 1
  git checkout -q -f "prmerge-$pr"
  set_flag
  az_ci_env SYSTEM_PULLREQUEST_PULLREQUESTID="$pr" CI_COMMIT_REF_NAME="refs/pull/$pr/merge" \
    BUILD_SOURCEBRANCHNAME="merge" FORCE_TARGET_BRANCH="$target" CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" >"$OUT/$name.log" 2>&1
  code=$?
  echo "$name exit=$code"
  restore_flag
}
run_deploy() {
  local target="$1" name="$2" code
  git checkout -q -f "$target" && git pull -q origin "$target"
  set_flag
  az_ci_env CI_COMMIT_REF_NAME="$target" BUILD_SOURCEBRANCHNAME="$target" CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --target-org "$ORG" >"$OUT/$name.log" 2>&1
  code=$?
  echo "$name exit=$code"
  restore_flag
}
run_release_notes() {
  local code
  git checkout -q -f main && git pull -q origin main
  set_flag
  az_ci_env CI_COMMIT_REF_NAME=main BUILD_SOURCEBRANCHNAME=main CONFIG_BRANCH=main \
    node "$DEV" hardis:doc:release-notes --mode post --target-branch main \
    --merge-commit "$(git log --merges -1 --format=%H)" --no-pdf --agent >"$OUT/release-notes.log" 2>&1
  code=$?
  echo "release-notes exit=$code"
  cp hardis-report/release-notes/main-*/release-notes-main-*.md "$OUT/release-notes.md" 2>/dev/null
  restore_flag
}

run_check "$FEATURE_PR" "$FEATURE_TARGET" "check-feature-pr$FEATURE_PR"
run_check "$MAJOR_PR" "$MAJOR_TARGET" "check-major-pr$MAJOR_PR"
run_deploy "$DEPLOY_BRANCH" "deploy-$DEPLOY_BRANCH"
run_release_notes
echo "AB $LABEL ($MODE) DONE"
