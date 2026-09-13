#!/usr/bin/env bash
# Runbook sections 3, 4 and 4bis on GitHub or GitLab: the six User Stories, the BUILD and RUN
# streams, the four promotions, the release notes and the retrofit, with an assertion on every job
# log and a DevOps Pipeline check before and after every promotion operation.
#
#   export PROVIDER=github|gitlab ORG WORK LOGS DEV API EXT EXPECT <the provider library variables>
#   bash promotion-run.sh
#
# The repository must exist and hold main, integration, uat and preprod (build-repo.sh, pushed).
# Prints one line per assertion and writes $LOGS/results-section4.txt; every Pull Request number the
# run gets is appended to $LOGS/promo-vars.sh, so the edge cases of section 6 can pick up from there.
set -uo pipefail
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${PROVIDER:?set PROVIDER to github or gitlab}"
: "${EXPECT:?set EXPECT to a folder for the pipeline expectations}"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/promotion-provider.sh"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/stories.sh"
mkdir -p "$LOGS" "$EXPECT"
cd "$WORK" || exit 1

RESULTS="$LOGS/results-section4.txt"
: >"$RESULTS"
: >"$LOGS/promo-vars.sh"
remember() {
  export "$1=$2"
  printf 'export %s="%s"\n' "$1" "$2" >>"$LOGS/promo-vars.sh"
}

# ------------------------------------------------------------------ section 3, the stories
BODIES="$(cygpath -m "$LOGS" 2>/dev/null || echo "$LOGS")/bodies"
mkdir -p "$BODIES"
cat >"$BODIES/s1.md" <<'MD'
Story S1 alpha, build stream.

```yaml
deploymentApexTestClasses:
  - PromoE2EAlphaTest
```

A second block, on purpose: the union of both must be selected.

```yaml
deploymentApexTestClasses:
  - PromoE2EBetaTest
```
MD
cat >"$BODIES/s2.md" <<'MD'
Story S2 beta, build stream.

This one must be deployed in full: NO_DELTA
MD
cat >"$BODIES/s3.md" <<'MD'
Story S3 gamma, build stream.

```yaml
deploymentApexTestClasses:
  - PromoE2EBetaTest
```

Old flow versions have to go: PURGE_FLOW_VERSIONS
MD
cat >"$BODIES/s4.md" <<'MD'
Story S4 delta, validated directly in uat.

```yaml
deploymentApexTestClasses:
  - PromoE2EAlphaTest
```
MD
cat >"$BODIES/s5.md" <<'MD'
Story S5 epsilon, validated directly in uat. No test class, no keyword.
MD
cat >"$BODIES/s6.md" <<'MD'
Story S6 hotfix, run stream, straight into preprod.

```yaml
deploymentApexTestClasses:
  - PromoE2EBetaTest
```

FLOW_DELETE_INTERVIEWS
MD

open_story() {
  local branch="$1" target="$2" resource="$3" title="$4" body="$5" kind="$6" number
  story_branch "$branch" "$target" "$resource" >/dev/null 2>&1 || return 1
  number=$(p_open "$branch" "$target" "$title" "$body") || return 1
  story_actions "$branch" "$number" "$kind" >/dev/null 2>&1 || return 1
  echo "$number"
}

echo "=== section 3: the six User Stories ==="
S1=$(open_story feature/E2E-101-alpha integration E2E_S1 "E2E-101 S1 alpha" "$BODIES/s1.md" pre-command+post-manual) || exit 1
S2=$(open_story feature/E2E-102-beta integration E2E_S2 "E2E-102 S2 beta" "$BODIES/s2.md" post-command) || exit 1
S3=$(open_story feature/E2E-103-gamma integration E2E_S3 "E2E-103 S3 gamma" "$BODIES/s3.md" pre-command) || exit 1
S4=$(open_story feature/E2E-201-delta uat E2E_S4 "E2E-201 S4 delta" "$BODIES/s4.md" pre-command+post-manual) || exit 1
S5=$(open_story feature/E2E-202-epsilon uat E2E_S5 "E2E-202 S5 epsilon" "$BODIES/s5.md" post-command) || exit 1
S6=$(open_story feature/E2E-301-hotfix preprod E2E_S6 "E2E-301 S6 hotfix" "$BODIES/s6.md" pre-command+post-manual) || exit 1
for v in S1 S2 S3 S4 S5 S6; do remember "$v" "${!v}"; done
echo "S1=$S1 S2=$S2 S3=$S3 S4=$S4 S5=$S5 S6=$S6"

