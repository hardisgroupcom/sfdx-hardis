#!/usr/bin/env bash
# Runbook section 6, the edge cases, on GitHub or GitLab, after promotion-run.sh. Each group builds on
# the state the previous one left, so run them in order: bash promotion-edge.sh g1 g2 g3 g4 g5 g6
#
#   export PROVIDER=github|gitlab ORG WORK LOGS DEV API EXT EXPECT <the provider library variables>
#   bash promotion-edge.sh g1 [g2 ...]
#
# Appends one line per assertion to $LOGS/results-section6.txt and every number it gets to
# $LOGS/promo-vars.sh.
# ok_if reads the exit status of the test on the line above it, which is the point of each check.
# shellcheck disable=SC2319
set -uo pipefail
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${PROVIDER:?set PROVIDER to github or gitlab}"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/promotion-provider.sh"
# shellcheck source=/dev/null
source "$LOGS/promo-vars.sh"
cd "$WORK" || exit 1
RESULTS="$LOGS/results-section6.txt"
touch "$RESULTS"
BODIES="$(cygpath -m "$LOGS" 2>/dev/null || echo "$LOGS")/bodies"
mkdir -p "$BODIES"
RES_DIR=force-app/main/default/staticresources
LABELS=force-app/main/default/labels/CustomLabels.labels-meta.xml

remember() {
  export "$1=$2"
  printf 'export %s="%s"\n' "$1" "$2" >>"$LOGS/promo-vars.sh"
}
record() { echo "$1 | $2 | $3" | tee -a "$RESULTS"; }
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
ok_if() { if [ "$2" = "0" ]; then record "$1" OK "$3"; else record "$1" FAIL "$3"; fi; }
# Run a function, keep its exit code next to the log named by the label argument at position $2
job() {
  local pos="$1" fn="$2"
  shift 2
  local label="${!pos}"
  "$fn" "$@"
  echo $? >"$LOGS/$label.code"
}
promo_number() { grep -aoE "Promotion Pull Request created: \S+" "$LOGS/$1.log" | grep -oE "[0-9]+$" | tail -1; }
promo_branch() { grep -aoE "Promotion branch \S+ assembled" "$LOGS/$1.log" | awk '{print $3}' | tail -1; }
esc() { printf '%s' "$1" | sed 's/[][\.*^$/|()+?{}]/\\&/g'; }
count_in_log() { grep -ac -- "$2" "$LOGS/$1.log"; }
remote_promotion_branches() { git ls-remote --heads origin "refs/heads/promotion/*" | wc -l | tr -d ' '; }
local_promotion_branches() { git branch --list "promotion/*" | wc -l | tr -d ' '; }
tree_dirty_outside_reports() { git status --porcelain -- . ':(exclude)hardis-report' ':(exclude)hardis-report/**'; }

# A story branch from <base> with a change written by a shell command, pushed, opened, merged.
# Usage: story <branch> <base> <target> <title> <commit message> <shell command> [merge|open]
story() {
  local branch="$1" base="$2" target="$3" title="$4" message="$5" change="$6" what="${7:-merge}" number
  git checkout -q -f "$base" && git pull -q origin "$base"
  git checkout -q -B "$branch"
  eval "$change"
  git add -A -- force-app NOTES.md config scripts 2>/dev/null
  git commit -q -m "$message" || return 1
  git push -q -f -u origin "$branch" 2>/dev/null || return 1
  mkdir -p "$(dirname "$BODIES/$branch.md")"
  printf '%s\n' "$title, section 6 edge case." >"$BODIES/$branch.md"
  number=$(p_open "$branch" "$target" "$title" "$BODIES/$branch.md") || return 1
  if [ "$what" = "merge" ]; then
    p_merge "$number" >/dev/null || return 1
  fi
  echo "$number"
}
new_resource() {
  printf 'promotion branches end to end test: %s\n' "$1" >"$RES_DIR/$1.resource"
  # written here, never copied from another story: that story may not be on the base branch
  mkdir -p "$RES_DIR"
  printf '<?xml version="1.0" encoding="UTF-8"?>
<StaticResource xmlns="http://soap.sforce.com/2006/04/metadata">
    <cacheControl>Public</cacheControl>
    <contentType>text/plain</contentType>
    <description>%s</description>
</StaticResource>
' "$1" >"$RES_DIR/$1.resource-meta.xml"
}
set_label() { sed -i -E "s#<value>[^<]*</value>#<value>$1</value>#" "$LABELS"; }
set_notes() { printf '# Promotion branches end to end test\n\nShared notes, %s.\n' "$1" >NOTES.md; }
solve_take_theirs() {
  # keep the story side (after =======) of every conflict block
  node -e "const fs=require('fs');for(const f of process.argv.slice(1)){const s=fs.readFileSync(f,'utf8');fs.writeFileSync(f,s.replace(/<<<<<<<[^\n]*\r?\n[\s\S]*?(?:\|\|\|\|\|\|\|[^\n]*\r?\n[\s\S]*?)?=======\r?\n([\s\S]*?)>>>>>>>[^\n]*\r?\n?/g,(m,b)=>b))}" "$@"
}

