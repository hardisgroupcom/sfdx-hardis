#!/usr/bin/env bash
# Runs hardis:project:promotion:list-candidates --json on both steps of the test repository, for
# each CLI build given, with detectManualCherryPicks off then on, and writes the results.
#
#   GL_HOST=... GL_TOKEN=... WORK=<clone> OUT=<folder> \
#     bash run-cli.sh main=/path/to/main/bin/run.js new=/path/to/branch/bin/run.js
#
# Writes $OUT/<name>-<off|on>-<source>-<target>.json (the `result`, sorted keys) and
# $OUT/durations.txt. The setting is switched in the working copy only, never committed.
set -euo pipefail
: "${GL_HOST:?}" "${GL_TOKEN:?}" "${WORK:?}" "${OUT:?}"
# shellcheck source=/dev/null
source "$WORK/../e2e-state"
mkdir -p "$OUT"
CONFIG="$WORK/config/.sfdx-hardis.yml"
STEPS=("integration uat" "uat preprod")

set_setting() {
  sed -i "s/^detectManualCherryPicks: .*/detectManualCherryPicks: $1/" "$CONFIG"
}
trap 'git -C "$WORK" checkout -q -- config/.sfdx-hardis.yml' EXIT

cd "$WORK"
for build in "$@"; do
  name="${build%%=*}"
  runjs="${build#*=}"
  for setting in off on; do
    set_setting "$([ "$setting" = on ] && echo true || echo false)"
    for step in "${STEPS[@]}"; do
      read -r source target <<<"$step"
      file="$OUT/$name-$setting-$source-$target.json"
      start=$(date +%s)
      env -u NODE_OPTIONS CI=true CI_SFDX_HARDIS_GITLAB_TOKEN="$GL_TOKEN" CI_SERVER_URL="$GL_HOST" \
        CI_PROJECT_ID="$PROJECT_ID" CI_PROJECT_PATH="$PROJECT_PATH" CI_PROJECT_URL="$GL_HOST/$PROJECT_PATH" \
        node "$runjs" hardis:project:promotion:list-candidates --agent --json \
        --source-branch "$source" --target-branch "$target" >"$file.raw" 2>"$file.err" || true
      echo "$name $setting $source>$target $(($(date +%s) - start))s" | tee -a "$OUT/durations.txt"
      python -c "
import json, sys
raw = open(sys.argv[1], encoding='utf-8').read()
data = json.loads(raw[raw.index('{'):])
json.dump(data.get('result', data), open(sys.argv[2], 'w', encoding='utf-8'), indent=1, sort_keys=True)
" "$file.raw" "$file"
    done
  done
done