# ------------------------------------------------------------------ assertion helpers
record() { echo "$1 | $2 | $3" | tee -a "$RESULTS"; }
# Usage: assert_log <id> <label> <expected exit or -> <description> <pattern>... ; a pattern starting
# with ! must NOT be in the log
assert_log() {
  local id="$1" label="$2" want="$3" desc="$4" problems="" pat code
  shift 4
  code=$(tail -1 "$LOGS/$label.code" 2>/dev/null || echo "?")
  if [ "$want" != "-" ] && [ "$code" != "$want" ]; then
    problems+=" exit=$code (expected $want);"
  fi
  for pat in "$@"; do
    if [ "${pat:0:1}" = "!" ]; then
      grep -aqE -- "${pat:1}" "$LOGS/$label.log" && problems+=" unexpected [${pat:1}];"
    else
      grep -aqE -- "$pat" "$LOGS/$label.log" || problems+=" missing [$pat];"
    fi
  done
  if [ -z "$problems" ]; then
    record "$id" OK "$label: $desc"
  else
    record "$id" FAIL "$label: $desc:$problems"
  fi
}
# Run a job and keep its exit code next to its log
job() {
  local fn="$1" label
  shift
  case "$fn" in
  p_check) label="$3" ;;
  p_deploy) label="$2" ;;
  p_promote) label="$3" ;;
  p_release_notes) label="$1" ;;
  esac
  "$fn" "$@"
  echo $? >"$LOGS/$label.code"
}
promo_number() { grep -aoE "Promotion Pull Request created: \S+" "$LOGS/$1.log" | grep -oE "[0-9]+$" | tail -1; }
promo_branch() { grep -aoE "Promotion branch \S+ assembled" "$LOGS/$1.log" | awk '{print $3}' | tail -1; }
expect() { printf '%s\n' "$2" >"$EXPECT/$1.json"; }
pipeline() {
  local label="$1"
  pipeline_check "$label" "$EXPECT/$label.json" >/dev/null 2>&1
  local code=$?
  if [ "$code" = "0" ]; then
    record "$label" OK "$(grep -aE '^(integration|uat|preprod|main) ' "$LOGS/$label.log" | tr -s ' ' | tr '\n' ';')"
  else
    record "$label" FAIL "$(grep -aE 'FAIL|Error|Cannot' "$LOGS/$label.log" | head -6 | tr '\n' ';')"
  fi
}
esc() { printf '%s' "$1" | sed 's/[][\.*^$/]/\\&/g'; }

# ------------------------------------------------------------------ section 4, BUILD stream
echo "=== section 4: BUILD stream into integration ==="
for n in "$S1" "$S2" "$S3"; do job p_check "$n" integration "check-pr$n"; done
assert_log 1 "check-pr$S1" 0 "scope #$S1 alone, the union of the two yaml blocks, RunSpecifiedTests" \
  "Pull Request scope: 1 Pull Request\(s\) \(#$S1\)" "^ - PromoE2EAlphaTest" "^ - PromoE2EBetaTest" "Final test level: RunSpecifiedTests" \
  "Skipping E2E manual step of PR $S1 .*deployment-only action"
assert_log 2 "check-pr$S2" 0 "NO_DELTA read, FULL deployment, NoTestRun" \
  "Pull Request scope: 1 Pull Request\(s\) \(#$S2\)" "Delta deployment has been disabled for this Pull Request" "Deployment mode: FULL" "Final test level: NoTestRun"
assert_log 3 "check-pr$S3" 0 "PURGE_FLOW_VERSIONS adds a pre-deploy action, skipped in a validation job" \
  "Pull Request scope: 1 Pull Request\(s\) \(#$S3\)" "Purge Flow Versions \(added from PR config\)" "Skipping Purge Flow Versions \(added from PR config\): deployment-only action"
for n in "$S1" "$S2" "$S3"; do
  p_merge "$n" >/dev/null || record "merge-$n" FAIL "merge of #$n"
  job p_deploy integration "deploy-integration-pr$n"