g1() {
  echo "=== g1: already promoted, empty cherry-pick ==="
  local before before_local
  before=$(remote_promotion_branches)
  before_local=$(local_promotion_branches)
  job 3 p_promote uat "$S4" edge-already-promoted
  # shellcheck disable=SC2153 # P2_BRANCH is written to promo-vars.sh by promotion-run.sh
  assert_log 24 edge-already-promoted 1 "already promoted: the table marks it, the warning names --include-already-promoted, no branch" \
    "^#$S4 +\|.*$(esc "$P2_BRANCH")" "Use --include-already-promoted" "#$S4 are not among the Pull Requests waiting for promotion"
  [ "$(remote_promotion_branches)" = "$before" ] && [ "$(local_promotion_branches)" = "$before_local" ]
  ok_if 24b $? "no promotion branch created ($(remote_promotion_branches) on origin, $(local_promotion_branches) local)"

  job 3 p_promote uat "$S4" edge-empty-cherrypick --include-already-promoted
  assert_log 25 edge-empty-cherrypick 0 "nothing to cherry-pick, branch undone, exit 0" \
    "Nothing to cherry-pick for #$S4 .*this change is already in the target branch" "Every selected User Story \(#$S4\) is already in preprod: there is nothing to promote and no branch was created" "!Cherry-pick conflict"
  [ -z "$(tree_dirty_outside_reports)" ] && [ "$(local_promotion_branches)" = "$before_local" ]
  ok_if 25b $? "tree clean outside hardis-report, no leftover branch"

  mkdir -p hardis-report && echo "dirty" >hardis-report/untracked-e2e.txt
  job 3 p_promote uat "$S4" edge-empty-cherrypick-dirty --include-already-promoted
  assert_log 26 edge-empty-cherrypick-dirty 0 "same result with an untracked file in hardis-report/" \
    "Nothing to cherry-pick for #$S4" "there is nothing to promote and no branch was created"
  rm -f hardis-report/untracked-e2e.txt
}

