#!/usr/bin/env bash
# promo.sh <pr> <targetBranch> [tick]
#   A Pull Request between two major branches: waits for its Simulate Deployment
#   check, merges without a squash, and watches the deployment job of the target.
#   With "tick", a check stopped by a pending pre-deployment manual action gets
#   its box ticked for that org branch (tick.mjs) and is run again first, which
#   is what Labs 3.5 and 3.6 ask of the learner.
#
# prflow.sh reads the checks of the head commit, and the head of a promotion is
# a major branch whose own deployment job already passed: it answers "pass" for
# the wrong job. Use this one for promotions.
#
# Exits 0 only when the Pull Request is merged and its deployment job is green.
set -e
# shellcheck source-path=SCRIPTDIR
# shellcheck source=env.sh
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
R=$FORK
PR=$1
B=$2
[ -n "$PR" ] && [ -n "$B" ] || {
  echo "usage: promo.sh <pr> <targetBranch> [tick]"
  exit 1
}
CHECK='Simulate Deployment to Major Org'
WORKFLOW='Process Deployment (sfdx-hardis)'

# The head of a promotion is a major branch, and the same commit can carry the
# check of another Pull Request (the promotion of last week, closed since). Read
# the newest run of that name, never "the" run.
simulate() {
  gh pr checks "$PR" -R "$R" --json name,bucket,link,startedAt \
    -q "[.[] | select(.name==\"$CHECK\")] | sort_by(.startedAt) | last | .$1 // \"\"" 2>/dev/null || true
}
# Waits until that check reaches a final state, and prints it.
wait_check() {
  local state=""
  for _ in $(seq 1 60); do
    state=$(simulate bucket)
    case $state in pass | fail | cancel | skipping) break ;; esac
    sleep 20
  done
  echo "$state"
}

S=$(wait_check)
echo "simulate: ${S:-no check registered}"
if [ "$S" = "fail" ] && [ "$3" = "tick" ]; then
  node "$E2E_HERE/tick.mjs" "$PR" "$B"
  RID=$(simulate link | sed -E 's#.*/runs/([0-9]+).*#\1#')
  gh run rerun "$RID" -R "$R"
  # The rerun takes a few seconds to turn the check back to pending
  sleep 30
  S=$(wait_check)
  echo "simulate after the tick: ${S:-no check registered}"
fi
[ "$S" = "pass" ] || {
  echo "NOT MERGED: #$PR, its $CHECK check reads '${S:-nothing}'"
  exit 1
}

BEFORE=$(gh run list -R "$R" --branch "$B" -w "$WORKFLOW" -L 1 --json databaseId -q '.[0].databaseId // ""')
# A merge asked the second the check turns green can be refused while GitHub
# still registers it: try again for three minutes, and say so when it never goes.
MERGED=""
for _ in 1 2 3 4 5 6; do
  if gh pr merge "$PR" -R "$R" --merge; then
    MERGED=yes
    break
  fi
  sleep 30
done
[ -n "$MERGED" ] || {
  echo "NOT MERGED: #$PR"
  exit 1
}

# The deployment to watch is the one this merge starts, never the one the
# previous merge into the same branch left.
DID=""
for _ in $(seq 1 30); do
  DID=$(gh run list -R "$R" --branch "$B" -w "$WORKFLOW" -L 1 --json databaseId -q '.[0].databaseId // ""')
  [ -n "$DID" ] && [ "$DID" != "$BEFORE" ] && break
  DID=""
  sleep 10
done
[ -n "$DID" ] || {
  echo "MERGED, but no deployment job started on $B"
  exit 1
}
RESULT=0
gh run watch "$DID" -R "$R" --exit-status >/dev/null 2>&1 || RESULT=$?
echo "deploy $B exit $RESULT (run $DID)"
exit "$RESULT"