done
assert_log 4a "deploy-integration-pr$S1" 0 "actions already run are skipped, the manual action runs" \
  "Pull Request scope: 1 Pull Request\(s\) \(#$S1\)" "Skipping E2E pre-deploy of PR $S1 \(from PR #$S1\): already run in integration" "Running action E2E manual step of PR $S1" "Successfully (deployed|processed QuickDeploy)"
assert_log 4b "deploy-integration-pr$S2" 0 "scope #$S2, FULL" "Pull Request scope: 1 Pull Request\(s\) \(#$S2\)" "Deployment mode: FULL" "Successfully (deployed|processed QuickDeploy)"
assert_log 4c "deploy-integration-pr$S3" 0 "scope #$S3, Purge Flow Versions runs" "Pull Request scope: 1 Pull Request\(s\) \(#$S3\)" "Running action Purge Flow Versions" "Successfully (deployed|processed QuickDeploy)"

expect pipeline-before-p1 "{ \"label\": \"before the integration -> uat promotion\",
  \"windows\": { \"integration\": [$S1, $S2, $S3], \"uat\": [], \"preprod\": [], \"main\": [] },
  \"arrows\": { \"integration>uat\": null, \"uat>preprod\": null, \"preprod>main\": null } }"
pipeline pipeline-before-p1

echo "=== P1: integration -> uat carrying S1 and S3 ==="
job p_promote integration "$S1,$S3" promotion-integration-uat
P1=$(promo_number promotion-integration-uat)
P1_BRANCH=$(promo_branch promotion-integration-uat)
remember P1 "$P1"
remember P1_BRANCH "$P1_BRANCH"
assert_log 6 promotion-integration-uat 0 "P1 #$P1 carries #$S1 and #$S3, one candidate row per story" \
  "^#$S1 +\|" "^#$S2 +\|" "^#$S3 +\|" "assembled with 2 User Story\(ies\): #$S1, #$S3" "Promotion Pull Request created"

expect pipeline-p1-open "{ \"label\": \"the integration -> uat promotion is open, not merged\",
  \"windows\": { \"integration\": [$S1, $S2, $S3], \"uat\": [], \"preprod\": [], \"main\": [] },
  \"arrows\": { \"integration>uat\": $P1 },
  \"noFeatureNodeFor\": [\"$P1_BRANCH\"] }"
pipeline pipeline-p1-open

job p_check "$P1" uat check-promotion-uat
assert_log 8 check-promotion-uat 0 "scope #$S1, #$S3, #$P1, PURGE_FLOW_VERSIONS inherited, no NO_DELTA, union of the test classes" \
  "$(esc "$P1_BRANCH") \(Pull Request $P1\): 2 Pull Request\(s\) declared in its description: #$S1, #$S3" \
  "Pull Request scope: 3 Pull Request\(s\) \(#$S1, #$S3, #$P1\)" "Inherited PURGE_FLOW_VERSIONS from carried Pull Request\(s\) #$S3" \
  "!Inherited NO_DELTA" "^ - PromoE2EAlphaTest" "^ - PromoE2EBetaTest" "Final test level: RunSpecifiedTests"
p_merge "$P1" >/dev/null || record "merge-$P1" FAIL "merge of #$P1"
job p_deploy uat deploy-uat-promotion
assert_log 9 deploy-uat-promotion 0 "Purge Flow Versions runs, the manual action of #$S1 runs in uat" \
  "Pull Request scope: 3 Pull Request\(s\) \(#$S1, #$S3, #$P1\)" "Running action Purge Flow Versions" "Running action E2E manual step of PR $S1" "Successfully (deployed|processed QuickDeploy)"

expect pipeline-after-p1 "{ \"label\": \"after the integration -> uat promotion was merged\",
  \"windows\": { \"integration\": [$S2], \"uat\": [$S1, $S3], \"preprod\": [], \"main\": [] },
  \"arrows\": { \"integration>uat\": null } }"
pipeline pipeline-after-p1