g2() {
  echo "=== g2: conflicts, marker guard, deployment from a promotion branch, feature off ==="
  C1=$(story feature/E2E-401-conflict-one integration integration "E2E-401 conflict one" "feat: conflict one" 'set_label one; set_notes "version one"') || return 1
  remember C1 "$C1"
  C2=$(story feature/E2E-402-conflict-two integration integration "E2E-402 conflict two" "feat: conflict two" 'set_label two; set_notes "version two"') || return 1
  remember C2 "$C2"
  echo "C1=$C1 C2=$C2"

  local before_local
  before_local=$(local_promotion_branches)
  job 3 p_promote integration "$C2" edge-conflict-agent-default
  assert_log 27 edge-conflict-agent-default 1 "agent default: conflict, promotion undone once, no leftover branch" \
    "Cherry-pick conflict on #$C2 .*\(NOTES.md, $LABELS\): the promotion has been undone" "!not found"
  [ "$(count_in_log edge-conflict-agent-default 'Undoing promotion branch')" = "1" ] && [ "$(local_promotion_branches)" = "$before_local" ]
  ok_if 27b $? "one 'Undoing promotion branch' line ($(count_in_log edge-conflict-agent-default 'Undoing promotion branch')), $(local_promotion_branches) local promotion branch"

  job 3 p_promote integration "$C2" edge-conflict-kept --on-conflict commit-with-markers
  P5=$(promo_number edge-conflict-kept)
  P5_BRANCH=$(promo_branch edge-conflict-kept)
  remember P5 "$P5"
  remember P5_BRANCH "$P5_BRANCH"
  assert_log 28 edge-conflict-kept 0 "conflict kept: Pull Request #$P5 created, prompt saved and embedded" \
    "committed with conflict markers in: NOTES.md, $LABELS" "Promotion Pull Request created" "promotion-conflicts-prompt-.*embedded in the Pull Request description"
  local prompt
  # shellcheck disable=SC2012 # newest prompt first, the names are generated by sfdx-hardis
  prompt=$(ls -t "$WORK"/hardis-report/promotion-conflicts-prompt-*.md 2>/dev/null | head -1)
  cp "$prompt" "$LOGS/conflict-prompt.md" 2>/dev/null
  p_body "$P5" >"$LOGS/p5-body.md"
  grep -qi "commit with a message" "$LOGS/conflict-prompt.md" && grep -q "NOTES.md" "$LOGS/conflict-prompt.md" && grep -qi "<details>" "$LOGS/p5-body.md"
  ok_if 29 $? "the prompt asks for a commit message naming each conflicting file, and the description embeds it"

  job 3 p_check "$P5" uat edge-marker-guard
  assert_log 31 edge-marker-guard 1 "marker guard: the job fails naming the two files" \
    "still contains git conflict markers in 2 file\(s\): NOTES.md, $LABELS"
  dump_pr_comments "$LOGS/p5-comments.json" "$P5" >/dev/null
  node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const b=d.prs[0].comments.map(c=>c.body).join('\n');process.exit(/conflict markers/i.test(b)&&b.includes('NOTES.md')&&b.includes('CustomLabels')?0:1)" "$(cygpath -m "$LOGS/p5-comments.json")"
  ok_if 31b $? "the validation comment of #$P5 carries the failure, the count and the files"

  # A committed conflict prompt report must not add a file to the gate
  git fetch -q origin "$P5_BRANCH" && git checkout -q -f -B "$P5_BRANCH" "origin/$P5_BRANCH"
  mkdir -p hardis-report && cp "$LOGS/conflict-prompt.md" hardis-report/promotion-conflicts-prompt-committed.md
  git add -f hardis-report/promotion-conflicts-prompt-committed.md && git commit -q -m "chore: keep the conflict prompt" && git push -q origin "$P5_BRANCH"
  p_wait_merge_ref "$P5" "$(git rev-parse HEAD)"
  job 3 p_check "$P5" uat edge-marker-guard-with-report
  assert_log 34 edge-marker-guard-with-report 1 "a committed prompt report adds nothing to the gate" "still contains git conflict markers in 2 file\(s\)"

  job 2 p_deploy_branch "$P5_BRANCH" edge-deploy-from-promotion-branch
  assert_log 36 edge-deploy-from-promotion-branch 1 "deployment from a promotion branch stops, naming the branch" \
    "The branch $(esc "$P5_BRANCH") is a promotion branch, so it may only run the validation job of its Pull Request"

  # Solve as the prompt says: keep the story side
  git fetch -q origin "$P5_BRANCH" && git checkout -q -f -B "$P5_BRANCH" "origin/$P5_BRANCH"
  solve_take_theirs NOTES.md "$LABELS"
  git add NOTES.md "$LABELS" && git commit -q -m "fix: solve the promotion conflicts" && git push -q origin "$P5_BRANCH"
  p_wait_merge_ref "$P5" "$(git rev-parse HEAD)"
  job 3 p_check "$P5" uat edge-marker-guard-solved
  assert_log 32 edge-marker-guard-solved 0 "markers solved: the validation passes" "Pull Request scope: 2 Pull Request\(s\) \(#$C2, #$P5\)" "!still contains git conflict markers"
  assert_log 33 edge-marker-guard 1 "a conflict outside force-app is caught" "markers in 2 file\(s\): NOTES.md"

  job 3 p_check_edited "$P5" uat edge-feature-off "sed -i 's/enablePromotionBranches: true/enablePromotionBranches: false/' config/.sfdx-hardis.yml"
  assert_log 37 edge-feature-off 0 "feature off: one informational line, scope = the Pull Request alone" \
    "Pull Request $P5 looks like a promotion branch, but enablePromotionBranches is not set" "Pull Request scope: 1 Pull Request\(s\) \(#$P5\)"
}

