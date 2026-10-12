#!/usr/bin/env bash
# wait-check.sh <pr>
#   Stands in for a learner watching the check of a Pull Request: waits for the newest
#   Simulate Deployment check to end (30 minutes at most), prints its bucket and its run id.
#   The fork is FORK of env.sh: <login>/sfdx-hardis-training unless the variable is set.
#   No browser: gh only, and it reads.
# shellcheck source-path=SCRIPTDIR
# shellcheck source=../env.sh
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
R=$FORK
q='[.[]|select(.name=="Simulate Deployment to Major Org")]|sort_by(.startedAt)|last'
sleep 20
for _ in $(seq 1 90); do
  B=$(gh pr checks "$1" -R "$R" --json name,bucket,link,startedAt -q "$q|.bucket" 2>/dev/null)
  case $B in pass|fail|cancel) break;; esac
  sleep 20
done
L=$(gh pr checks "$1" -R "$R" --json name,bucket,link,startedAt -q "$q|.link" | sed -E 's#.*/runs/([0-9]+).*#\1#')
echo "$B $L"