echo "=== stories validated directly in uat ==="
for n in "$S4" "$S5"; do job p_check "$n" uat "check-pr$n"; done
assert_log 11a "check-pr$S4" 0 "scope #$S4 alone" "Pull Request scope: 1 Pull Request\(s\) \(#$S4\)" "^ - PromoE2EAlphaTest"
assert_log 11b "check-pr$S5" 0 "scope #$S5 alone" "Pull Request scope: 1 Pull Request\(s\) \(#$S5\)"
for n in "$S4" "$S5"; do
  p_merge "$n" >/dev/null || record "merge-$n" FAIL "merge of #$n"
  job p_deploy uat "deploy-uat-pr$n"
done
assert_log 11c "deploy-uat-pr$S4" 0 "scope #$S4" "Pull Request scope: 1 Pull Request\(s\) \(#$S4\)" "Successfully (deployed|processed QuickDeploy)"
assert_log 11d "deploy-uat-pr$S5" 0 "scope #$S5" "Pull Request scope: 1 Pull Request\(s\) \(#$S5\)" "Successfully (deployed|processed QuickDeploy)"

expect pipeline-before-p2 "{ \"label\": \"before the uat -> preprod promotion\",
  \"windows\": { \"integration\": [$S2], \"uat\": [$S1, $S3, $S4, $S5], \"preprod\": [], \"main\": [] },
  \"arrows\": { \"uat>preprod\": null } }"
pipeline pipeline-before-p2

echo "=== P2: uat -> preprod carrying S4 ==="
job p_promote uat "$S4" promotion-uat-preprod
P2=$(promo_number promotion-uat-preprod)
P2_BRANCH=$(promo_branch promotion-uat-preprod)
remember P2 "$P2"
remember P2_BRANCH "$P2_BRANCH"
assert_log 12 promotion-uat-preprod 0 "the P1 merge is opened up into rows #$S1 and #$S3; P2 #$P2 carries #$S4" \
  "^#$S1 +\|" "^#$S3 +\|" "^#$S4 +\|" "^#$S5 +\|" "!^#$P1 " "assembled with 1 User Story\(ies\): #$S4"
expect pipeline-p2-open "{ \"label\": \"the uat -> preprod promotion is open\",
  \"windows\": { \"integration\": [$S2], \"uat\": [$S1, $S3, $S4, $S5], \"preprod\": [], \"main\": [] },
  \"arrows\": { \"uat>preprod\": $P2 },
  \"noFeatureNodeFor\": [\"$P2_BRANCH\"] }"
pipeline pipeline-p2-open
job p_check "$P2" preprod check-promotion-preprod
assert_log 13a check-promotion-preprod 0 "scope #$S4, #$P2" "Pull Request scope: 2 Pull Request\(s\) \(#$S4, #$P2\)" "^ - PromoE2EAlphaTest"
p_merge "$P2" >/dev/null || record "merge-$P2" FAIL "merge of #$P2"
job p_deploy preprod deploy-preprod-promotion
assert_log 13b deploy-preprod-promotion 0 "scope #$S4, #$P2, manual action of #$S4 runs in preprod" \
  "Pull Request scope: 2 Pull Request\(s\) \(#$S4, #$P2\)" "Running action E2E manual step of PR $S4" "Successfully (deployed|processed QuickDeploy)"

expect pipeline-before-p3 "{ \"label\": \"before promoting a story that arrived through P1\",
  \"windows\": { \"integration\": [$S2], \"uat\": [$S1, $S3, $S5], \"preprod\": [$S4], \"main\": [] },
  \"arrows\": { \"uat>preprod\": null } }"
pipeline pipeline-before-p3

echo "=== P3: uat -> preprod carrying S3 alone ==="
job p_promote uat "$S3" promotion-uat-preprod-nested
P3=$(promo_number promotion-uat-preprod-nested)
P3_BRANCH=$(promo_branch promotion-uat-preprod-nested)
remember P3 "$P3"
remember P3_BRANCH "$P3_BRANCH"
assert_log 15 promotion-uat-preprod-nested 0 "promoting $S3 carries S3 alone, #$S4 marked already promoted" \
  "^#$S1 +\|" "^#$S3 +\|" "^#$S4 +\|.*$(esc "$P2_BRANCH")" "assembled with 1 User Story\(ies\): #$S3" "Cherry-picking #$S3 " "!Cherry-picking #$S1 "