g3() {
  echo "=== g3: hand-named, retargeted, creation refused, supersede, sync merge, unreadable, grouped ==="
  local H RT
  git checkout -q -f uat && git pull -q origin uat
  git checkout -q -B promotion/hand-made-by-a-human
  new_resource E2E_HM
  git add "$RES_DIR/E2E_HM.resource" "$RES_DIR/E2E_HM.resource-meta.xml" && git commit -q -m "feat: hand made" && git push -q -f -u origin promotion/hand-made-by-a-human
  # shellcheck disable=SC2016 # the backticks are a markdown code fence, not a command
  printf 'A branch a human named by hand.\n\n```yaml\npromotionPullRequests:\n  - %s\n  - %s\n```\n' "$S1" "$S3" >"$BODIES/hand.md"
  H=$(p_open promotion/hand-made-by-a-human uat "Hand made promotion branch" "$BODIES/hand.md") || return 1
  remember H "$H"
  job 3 p_check "$H" uat edge-hand-named
  assert_log 38 edge-hand-named 0 "hand-named branch: warning, treated as a feature branch, declaration ignored" \
    "Branch promotion/hand-made-by-a-human starts with promotion/ but does not follow the promotion branch naming" "Pull Request scope: 1 Pull Request\(s\) \(#$H\)" "!declared in its description"

  local rt_branch
  rt_branch="promotion/uat/preprod/$(date +%Y-%m-%d)-9999"
  git checkout -q -f main && git pull -q origin main
  git checkout -q -B "$rt_branch"
  new_resource E2E_RT
  git add "$RES_DIR/E2E_RT.resource" "$RES_DIR/E2E_RT.resource-meta.xml" && git commit -q -m "feat: retargeted" && git push -q -f -u origin "$rt_branch"
  # shellcheck disable=SC2016 # the backticks are a markdown code fence, not a command
  printf 'A uat -> preprod promotion branch, opened against main by mistake.\n\n```yaml\npromotionPullRequests:\n  - %s\n  - %s\n```\n' "$S1" "$S5" >"$BODIES/retargeted.md"
  RT=$(p_open "$rt_branch" main "Retargeted promotion branch" "$BODIES/retargeted.md") || return 1
  remember RT "$RT"
  job 3 p_check "$RT" main edge-retargeted
  assert_log 39 edge-retargeted 0 "retargeted: warning, scope alone, the declared stories run nothing against production" \
    "is named for target preprod but its Pull Request targets main" "Pull Request scope: 1 Pull Request\(s\) \(#$RT\)" "!Running action E2E pre-deploy of PR $S1 " "!Running action E2E post-deploy of PR $S5 "

  job 3 p_promote_no_provider uat "$S1" edge-pr-creation-refused
  local refused_branch
  refused_branch=$(promo_branch edge-pr-creation-refused)
  assert_log 35 edge-pr-creation-refused 0 "creation refused: branch pushed, the reason, a one-click link" \
    "The Pull Request could not be created automatically \(" "is pushed" "Create it in one click"
  git ls-remote --exit-code --heads origin "$refused_branch" >/dev/null 2>&1
  ok_if 35b $? "the branch $refused_branch is on origin"

  job 3 p_promote uat "$S1" edge-supersede-first
  P7=$(promo_number edge-supersede-first)
  remember P7 "$P7"
  job 3 p_promote uat "$S1" edge-supersede-second
  P8=$(promo_number edge-supersede-second)
  remember P8 "$P8"
  assert_log 50 edge-supersede-second 0 "supersede: the open promotion is named and closed, #$S1 offered again unmarked" \
    "A promotion from uat to preprod is already open" "^#$S1 +\|[^|]*\|[^|]*\|[^|]*\|[^|]*\| +$" "Closed the promotion it supersedes: #$P7"

  echo "--- sync merge integration -> uat"
  printf 'Sync integration into uat, an ordinary merge.\n' >"$BODIES/sync.md"
  SYNC=$(p_open integration uat "Sync integration into uat" "$BODIES/sync.md") || return 1
  remember SYNC "$SYNC"
  p_merge "$SYNC" >/dev/null || record sync-merge FAIL "merge of #$SYNC"
  job 3 p_promote uat "$S2" edge-sync-merge
  P9=$(promo_number edge-sync-merge)
  P9_BRANCH=$(promo_branch edge-sync-merge)
  remember P9 "$P9"
  remember P9_BRANCH "$P9_BRANCH"
  assert_log 42 edge-sync-merge 0 "one row per story of the sync, promoting $S2 declares [$S2]" \
    "^#$S2 +\|" "^#$C1 +\|" "^#$C2 +\|" "assembled with 1 User Story\(ies\): #$S2" "Closed the promotion it supersedes: #$P8"
  local picks
  git fetch -q origin "$P9_BRANCH" preprod
  picks=$(git rev-list --count "origin/preprod..origin/$P9_BRANCH")
  p_body "$P9" >"$LOGS/p9-body.md"
  [ "$picks" = "1" ] && grep -qE "promotionPullRequests: \[$S2\]" "$LOGS/p9-body.md"
  ok_if 42b $? "the branch holds $picks cherry-pick, the description declares [$S2]"
  assert_log 44 edge-sync-merge - "two levels of vehicle: the retrofit row names the stories, never the promotion" \
    "^#$R, [#0-9, ]*\|" "!^#${P4}[ ,]" "!, #${P4}[ ,|]"
  assert_log 45 edge-sync-merge - "vehicle boundary: the rows after the opened-up vehicle keep one number" "^#$C1 +\|" "^#$C2 +\|"

  sed "s/promotionPullRequests: \[$S2\]/promotionPullRequests: [$S2, 999]/" "$LOGS/p9-body.md" >"$BODIES/p9-999.md"
  p_set_body "$P9" "$BODIES/p9-999.md"
  job 3 p_check "$P9" preprod edge-unreadable-declaration
  assert_log 41 edge-unreadable-declaration 0 "unreadable declaration: warning and skip" \
    "Pull Request #999 declared by promotion Pull Request $P9 was not found: skipped" "Pull Request scope: 2 Pull Request\(s\) \(#$S2, #$P9\)" "Inherited NO_DELTA from carried Pull Request\(s\) #$S2"
  p_set_body "$P9" "$LOGS/p9-body.md"
  p_merge "$P9" >/dev/null || record merge-p9 FAIL "merge of #$P9"
  job 2 p_deploy preprod deploy-preprod-promotion-s2
  assert_log 41b deploy-preprod-promotion-s2 0 "P9 deployed to preprod" "Pull Request scope: 2 Pull Request\(s\) \(#$S2, #$P9\)" "Deployment mode: FULL"

  job 3 p_promote uat "$R" edge-grouped-merge
  assert_log 40 edge-grouped-merge 0 "grouped merge commit: the numbers nobody asked for are named before the cherry-pick" \
    "is a merge commit: cherry-picking it also carries"
}

