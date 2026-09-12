#!/usr/bin/env bash
# Starting point of runbook section 6bis on any git provider: the developer branch created from
# integration, then stories S1 to S3 opened, given their deployment actions and merged into
# integration (so the developer branch is behind, which is what a backpromote is for), and the
# developer scratch orgs ready with the base project. Writes $LOGS/bp-vars.sh for backpromote-steps.sh.
#
#   export BP_PROVIDER_LIB=<path to e2e-lib.sh | e2e-lib-gitlab.sh | e2e-lib-azure.sh>
#   export <the provider library variables> WORK LOGS DEV API DEVHUB DEVORG DEVORG2
#   bash backpromote-setup.sh
#
# The remote repository must exist, with main, integration, uat and preprod pushed (build-repo.sh).
# DEVORG and DEVORG2 are created from DEVHUB when they do not exist, and reset to the base project when
# they do: a developer Dev Hub creates 6 scratch orgs a day, so the providers share them.
set -uo pipefail
: "${BP_PROVIDER_LIB:?set BP_PROVIDER_LIB to the provider library}"
: "${DEVHUB:?set DEVHUB}" "${DEVORG:?set DEVORG}" "${DEVORG2:?set DEVORG2}"
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$BP_PROVIDER_LIB"
source "$SCRIPTS_DIR/stories.sh"
mkdir -p "$LOGS"
cd "$WORK" || exit 1

bp_story() {
  local branch="$1" resource="$2" kind="$3" title="$4" number
  story_branch "$branch" integration "$resource" >&2 || return 1
  number=$(bp_open "$branch" "$title" "Story $resource, backpromote end to end test.") || return 1
  story_actions "$branch" "$number" "$kind" >&2 || return 1
  bp_merge "$number" >&2 || return 1
  echo "$number"
}

echo "=== developer branch, before the stories are merged ==="
git checkout -q -f integration && git pull -q origin integration
git branch -q -f feature/E2E-401-dev integration

echo "=== stories S1 to S3 ==="
S1=$(bp_story feature/E2E-101-alpha E2E_S1 pre-command+post-manual "E2E-101 alpha") || exit 1
S2=$(bp_story feature/E2E-102-beta E2E_S2 post-command "E2E-102 beta") || exit 1
S3=$(bp_story feature/E2E-103-gamma E2E_S3 pre-command "E2E-103 gamma") || exit 1
git checkout -q -f integration && git pull -q origin integration
git log --first-parent --oneline -4 integration
ROOT=$(git rev-list --max-parents=0 origin/integration)

bp_ensure_scratch() {
  local org="$1"
  if ! env -u NODE_OPTIONS sf org display --target-org "$org" >/dev/null 2>&1; then
    echo '{"orgName":"promo e2e dev","edition":"Developer"}' >"$LOGS/scratch-def.json"
    env -u NODE_OPTIONS sf org create scratch --definition-file "$LOGS/scratch-def.json" --target-dev-hub "$DEVHUB" \
      --alias "$org" --duration-days 1 --wait 30 || return 1
  fi
  backpromote_reset_org "$org" "$ROOT"
}
echo "=== developer scratch orgs ==="
bp_ensure_scratch "$DEVORG" || exit 1
bp_ensure_scratch "$DEVORG2" || exit 1

echo "=== developer branch checked out ==="
git checkout -q -f feature/E2E-401-dev
cat >"$LOGS/bp-vars.sh" <<VARS
export S1="$S1" S2="$S2" S3="$S3" ROOT="$ROOT"
VARS
echo "S1=$S1 S2=$S2 S3=$S3 ROOT=$ROOT"
echo "SETUP DONE"