expect pipeline-p3-open "{ \"label\": \"P3 is open\",
  \"windows\": { \"integration\": [$S2], \"uat\": [$S1, $S3, $S5], \"preprod\": [$S4], \"main\": [] },
  \"arrows\": { \"uat>preprod\": $P3 },
  \"noFeatureNodeFor\": [\"$P3_BRANCH\"] }"
pipeline pipeline-p3-open
job p_check "$P3" preprod check-promotion-preprod-nested
assert_log 16a check-promotion-preprod-nested 0 "scope #$S3, #$P3, PURGE_FLOW_VERSIONS inherited" \
  "Pull Request scope: 2 Pull Request\(s\) \(#$S3, #$P3\)" "Inherited PURGE_FLOW_VERSIONS from carried Pull Request\(s\) #$S3"
p_merge "$P3" >/dev/null || record "merge-$P3" FAIL "merge of #$P3"
job p_deploy preprod deploy-preprod-promotion-nested
assert_log 16b deploy-preprod-promotion-nested 0 "scope #$S3, #$P3" "Pull Request scope: 2 Pull Request\(s\) \(#$S3, #$P3\)" "Successfully (deployed|processed QuickDeploy)"
expect pipeline-after-p3 "{ \"label\": \"after P3 was merged\",
  \"windows\": { \"integration\": [$S2], \"uat\": [$S1, $S5], \"preprod\": [$S3, $S4], \"main\": [] },
  \"arrows\": { \"uat>preprod\": null } }"
pipeline pipeline-after-p3

echo "=== RUN stream: hotfix into preprod ==="
job p_check "$S6" preprod "check-pr$S6-hotfix"
assert_log 17a "check-pr$S6-hotfix" 0 "scope #$S6" "Pull Request scope: 1 Pull Request\(s\) \(#$S6\)" "^ - PromoE2EBetaTest"
p_merge "$S6" >/dev/null || record "merge-$S6" FAIL "merge of #$S6"
job p_deploy preprod "deploy-preprod-pr$S6"
assert_log 17b "deploy-preprod-pr$S6" 0 "scope #$S6, manual action runs in preprod" "Pull Request scope: 1 Pull Request\(s\) \(#$S6\)" "Running action E2E manual step of PR $S6"

echo "=== P4: preprod -> main carrying S4, S3 and S6 ==="
job p_promote preprod "$S4,$S3,$S6" promotion-preprod-main
P4=$(promo_number promotion-preprod-main)
P4_BRANCH=$(promo_branch promotion-preprod-main)
remember P4 "$P4"
remember P4_BRANCH "$P4_BRANCH"
assert_log 18 promotion-preprod-main 0 "P4 #$P4 carries #$S4, #$S3, #$S6, no promotion number offered" \
  "^#$S3 +\|" "^#$S4 +\|" "^#$S6 +\|" "!^#$P2 " "!^#$P3 " "assembled with 3 User Story\(ies\)"
expect pipeline-p4-open "{ \"label\": \"P4 is open\",
  \"windows\": { \"integration\": [$S2], \"uat\": [$S1, $S5], \"preprod\": [$S3, $S4, $S6], \"main\": [] },
  \"arrows\": { \"preprod>main\": $P4 },
  \"noFeatureNodeFor\": [\"$P4_BRANCH\"] }"
pipeline pipeline-p4-open
job p_check "$P4" main check-promotion-main
assert_log 19a check-promotion-main 0 "scope #$S4, #$S3, #$S6, #$P4, both keywords inherited" \
  "Pull Request scope: 4 Pull Request\(s\)" "Inherited PURGE_FLOW_VERSIONS from carried Pull Request\(s\) #$S3" "Inherited FLOW_DELETE_INTERVIEWS from carried Pull Request\(s\) #$S6" "!Inherited NO_DELTA"
p_merge "$P4" >/dev/null || record "merge-$P4" FAIL "merge of #$P4"
job p_deploy main deploy-main-promotion
assert_log 19b deploy-main-promotion 0 "manual actions of #$S4 and #$S6 run in main" \
  "Pull Request scope: 4 Pull Request\(s\)" "Running action E2E manual step of PR $S4" "Running action E2E manual step of PR $S6" "Successfully (deployed|processed QuickDeploy)"

