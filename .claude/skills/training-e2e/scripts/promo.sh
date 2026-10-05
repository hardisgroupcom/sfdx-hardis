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
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
R=$FORK
PR=$1
B=$2
wait_check() { sleep 150; for i in $(seq 1 30); do S=$(gh pr checks $PR -R $R --json name,bucket -q '.[]|select(.name=="Simulate Deployment to Major Org")|.bucket' 2>/dev/null); [ "$S" = "pass" -o "$S" = "fail" ] && break; sleep 30; done; echo "simulate: $S"; }
wait_check
if [ "$S" = "fail" ] && [ "$3" = "tick" ]; then
  node "$E2E_HERE/tick.mjs" "$PR" "$B"
  RID=$(gh pr checks $PR -R $R --json name,link -q '.[]|select(.name=="Simulate Deployment to Major Org")|.link' | sed -E 's#.*/runs/([0-9]+).*#\1#')
  gh run rerun $RID -R $R; sleep 30; gh run watch $RID -R $R --exit-status >/dev/null 2>&1; echo "rerun exit $?"
fi
# A merge asked the second the check turns green can be refused while GitHub
# still registers it: try again for three minutes, and say so when it never goes.
WORKFLOW='Process Deployment (sfdx-hardis)'
BEFORE=$(gh run list -R "$R" --branch "$B" -w "$WORKFLOW" -L 1 --json databaseId -q '.[0].databaseId // ""')
MERGED=""
for i in 1 2 3 4 5 6; do
  if gh pr merge "$PR" -R "$R" --merge; then MERGED=yes; break; fi
  sleep 30
done
[ -n "$MERGED" ] || { echo "NOT MERGED: #$PR"; exit 1; }
# The deployment to watch is the one this merge starts, never the one the
# previous merge into the same branch left.
DID=""
for i in $(seq 1 20); do
  DID=$(gh run list -R "$R" --branch "$B" -w "$WORKFLOW" -L 1 --json databaseId -q '.[0].databaseId // ""')
  [ -n "$DID" ] && [ "$DID" != "$BEFORE" ] && break
  sleep 10
done
gh run watch "$DID" -R "$R" --exit-status >/dev/null 2>&1
echo "deploy $B exit $? (run $DID)"
