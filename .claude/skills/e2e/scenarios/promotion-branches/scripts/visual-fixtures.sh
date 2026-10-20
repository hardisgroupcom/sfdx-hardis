#!/usr/bin/env bash
# Runbook section 5quater: the comments a green run never leaves behind, for the visual check.
# A failed validation is updated in place by the run that follows it, so at the end of a run no
# Pull Request shows one. This opens two stories and leaves them failed and open:
#
#   VE  an Apex class that does not compile: the validation comment of a deployment error
#   VG  a pre-deployment manual action nobody marked as done: the validation stopped at the gate
#
#   export PROVIDER=github|gitlab|azure|bitbucket <the provider library variables>
#   bash visual-fixtures.sh        # after deployment-actions-run.sh, which turns the gate on
#
# Then dump_pr_comments and check-comments-visual.cjs see the types validation-failed and
# validation-failed+manual. Nothing is merged: the two Pull Requests stay open.
set -uo pipefail
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${PROVIDER:?set PROVIDER to github, gitlab, azure or bitbucket}"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/env-lib.sh"
e2e_defaults "promo-e2e-$PROVIDER"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/promotion-provider.sh"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/stories.sh"
mkdir -p "$LOGS"
cd "$WORK" || exit 1
RESULTS="$LOGS/results-visual-fixtures.txt"
: >"$RESULTS"
BODIES="$(cygpath -m "$LOGS" 2>/dev/null || echo "$LOGS")/bodies"
mkdir -p "$BODIES"
RUN="${VF_RUN:-1}"

record() {
  echo "$1 | $2 | $3" | tee -a "$RESULTS"
}
# Usage: expect_failed <id> <label> <description> <pattern>
expect_failed() {
  local code
  code=$(cat "$LOGS/$2.code" 2>/dev/null || echo "?")
  if grep -aqE -- "$4" "$LOGS/$2.log" 2>/dev/null; then
    record "$1" OK "$2: $3"
  else
    record "$1" FAIL "$2: $3 (exit $code, missing [$4])"
  fi
}

# VE: a class that does not compile
printf 'Visual fixture: a deployment error, left failed on purpose.\n' >"$BODIES/visual-error.md"
story_branch "feature/E2E-951-visual-error-$RUN" integration "E2E_VE$RUN" >/dev/null 2>&1 || exit 1
mkdir -p force-app/main/default/classes
cat >"force-app/main/default/classes/PromoE2EBroken$RUN.cls" <<APEX
public class PromoE2EBroken$RUN {
    public static String label() {
        return missingVariable + 1;
    }
}
APEX
cat >"force-app/main/default/classes/PromoE2EBroken$RUN.cls-meta.xml" <<META
<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>$API</apiVersion>
    <status>Active</status>
</ApexClass>
META
git add "force-app/main/default/classes/PromoE2EBroken$RUN.cls" "force-app/main/default/classes/PromoE2EBroken$RUN.cls-meta.xml"
git commit -qm "feat: a class that does not compile"
git push -q origin "feature/E2E-951-visual-error-$RUN"
VE=$(p_open "feature/E2E-951-visual-error-$RUN" integration "E2E-951 visual fixture, deployment error" "$BODIES/visual-error.md") || exit 1
echo "VE=#$VE"
p_wait_merge_ref "$VE" "$(git rev-parse HEAD)" >/dev/null 2>&1
p_check "$VE" integration visual-check-error
expect_failed VE visual-check-error "the validation fails on the class that does not compile" "PromoE2EBroken$RUN"

# VG: a pre-deployment manual action nobody marked as done
printf 'Visual fixture: a pending manual action, left at the gate on purpose.\n' >"$BODIES/visual-gate.md"
story_branch "feature/E2E-952-visual-gate-$RUN" integration "E2E_VG$RUN" >/dev/null 2>&1 || exit 1
VG=$(p_open "feature/E2E-952-visual-gate-$RUN" integration "E2E-952 visual fixture, manual action gate" "$BODIES/visual-gate.md") || exit 1
echo "VG=#$VG"
story_actions "feature/E2E-952-visual-gate-$RUN" "$VG" pre-manual >/dev/null 2>&1 || exit 1
p_wait_merge_ref "$VG" "$(git -C "$WORK" rev-parse HEAD)" >/dev/null 2>&1
p_check "$VG" integration visual-check-gate
expect_failed VG visual-check-gate "the validation stops on the manual action" "pre-deployment manual action\(s\) not marked as performed in integration"

printf 'export VE="%s" VG="%s"\n' "$VE" "$VG" >>"$LOGS/promo-vars.sh"
echo "VISUAL FIXTURES DONE"
grep -c "| FAIL |" "$RESULTS" | sed 's/$/ FAIL/'