expect pipeline-after-golive "{ \"label\": \"after the go-live\",
  \"windows\": { \"integration\": [$S2], \"uat\": [$S1, $S5], \"preprod\": [], \"main\": [$S3, $S4, $S6] },
  \"arrows\": { \"preprod>main\": null } }"
pipeline pipeline-after-golive

echo "=== release notes ==="
job p_release_notes release-notes
# shellcheck disable=SC2012 # newest release notes folder first, the names are generated by sfdx-hardis
RN_DIR=$(ls -td "$WORK"/hardis-report/release-notes/main-* 2>/dev/null | head -1)
# shellcheck disable=SC2012 # the file names are generated by sfdx-hardis
RN_FILE=$(ls "$RN_DIR"/release-notes-main-*.md 2>/dev/null | head -1)
cp "$RN_FILE" "$LOGS/release-notes-plain.md" 2>/dev/null
assert_log 21 release-notes 0 "release notes generated" "Release notes generated successfully"
# GitHub writes #N, GitLab !N
rn_has() { grep -qE "[#!]$1([^0-9]|$)" "$2"; }
rn_numbers() { grep -oE '[#!][0-9]+' "$1" 2>/dev/null | sort -u | tr '\n' ' '; }
if [ -f "$LOGS/release-notes-plain.md" ] && rn_has "$S3" "$LOGS/release-notes-plain.md" && rn_has "$S4" "$LOGS/release-notes-plain.md" && rn_has "$S6" "$LOGS/release-notes-plain.md" && ! rn_has "$P4" "$LOGS/release-notes-plain.md"; then
  record 21b OK "release notes list #$S3 #$S4 #$S6, not the vehicle #$P4 ($(rn_numbers "$LOGS/release-notes-plain.md"))"
else
  record 21b FAIL "release notes content: $(rn_numbers "$LOGS/release-notes-plain.md")"
fi
job p_release_notes release-notes-all --include-promotions
cp "$RN_FILE" "$LOGS/release-notes-all.md" 2>/dev/null
if rn_has "$P4" "$LOGS/release-notes-all.md" && rn_has "$S3" "$LOGS/release-notes-all.md"; then
  record 22 OK "--include-promotions lists the vehicle #$P4 next to the stories ($(rn_numbers "$LOGS/release-notes-all.md"))"
else
  record 22 FAIL "--include-promotions content: $(rn_numbers "$LOGS/release-notes-all.md")"
fi

echo "=== retrofit main into integration ==="
git checkout -q -f integration && git pull -q origin integration
git checkout -q -B retrofit/from-main
git merge -q origin/main -m "chore: retrofit main into the BUILD stream" >/dev/null 2>&1
git push -q -f -u origin retrofit/from-main
printf 'Retrofit of the go-live into the BUILD stream.\n' >"$BODIES/retrofit.md"
R=$(p_open retrofit/from-main integration "Retrofit main into integration" "$BODIES/retrofit.md") || exit 1
remember R "$R"
job p_check "$R" integration check-retrofit
assert_log 23a check-retrofit 0 "the go-live promotion is expanded, the stories named as already deployed" \
  "Promotion Pull Request $P4 adds 3 carried Pull Request\(s\) to the scope" \
  "Pull Request $S4 was already deployed through promotion branch\(es\)" "Pull Request $S3 was already deployed through promotion branch\(es\)" "Pull Request $S6 was already deployed through promotion branch\(es\)"
p_merge "$R" >/dev/null || record "merge-$R" FAIL "merge of #$R"
job p_deploy integration deploy-integration-retrofit
assert_log 23b deploy-integration-retrofit 0 "already performed actions skipped" \
  "Promotion Pull Request $P4 adds [0-9]+ carried Pull Request\(s\) to the scope" "already deployed through promotion branch\(es\)" "Skipping E2E pre-deploy of PR $S4 \(from PR #$S4\): already run in integration"
expect pipeline-after-retrofit "{ \"label\": \"after the retrofit\", \"windows\": { \"main\": [$S3, $S4, $S6] } }"
pipeline pipeline-after-retrofit

echo
echo "=== section 4 summary ==="
echo "$(grep -c '| OK |' "$RESULTS") OK"
echo "$(grep -c '| FAIL |' "$RESULTS") FAIL"
grep "| FAIL |" "$RESULTS" || true
echo "SECTION 4 DONE"