g4() {
  echo "=== g4: merged twice, sync inside a story, conflicts kept for all, back-merge, octopus ==="
  # A branch merged twice
  T1=$(story feature/E2E-501-twice integration integration "E2E-501 merged twice, first" "feat: twice" 'new_resource E2E_T1') || return 1
  remember T1 "$T1"
  git checkout -q -f feature/E2E-501-twice && git pull -q origin feature/E2E-501-twice
  printf 'second version\n' >"$RES_DIR/E2E_T1.resource"
  git commit -q -am "fix: twice, second" && git push -q origin feature/E2E-501-twice
  printf 'E2E-501 merged twice, second.\n' >"$BODIES/twice2.md"
  T2=$(p_open feature/E2E-501-twice integration "E2E-501 merged twice, second" "$BODIES/twice2.md") || return 1
  p_merge "$T2" >/dev/null
  remember T2 "$T2"

  # A story carrying a sync merge of the major branch
  git checkout -q -f integration && git pull -q origin integration
  git checkout -q -B feature/E2E-502-syncinside "origin/integration~2"
  new_resource E2E_SI
  git add "$RES_DIR/E2E_SI.resource" "$RES_DIR/E2E_SI.resource-meta.xml" && git commit -q -m "feat: sync inside"
  git merge -q --no-edit origin/integration >/dev/null 2>&1
  git push -q -f -u origin feature/E2E-502-syncinside
  printf 'E2E-502 story carrying a sync merge.\n' >"$BODIES/syncinside.md"
  SI=$(p_open feature/E2E-502-syncinside integration "E2E-502 story carrying a sync merge" "$BODIES/syncinside.md") || return 1
  p_merge "$SI" >/dev/null
  remember SI "$SI"
  job 3 p_promote integration "$SI" edge-sync-inside-story-promote
  P10=$(promo_number edge-sync-inside-story-promote)
  P10_BRANCH=$(promo_branch edge-sync-inside-story-promote)
  remember P10 "$P10"
  remember P10_BRANCH "$P10_BRANCH"
  assert_log 49 edge-sync-inside-story-promote 0 "sync inside a story: the candidate lists the story only" \
    "^#$SI +\|" "!^#$SI, " "assembled with 1 User Story\(ies\): #$SI" "Closed the promotion it supersedes: #$P5"
  assert_log 51 edge-sync-inside-story-promote - "branch merged twice: two rows, no '-' row for the same branch" \
    "^#$T1 +\|" "^#$T2 +\|" "!^- +\| Merge .*E2E-501-twice"

  # Two conflicting stories in one promotion, kept for all
  L3=$(story feature/E2E-601-label-three uat uat "E2E-601 label three" "feat: label three" 'set_label three') || return 1
  remember L3 "$L3"
  N4=$(story feature/E2E-602-notes-four uat uat "E2E-602 notes four" "feat: notes four" 'set_notes "version four"') || return 1
  remember N4 "$N4"
  job 3 p_promote uat "$L3,$N4" edge-conflict-kept-for-all --on-conflict commit-with-markers
  P11=$(promo_number edge-conflict-kept-for-all)
  remember P11 "$P11"
  [ "$(count_in_log edge-conflict-kept-for-all 'Applying the conflict handling chosen earlier: commit-with-markers')" = "2" ]
  ok_if 30 $? "kept for all: 'Applying the conflict handling chosen earlier' printed $(count_in_log edge-conflict-kept-for-all 'Applying the conflict handling chosen earlier: commit-with-markers') time(s)"
  assert_log 30b edge-conflict-kept-for-all 0 "both stories committed with their markers" "assembled with 2 User Story\(ies\)" "2 User Story\(ies\) carry conflict markers"
  p_close "$P11"
  local before_abort
  before_abort=$(local_promotion_branches)
  job 3 p_promote uat "$L3" edge-conflict-abort-once
  [ "$(count_in_log edge-conflict-abort-once 'Undoing promotion branch')" = "1" ] && ! grep -aq "not found" "$LOGS/edge-conflict-abort-once.log" && [ "$(local_promotion_branches)" = "$before_abort" ]
  ok_if 29b $? "a conflicted promotion is undone once, no 'not found' line"

  # Back-merge from the target branch
  printf 'Back-merge preprod into uat.\n' >"$BODIES/backmerge.md"
  BM=$(p_open preprod uat "Back-merge preprod into uat" "$BODIES/backmerge.md") || return 1
  p_merge "$BM" >/dev/null || record backmerge FAIL "merge of #$BM"
  remember BM "$BM"
  job 2 p_list_candidates uat edge-back-merge
  assert_log 46 edge-back-merge - "back-merge: one row labelled '-', not the stories already delivered" \
    "^- +\|[^|]*preprod" "!^#${BM}[ ,]" "!^#$S6 +\|"

  # Octopus merge on uat: integration and preprod both ahead of uat
  PP=$(story feature/E2E-701-preprod-only preprod preprod "E2E-701 preprod only" "feat: preprod only" 'new_resource E2E_PP') || return 1
  remember PP "$PP"
  I8=$(story feature/E2E-801-int integration integration "E2E-801 integration story" "feat: integration story" 'new_resource E2E_I8') || return 1
  remember I8 "$I8"
  git checkout -q -f uat && git pull -q origin uat && git fetch -q origin integration preprod
  git merge -q --no-ff -m "sync: octopus of integration and preprod into uat" origin/integration origin/preprod >"$LOGS/octopus-merge.txt" 2>&1
  local parents
  parents=$(git rev-list --parents -n 1 HEAD | wc -w)
  git push -q origin uat
  record 47a "$([ "$parents" = "4" ] && echo OK || echo FAIL)" "octopus merge on uat has $((parents - 1)) parents"
  job 2 p_list_candidates uat edge-octopus
  assert_log 47 edge-octopus - "octopus: the merge is left whole, one row naming several stories" \
    "^#[0-9]+(, #[0-9]+)*, #${I8}[ ,]|^#$I8, #" "!^#$I8 +\|" "!^#$T1 +\|"

  # Octopus whose side is a promotion branch: the declaration expanded, the vehicle dropped
  I9=$(story feature/E2E-802-int integration integration "E2E-802 integration story" "feat: integration story two" 'new_resource E2E_I9') || return 1
  remember I9 "$I9"
  git checkout -q -f uat && git pull -q origin uat && git fetch -q origin integration "$P10_BRANCH"
  git merge -q --no-ff -m "sync: octopus with a promotion branch" origin/integration "origin/$P10_BRANCH" >"$LOGS/octopus-promotion-merge.txt" 2>&1
  parents=$(git rev-list --parents -n 1 HEAD | wc -w)
  git push -q origin uat
  record 48a "$([ "$parents" = "4" ] && echo OK || echo FAIL)" "octopus with a promotion side has $((parents - 1)) parents"
  job 2 p_list_candidates uat edge-octopus-promotion-side
  assert_log 48 edge-octopus-promotion-side - "promotion that cannot be opened up: the stories it declares, never its number" \
    "#$I9, #$SI([^0-9]|$)|#$SI, #$I9([^0-9]|$)" "!#${P10}[ ,|]"
}

