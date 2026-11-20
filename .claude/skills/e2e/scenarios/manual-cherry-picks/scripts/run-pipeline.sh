#!/usr/bin/env bash
# Dumps what the DevOps Pipeline of the extension shows for the test repository (check-pipeline.cjs
# of the promotion-branches scenario: the real PipelineDataProvider, the real `sf` on the PATH for
# the manual cherry-pick listings), with detectManualCherryPicks set as asked.
#
#   GL_HOST=... GL_TOKEN=... WORK=<clone> EXT=<compiled extension> \
#     bash run-pipeline.sh <off|on> <dump.json>
set -euo pipefail
: "${GL_HOST:?}" "${GL_TOKEN:?}" "${WORK:?}" "${EXT:?}"
setting="$1"
dump="$2"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$WORK/../e2e-state"
CONFIG="$WORK/config/.sfdx-hardis.yml"
sed -i "s/^detectManualCherryPicks: .*/detectManualCherryPicks: $([ "$setting" = on ] && echo true || echo false)/" "$CONFIG"
trap 'git -C "$WORK" checkout -q -- config/.sfdx-hardis.yml' EXIT
# The CLI the extension starts reads the GitLab connection from these, as from VS Code
env -u NODE_OPTIONS EXT="$EXT" WORK="$WORK" PROVIDER_TOKEN="$GL_TOKEN" \
  CI_SFDX_HARDIS_GITLAB_TOKEN="$GL_TOKEN" CI_SERVER_URL="$GL_HOST" CI_PROJECT_ID="$PROJECT_ID" \
  CI_PROJECT_PATH="$PROJECT_PATH" CI_PROJECT_URL="$GL_HOST/$PROJECT_PATH" \
  node "$HERE/../../promotion-branches/scripts/check-pipeline.cjs" --dump "$dump"