# Rewrite allowedPromotionSteps of the checked-out config. Git on Windows checks the file out with
# CRLF line endings (core.autocrlf), so the file is normalised to LF first: a pattern written with \n
# alone silently matches nothing, the commit is empty and the case tests the unchanged config.
# Usage: set_steps <none | narrow | three>
set_steps() {
  node -e "
const fs = require('fs');
const file = 'config/.sfdx-hardis.yml';
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
s = s.replace(/allowedPromotionSteps:\n(?:  - source: .*\n    target: .*\n)+/, '');
const steps = { none: '', narrow: [['uat', 'preprod']], three: [['integration', 'uat'], ['uat', 'preprod'], ['preprod', 'main']] }[process.argv[1]];
if (steps) {
  const block = 'allowedPromotionSteps:\n' + steps.map(([a, b]) => '  - source: ' + a + '\n    target: ' + b + '\n').join('');
  s = s.replace('enablePromotionBranches: true\n', 'enablePromotionBranches: true\n' + block);
}
fs.writeFileSync(file, s);
" "$1"
}
# Commit the steps on a branch and push. Usage: commit_steps <branch> <none | narrow | three>
commit_steps() {
  git checkout -q -f "$1" && git pull -q origin "$1"
  set_steps "$2"
  git add config/.sfdx-hardis.yml
  if git diff --cached --quiet; then
    record "steps-$1-$2" FAIL "allowedPromotionSteps unchanged on $1: nothing to commit"
    return 1
  fi
  git commit -q -m "chore: allowedPromotionSteps $2" && git push -q origin "$1"
}

g5() {
  echo "=== g5: restricted and undeclared promotion steps ==="
  # A story waiting in uat, so that the allowed step has something to promote
  ST=$(story feature/E2E-901-steps uat uat "E2E-901 steps story" "feat: steps story" 'new_resource E2E_ST') || return 1
  remember ST "$ST"
  commit_steps integration narrow
  commit_steps uat narrow
  job 3 p_promote integration "$I9" edge-restricted-integration
  assert_log 53a edge-restricted-integration 1 "a promotion from integration is refused" "Promotions from integration are not allowed by allowedPromotionSteps \(uat -> preprod\)"
  job 3 p_promote uat "$ST" edge-restricted-main --target-branch main
  assert_log 53b edge-restricted-main 1 "a promotion from uat to main is refused" "A promotion from uat to main is not allowed by allowedPromotionSteps \(uat -> preprod\)"
  job 3 p_promote uat "$ST" edge-restricted-ok
  P13=$(promo_number edge-restricted-ok)
  remember P13 "$P13"
  assert_log 53c edge-restricted-ok 0 "uat -> preprod still works" "assembled with 1 User Story\(ies\): #$ST"
  git checkout -q -f uat
  printf '{ "label": "allowedPromotionSteps narrowed to uat -> preprod", "promotionSteps": ["uat>preprod"] }\n' >"$EXPECT/pipeline-steps-restricted.json"
  pipeline_check pipeline-steps-restricted "$EXPECT/pipeline-steps-restricted.json" >/dev/null 2>&1
  ok_if 53d $? "the DevOps Pipeline offers Create promotion on uat only: $(grep -a 'Create promotion offered on' "$LOGS/pipeline-steps-restricted.log")"
  commit_steps uat none
  job 3 p_promote uat "$ST" edge-steps-not-declared
  assert_log 54 edge-steps-not-declared 1 "undeclared steps: the command stops asking for the list, before listing anything" \
    "Promotion branches need the steps they are allowed to run on: set allowedPromotionSteps" "!Listing the Pull Requests merged"
  commit_steps uat three
  commit_steps integration three
  git checkout -q -f uat
  printf '{ "label": "the three promotion steps are offered", "promotionSteps": ["integration>uat", "uat>preprod", "preprod>main"] }\n' >"$EXPECT/pipeline-steps-three.json"
  pipeline_check pipeline-steps-three "$EXPECT/pipeline-steps-three.json" >/dev/null 2>&1
  ok_if 53e $? "restored: $(grep -a 'Create promotion offered on' "$LOGS/pipeline-steps-three.log")"
  p_close "$P13"
}

g6() {
  echo "=== g6: full merge of uat into preprod after the partial promotions ==="
  printf 'Full merge of uat into preprod.\n' >"$BODIES/fullmerge.md"
  FM=$(p_open uat preprod "Full merge of uat into preprod" "$BODIES/fullmerge.md") || return 1
  remember FM "$FM"
  job 3 p_check "$FM" preprod edge-full-merge
  assert_log 52a edge-full-merge 0 "the stories already promoted are named, the others arrive for the first time" \
    "Pull Request $S2 was already deployed through promotion branch\(es\) $(esc "$P9_BRANCH") \(#$P9\)" "E2E post-deploy of PR $S5"
  p_merge "$FM" >/dev/null || record merge-fm FAIL "merge of #$FM"
  job 2 p_deploy preprod deploy-preprod-full-merge
  assert_log 52b deploy-preprod-full-merge 0 "the full merge is deployed" "already deployed through promotion branch\(es\)" "Successfully (deployed|processed QuickDeploy)"
  job 2 p_list_candidates uat edge-after-full-merge
  assert_log 52c edge-after-full-merge - "afterwards nothing is left waiting for promotion" "No Pull Request merged into uat is waiting for promotion to preprod"
}

for group in "$@"; do
  "$group"
done
echo "EDGE GROUPS DONE: $*"
