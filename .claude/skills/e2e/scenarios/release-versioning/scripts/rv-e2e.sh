#!/usr/bin/env bash
# Release versioning, end to end, in REAL CI jobs (GitHub Actions or GitLab CI) running sfdx-hardis
# built from the branch under test, on a pipeline integration -> uat -> preprod -> main where uat,
# preprod and main declare releaseVersioning: true. After each deployment step, the tag created is
# checked (name, commit, message, deployment log, Pull Request comment) and the DevOps Pipeline of
# vscode-sfdx-hardis is captured, so the captures show how the versions evolve in time.
#
#   PART=default PROVIDER=github bash rv-e2e.sh      # default tag format, ten deployments
#   PART=custom  PROVIDER=gitlab bash rv-e2e.sh      # tag formats per branch, variables, CI/CD variables
#   PART=custom PROVIDER=github RUN=<run> STEPS="version-list report" bash rv-e2e.sh   # replay steps
#
# Steps, in order:
#   PART=default: org repo a01 ... a10 local version-list timeline report
#   PART=custom:  org repo c01 ... c12 local version-list timeline report
#
# Settings (environment, then the .env of the sfdx-hardis working copy):
#   PART                default (default) or custom
#   PROVIDER            github (default) or gitlab
#   DEVHUB              Dev Hub that creates the scratch org (default DevHub)
#   RV_ORG              org of the four branches (default: a new scratch org rv-e2e-<part>-<provider>-<date>)
#   SFDX_HARDIS_BRANCH  branch of hardisgroupcom/sfdx-hardis the jobs build (default: current, pushed)
#   RUN                 run name (default rv-e2e-<part>-<provider>-<date>): WORK and LOGS under the OS temp dir
#   CAPTURE             1 (default): capture the DevOps Pipeline after each step; 0: no capture
#   GitHub: GH_E2E_OWNER. GitLab: GITLAB_E2E_HOST, GITLAB_E2E_GROUP
#   (see ../../promotion-branches/scripts/ci-provider-<provider>.sh)
#
# Results: $LOGS/results.tsv (id, OK|FAIL|SKIP, detail), report and captures in $LOGS, copied to
# <working copy>/hardis-report/e2e/release-versioning/<run>/ (git-ignored) by the report step
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMO_SCRIPTS="$(cd "$HERE/../../promotion-branches/scripts" && pwd)"
export PROVIDER="${PROVIDER:-github}"
PART="${PART:-default}"
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/env-lib.sh"
e2e_defaults
e2e_load_env DEVHUB RV_ORG GH_E2E_OWNER GH_E2E_VISIBILITY GITLAB_E2E_HOST GITLAB_E2E_GROUP
ROOT="$E2E_ROOT"
DEVHUB="${DEVHUB:-DevHub}"
STAMP="$(date +%m%d%H%M)"
RUN="${RUN:-rv-e2e-$PART-$PROVIDER-$(date +%Y%m%d-%H%M)}"
export WORK="${RV_WORK:-$E2E_TMP/$RUN}"
export LOGS="${RV_LOGS:-$E2E_TMP/$RUN-logs}"
SFDX_HARDIS_BRANCH="${SFDX_HARDIS_BRANCH:-$(git -C "$ROOT" branch --show-current)}"
CAPTURE="${CAPTURE:-1}"
SHOTS="$LOGS/shots"
case "$PART" in
default) CYCLE="a01 a02 a03 a04 a05 a06 a07 a08 a09 a10" ;;
custom) CYCLE="c01 c02 c03 c04 c05 c06 c07 c08 c09 c10 c11 c12" ;;
*)
  echo "PART=$PART: default or custom"
  exit 2
  ;;
esac
STEPS="${STEPS:-org repo $CYCLE local version-list timeline report}"
mkdir -p "$LOGS/bodies" "$SHOTS"
export RESULTS="$LOGS/results.tsv"
touch "$RESULTS" "$LOGS/run.env"
[ -f "$LOGS/ci-jobs.tsv" ] || printf 'label\tprovider\tmode\trun\tresult\tqueued_s\tran_s\tbuild_minutes\n' >"$LOGS/ci-jobs.tsv"
# shellcheck source=/dev/null
source "$LOGS/run.env"
# shellcheck source=/dev/null
[ -f "$LOGS/ci-vars.sh" ] && source "$LOGS/ci-vars.sh"
export ORG="${RV_ORG:-rv-e2e-$PART-$PROVIDER-$STAMP}"
case "$PROVIDER" in
github)
  [ -n "${REPO:-}" ] || REPO="${GH_E2E_OWNER:-$(gh api user --jq .login)}/sfdx-hardis-rv-e2e-$PART-$STAMP"
  export REPO
  ;;
gitlab)
  [ -n "${GITLAB_E2E_PROJECT:-}" ] || [ -z "${PROJECT_PATH:-}" ] || GITLAB_E2E_PROJECT="${PROJECT_PATH##*/}"
  [ -n "${GITLAB_E2E_PROJECT:-}" ] || GITLAB_E2E_PROJECT="sfdx-hardis-rv-e2e-$PART-gl-$STAMP"
  export GITLAB_E2E_PROJECT
  ;;
*)
  echo "PROVIDER=$PROVIDER: github or gitlab (the versions of Azure DevOps and Bitbucket are tags only, see the README)"
  exit 2
  ;;
esac

export SCRIPTS_DIR="$PROMO_SCRIPTS"
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/ci-provider-$PROVIDER.sh"
ci_provider_init || exit 1
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/section-lib.sh"
# One assertion per line of results.tsv: id, OK|FAIL|SKIP, detail (assert_log records through it)
record() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$RESULTS"
  echo "[$2] $1 - $3"
}
ci_tick_in_file() { :; } # no checkbox in this scenario

save() {
  printf 'export %s=%q\n' "$1" "$2" >>"$LOGS/run.env"
  export "$1=$2"
}
step() { case " $STEPS " in *" $1 "*) return 0 ;; *) return 1 ;; esac }
say() { echo "[$(date +%T)] $*"; }
native() { cygpath -m "$1" 2>/dev/null || echo "$1"; }
# sf can print a warning before its JSON: parse from the first brace
json_of() { node -e "const t=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(t.slice(t.indexOf('{')));const v=($1);process.stdout.write(v===undefined||v===null?'':String(v))}catch(e){}"; }
provider_lib() {
  # shellcheck source=/dev/null
  source "$PROMO_SCRIPTS/promotion-provider.sh"
}

# ------------------------------------------------------------------ CI/CD variables of the repository
# GitHub: repository variables, mapped in the env of process-deploy.yml by patch_github_workflow.
# GitLab: project variables, which every job receives
ci_var_set() {
  case "$PROVIDER" in
  github) gh variable set "$1" -R "$REPO" --body "$2" >/dev/null ;;
  gitlab)
    _glci_api DELETE "projects/$PROJECT_ID/variables/$1" >/dev/null 2>&1
    _glci_set_variable "$1" "$2" >/dev/null
    ;;
  esac
}
ci_var_unset() {
  case "$PROVIDER" in
  github) gh variable delete "$1" -R "$REPO" >/dev/null 2>&1 ;;
  gitlab) _glci_api DELETE "projects/$PROJECT_ID/variables/$1" >/dev/null 2>&1 ;;
  esac
  return 0
}
RV_VARIABLES="SFDX_HARDIS_RELEASE_VERSIONING_TAG_FORMAT SFDX_HARDIS_RELEASE_VERSIONING_VAR_PI SFDX_HARDIS_RELEASE_VERSIONING_VAR_IT SFDX_HARDIS_RELEASE_VERSIONING_VAR_UAT_IT"

# GitHub passes no repository variable to a job unless the workflow maps it: the deployment job
# gets contents: write (tags and Releases) and the release versioning variables of this run
patch_github_workflow() {
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    let text = fs.readFileSync(file, "utf8");
    if (!/contents: read/.test(text)) { console.error("no contents: read in " + file); process.exit(1); }
    text = text.replace(/contents: read/g, "contents: write");
    const lines = text.split("\n");
    const at = lines.findIndex((line) => /^\s+SFDX_DEPLOY_WAIT_MINUTES:/.test(line));
    if (at < 0) { console.error("no SFDX_DEPLOY_WAIT_MINUTES in the env of " + file); process.exit(1); }
    const indent = lines[at].match(/^\s+/)[0];
    const added = process.argv[2].split(" ").map((name) => `${indent}${name}: \${{ vars.${name} }}`);
    lines.splice(at + 1, 0, ...added);
    fs.writeFileSync(file, lines.join("\n"));
  ' "$(native "$WORK/.github/workflows/process-deploy.yml")" "$RV_VARIABLES"
}

# ------------------------------------------------------------------ tags
# Tag names of the remote, one per line, sorted (the peeled ^{} lines of annotated tags folded)
# A failed ls-remote prints nothing, which reads as "every tag disappeared" (2026-11-19: a check
# that no tag was created failed on such a read): ask again until it answers
remote_tags() {
  local lines
  for _ in 1 2 3 4 5 6; do
    lines=$(git -C "$WORK" ls-remote --tags origin 2>/dev/null) && break
    sleep 10
  done
  printf '%s\n' "$lines" | awk 'NF {sub("refs/tags/","",$2); sub(/\^\{\}$/,"",$2); print $2}' | sort -u
}
# The commit a remote tag points to (the peeled commit for an annotated tag)
remote_tag_commit() {
  local lines
  lines=$(git -C "$WORK" ls-remote --tags origin "refs/tags/$1" "refs/tags/$1^{}" 2>/dev/null)
  printf '%s\n' "$lines" | grep -F "^{}" | awk '{print $1}' | head -1 | grep . ||
    printf '%s\n' "$lines" | awk '{print $1}' | head -1
}
# Current tag of each versioned branch, for the expectations of the captures
set_current() { save "CUR_$1" "$2"; }
current_json() {
  node -e 'const o={};for(const [b,t] of [["uat",process.argv[1]],["preprod",process.argv[2]],["main",process.argv[3]]]){if(t)o[b]=t}console.log(JSON.stringify(o))' \
    "${CUR_uat:-}" "${CUR_preprod:-}" "${CUR_main:-}"
}

# ------------------------------------------------------------------ Pull Requests and deployments
# Usage: open_merge <id> <source> <target> <title>   -> sets PR and MERGE_SHA
open_merge() {
  local id="$1" source="$2" target="$3" title="$4"
  printf '%s: %s.\n' "$id" "$title" >"$LOGS/bodies/$id.md"
  PR=$(p_open "$source" "$target" "$id $title" "$LOGS/bodies/$id.md") || {
    record "$id-PR" FAIL "Pull Request $source -> $target not opened, see p-open.err"
    return 1
  }
  p_merge "$PR" >/dev/null || {
    record "$id-MERGE" FAIL "merge of #$PR ($source -> $target)"
    return 1
  }
  MERGE_SHA=$(ci_merge_sha "$PR")
  save "PR_${id//-/_}" "$PR"
}
# A story: the label gets a new value on a branch from integration, merged, deployed to integration.
# integration is not versioned: its deployment creates no tag. Extra edits of the story come in
# STORY_EDIT, a command run in the clone before the commit
story() {
  local id="$1" before after saved="PR_${1//-/_}_story"
  cd "$WORK" || return 1
  git fetch -q origin
  # Replay of a step whose story was already merged (a run stopped in the middle of the step): the
  # same change again would make an empty commit and no Pull Request, so the merged one is reused
  if [ -n "${!saved:-}" ] && MERGE_SHA=$(ci_merge_sha "${!saved}") && [ -n "$MERGE_SHA" ] && [ "$MERGE_SHA" != "null" ]; then
    PR="${!saved}"
    say "$id: story already merged in #$PR, resumed from its deployment to integration"
    ci_wait_deploy integration "$MERGE_SHA" "$id-integration"
    assert_log "$id-INTEGRATION" "$id-integration" 0 "the story of $id is deployed to integration"
    record "$id-INTEGRATION-NO-TAG" SKIP "step resumed after the story was merged: the tags before its deployment are unknown"
    return 0
  fi
  git checkout -q -f -B "feature/rv-$id" origin/integration
  sed -i "s#<value>.*</value>#<value>story $id</value>#" force-app/main/default/labels/CustomLabels.labels-meta.xml
  [ -n "${STORY_EDIT:-}" ] && eval "$STORY_EDIT"
  git commit -qam "feat: story $id" && git push -q -u origin "feature/rv-$id"
  before=$(remote_tags)
  open_merge "$id-story" "feature/rv-$id" integration "story" || return 1
  ci_wait_deploy integration "$MERGE_SHA" "$id-integration"
  assert_log "$id-INTEGRATION" "$id-integration" 0 "the story of $id is deployed to integration"
  after=$(remote_tags)
  if [ "$before" = "$after" ]; then
    record "$id-INTEGRATION-NO-TAG" OK "integration declares no releaseVersioning: its deployment creates no tag"
  else
    record "$id-INTEGRATION-NO-TAG" FAIL "new tag(s) after the deployment of integration: $(comm -13 <(echo "$before") <(echo "$after") | tr '\n' ' ')"
  fi
}
# A hotfix branch from preprod: the Apex class changes, merged into preprod
hotfix_branch() {
  local id="$1"
  cd "$WORK" || return 1
  git fetch -q origin
  git checkout -q -f -B "hotfix/rv-$id" origin/preprod
  sed -i "s#// HOTFIX: .*#// HOTFIX: $id#" force-app/main/default/classes/RVHotfix.cls
  git commit -qam "fix: hotfix $id" && git push -q -u origin "hotfix/rv-$id"
}

# Usage: expect_tag <id> <branch> <expected tag> <tags before> [<variables line>]
# Exactly one new tag, the expected one, on the merge commit, with the sfdx-hardis message
expect_tag() {
  local id="$1" branch="$2" want="$3" before="$4" vars="${5:-}" after new commit message version rc problems=""
  after=$(remote_tags)
  new=$(comm -13 <(echo "$before") <(echo "$after") | tr '\n' ' ' | sed 's/ $//')
  [ "$new" = "$want" ] || problems+=" new tags [$new], expected [$want];"
  commit=$(remote_tag_commit "$want")
  [ "$commit" = "$MERGE_SHA" ] || problems+=" $want on ${commit:-nothing}, expected the merge commit $MERGE_SHA;"
  git -C "$WORK" fetch -q origin "refs/tags/$want:refs/tags/$want" --force 2>/dev/null
  message=$(git -C "$WORK" for-each-ref "refs/tags/$want" --format='%(contents)')
  printf '%s\n' "$message" >"$LOGS/$id-tag-message.txt"
  grep -qxF "sfdx-hardis release version $want" <<<"$message" || problems+=" no sfdx-hardis first line in the tag message;"
  grep -qxF "branch: $branch" <<<"$message" || problems+=" no 'branch: $branch' in the tag message;"
  version=$(sed -n 's/^version: //p' <<<"$message")
  rc=$(sed -n 's/^rc: //p' <<<"$message")
  [ -n "$version" ] || problems+=" no 'version:' line;"
  if [ "$branch" = "main" ]; then
    [ -z "$rc" ] || problems+=" an rc line on a production version;"
  else
    [ -n "$rc" ] || problems+=" no 'rc:' line on a release candidate;"
  fi
  if [ -n "$vars" ]; then
    grep -qxF "variables: $vars" <<<"$message" || problems+=" no 'variables: $vars' line;"
  fi
  grep -aqF "Release version of this deployment: $want" "$LOGS/$id-deploy.log" || problems+=" the deployment log does not name $want;"
  ci_pr_comments "$PR" "$id-comments"
  grep -aqF "$want" "$LOGS/$id-comments.log" || problems+=" the comments of #$PR do not name $want;"
  if [ -z "$problems" ]; then
    record "$id-TAG" OK "$branch: $want on the merge commit of #$PR (version $version${rc:+, rc $rc}${vars:+, $vars}), named in the log and the Pull Request comment"
    set_current "$branch" "$want"
  else
    record "$id-TAG" FAIL "$branch: $want:$problems"
  fi
}
# The Release of a production version: the release notes as body, listing the Pull Requests of the
# release (stories, hotfixes and the promotion to production), the PDF and the XLSX attached
# Usage: expect_release <id> <tag> <number of Pull Requests the release notes list>
expect_release() {
  local id="$1" tag="$2" want_prs="$3" files body prs
  case "$PROVIDER" in
  github)
    files=$(gh release view "$tag" -R "$REPO" --json assets --jq '[.assets[].name] | join(",")' 2>/dev/null)
    body=$(gh release view "$tag" -R "$REPO" --json body --jq .body 2>/dev/null)
    ;;
  gitlab)
    files=$(_glci_api GET "projects/$PROJECT_ID/releases/$tag" | _glci_json "((d.assets||{}).links||[]).map(l=>l.name).join(',')")
    body=$(_glci_api GET "projects/$PROJECT_ID/releases/$tag" | _glci_json "d.description||''")
    ;;
  esac
  # The summary table of the release notes: | Pull Requests | <n> |
  prs=$(printf '%s\n' "$body" | sed -nE 's/^\| Pull Requests \| ([0-9]+) \|.*/\1/p' | head -1)
  if [[ "$files" == *.pdf* && "$files" == *.xlsx* ]]; then
    record "$id-RELEASE" OK "Release $tag exists with its release notes files ($files)"
  else
    record "$id-RELEASE" FAIL "Release $tag: files [${files:-none}], expected a PDF and an XLSX"
  fi
  if [ "$prs" = "$want_prs" ]; then
    record "$id-RELEASE-PRS" OK "the release notes of $tag list its $prs Pull Requests"
  else
    record "$id-RELEASE-PRS" FAIL "the release notes of $tag list ${prs:-no} Pull Requests, expected $want_prs"
  fi
}

# Usage: cycle_step <id> <kind> <source> <target> <expected tag> <caption> [<variables line>] [<tabs>]
# kind: promote (Pull Request source -> target), story (a story into integration, then integration
# -> uat), hotfix (a hotfix branch into preprod)
cycle_step() {
  local id="$1" kind="$2" source="$3" target="$4" want="$5" caption="$6" vars="${7:-}" tabs="${8:-}" before
  say "$id: $caption"
  case "$kind" in
  story)
    story "$id" || return 1
    before=$(remote_tags)
    open_merge "$id" integration uat "promote integration to uat" || return 1
    ;;
  promote)
    before=$(remote_tags)
    open_merge "$id" "$source" "$target" "promote $source to $target" || return 1
    ;;
  hotfix)
    hotfix_branch "$id" || return 1
    before=$(remote_tags)
    open_merge "$id" "hotfix/rv-$id" preprod "hotfix" || return 1
    ;;
  esac
  ci_wait_deploy "$target" "$MERGE_SHA" "$id-deploy"
  assert_log "$id-DEPLOY" "$id-deploy" 0 "the deployment of #$PR to $target succeeds"
  expect_tag "$id" "$target" "$want" "$before" "$vars"
  capture "$id" "$caption" "$tabs"
}

# ------------------------------------------------------------------ DevOps Pipeline captures
# The extension, run headless on the clone (main checked out), waits for the chips of the current
# tags, then captures the pipeline, and the tabs asked for. See releaseVersionsReal.test.ts of
# vscode-sfdx-hardis
capture() {
  local id="$1" caption="$2" tabs="${3:-}" token label
  [ "$CAPTURE" = "1" ] || return 0
  label="capture-$id"
  if [ ! -f "$EXT/out/test/runUiTest.js" ]; then
    record "$id-CAPTURE" SKIP "the extension is not compiled ($EXT/out/test/runUiTest.js): cd $EXT && yarn dev && yarn compile"
    return 0
  fi
  git -C "$WORK" fetch -q origin && git -C "$WORK" checkout -q -f -B main origin/main
  token="$(p_token)"
  (cd "$EXT" && env -u NODE_OPTIONS -u CI \
    SFDX_HARDIS_REAL_RELEASE_VERSIONS=true \
    SFDX_HARDIS_LAB_WORKSPACE="$(native "$WORK")" \
    SFDX_HARDIS_REAL_RELEASE_VERSIONS_SHOTS="$(native "$SHOTS")" \
    SFDX_HARDIS_REAL_RELEASE_VERSIONS_PREFIX="$id" \
    SFDX_HARDIS_REAL_RELEASE_VERSIONS_EXPECT="$(current_json)" \
    SFDX_HARDIS_REAL_RELEASE_VERSIONS_TABS="$tabs" \
    SFDX_HARDIS_VISUAL_THEME=light \
    GITHUB_TOKEN="$token" CI_SFDX_HARDIS_GITLAB_TOKEN="$token" GITLAB_TOKEN="$token" \
    node ./out/test/runUiTest.js) >"$LOGS/$label.log" 2>&1
  echo $? >"$LOGS/$label.code"
  printf '%s\t%s\n' "$id" "$caption" >>"$SHOTS/captions.tsv"
  if [ "$(cat "$LOGS/$label.code")" = "0" ] && [ -f "$SHOTS/$id-pipeline.png" ]; then
    record "$id-CAPTURE" OK "the DevOps Pipeline shows $(current_json) (shots/$id-pipeline.png${tabs:+, tabs $tabs})"
  else
    record "$id-CAPTURE" FAIL "DevOps Pipeline capture: $(grep -aE 'failing|AssertionError|Error:' "$LOGS/$label.log" | head -3 | tr '\n' ';')"
  fi
}

say "run $RUN - part $PART - provider $PROVIDER - work $WORK - logs $LOGS - branch under test $SFDX_HARDIS_BRANCH - org $ORG"

# ------------------------------------------------------------------ org: one scratch org for the four branches
if step org; then
  if ! env -u NODE_OPTIONS sf org display -o "$ORG" --json 2>/dev/null | grep -qE '"connectedStatus": "Connected"|"status": "Active"'; then
    env -u NODE_OPTIONS sf org create scratch --target-dev-hub "$DEVHUB" --alias "$ORG" --edition developer --duration-days 2 --wait 30 --json >"$LOGS/org-create.json" 2>&1 || {
      record ORG FAIL "scratch org not created, see org-create.json"
      exit 1
    }
  fi
  save RV_ORG "$ORG"
  # Recent sf CLI versions hide secrets in "sf org display": the auth URL has its own command
  AUTH_URL=$(env -u NODE_OPTIONS sf org auth show-sfdx-auth-url -o "$ORG" --json 2>/dev/null | json_of "j.result.sfdxAuthUrl")
  [[ "$AUTH_URL" == force://* ]] || {
    record ORG FAIL "no sfdxAuthUrl for $ORG"
    exit 1
  }
  printf '%s' "$AUTH_URL" >"$LOGS/auth-url.txt"
  env -u NODE_OPTIONS sf org display -o "$ORG" --json >"$LOGS/org-display.json" 2>/dev/null
  save ORG_USERNAME "$(json_of "j.result.username" <"$LOGS/org-display.json")"
  save ORG_INSTANCE "$(json_of "j.result.instanceUrl" <"$LOGS/org-display.json")"
  record ORG OK "org $ORG ready ($ORG_USERNAME), its auth URL logs the four branches in"
fi

# ------------------------------------------------------------------ repo: project, CI files, remote, logins
if step repo; then
  WORK="$WORK" PART="$PART" API="$API" bash "$HERE/rv-build-project.sh" >"$LOGS/build.log" 2>&1 || {
    record REPO FAIL "project not built, see build.log"
    exit 1
  }
  cd "$WORK" || exit 1
  for f in config/branches/.sfdx-hardis.*.yml; do
    printf 'targetUsername: %s\ninstanceUrl: %s\n' "$ORG_USERNAME" "$ORG_INSTANCE" >>"$f"
  done
  node "$PROMO_SCRIPTS/ci-workflows-prepare.cjs" --provider "$PROVIDER" "$ROOT" "$(native "$WORK")" "$SFDX_HARDIS_BRANCH" >>"$LOGS/build.log" 2>&1 || {
    record REPO FAIL "CI files not written, see build.log"
    exit 1
  }
  if [ "$PROVIDER" = "github" ]; then
    patch_github_workflow >>"$LOGS/build.log" 2>&1 || {
      record REPO-WORKFLOW FAIL "process-deploy.yml not patched (contents: write, release versioning variables), see build.log"
      exit 1
    }
    record REPO-WORKFLOW OK "process-deploy.yml: contents: write, and the variables $RV_VARIABLES mapped from the repository variables"
  fi
  git add -A && git commit -qm "chore: CI files of the sfdx-hardis branch $SFDX_HARDIS_BRANCH"
  : >"$LOGS/ci-vars.sh"
  ci_create_remote "$(cat "$LOGS/auth-url.txt")" >>"$LOGS/build.log" 2>&1 || {
    record REPO FAIL "remote not created, see build.log"
    exit 1
  }
  # shellcheck source=/dev/null
  source "$LOGS/ci-vars.sh"
  if [ "$PART" = "default" ]; then
    # A tag made by hand before the first deployment: the numbering carries on from it
    # It has no sfdx-hardis message, so no branch: the DevOps Pipeline shows it on no node
    git tag v1.3.0 main && git push -q origin v1.3.0
  fi
  save REPO_READY 1
  record REPO OK "repository ${REPO:-${PROJECT_PATH:-?}} (PART=$PART) with main preprod uat integration, the CI files of $SFDX_HARDIS_BRANCH, the logins"
fi
if [ -n "${REPO_READY:-}" ]; then provider_lib; fi

# ------------------------------------------------------------------ PART=default: the documented cycle
if [ "$PART" = "default" ]; then
  if step a01; then
    # The validation of the first promotion creates no tag either
    before=$(remote_tags)
    cycle_step a01 story integration uat v1.4.0-rc.1 "First deployment to uat after v1.3.0: release 1.4.0 opens" "" "branch:uat"
    if [ -n "${PR:-}" ]; then
      ci_wait_check "$PR" "$(ci_pr_head_sha "$PR")" a01-check
      others=$(comm -13 <(echo "$before") <(remote_tags) | grep -vcxF v1.4.0-rc.1)
      if [ "$others" = "0" ]; then
        record a01-CHECK-NO-TAG OK "the validation of #$PR created no tag"
      else
        record a01-CHECK-NO-TAG FAIL "tag(s) other than v1.4.0-rc.1 appeared around the validation of #$PR"
      fi
    fi
  fi
  step a02 && cycle_step a02 story integration uat v1.4.0-rc.2 "Same release, next release candidate"
  step a03 && cycle_step a03 promote uat preprod v1.4.0-rc.3 "One counter per version, shared by uat and preprod"
  step a04 && cycle_step a04 story integration uat v1.5.0-rc.1 "1.4.0 moved up to preprod: uat opens 1.5.0"
  if step a05; then
    cycle_step a05 promote preprod main v1.4.0 "Production gets the plain version" "" "releases"
    expect_release a05 v1.4.0 3
  fi
  step a06 && cycle_step a06 hotfix "" preprod v1.4.1-rc.1 "Nothing waits in preprod: the hotfix starts a patch"
  if step a07; then
    cycle_step a07 promote preprod main v1.4.1 "The patch reaches production"
    expect_release a07 v1.4.1 2
  fi
  step a08 && cycle_step a08 promote preprod uat v1.5.0-rc.2 "preprod merged back into uat: 1.5.0 stays open"
  step a09 && cycle_step a09 promote uat preprod v1.5.0-rc.3 "1.5.0 moves up, the shared counter goes on"
  step a10 && cycle_step a10 story integration uat v1.6.0-rc.1 "1.5.0 moved up: uat opens 1.6.0" "" "releases,branch:uat,branch:preprod,views,versions-off"
fi

# ------------------------------------------------------------------ PART=custom: tag formats, variables, CI/CD variables
if [ "$PART" = "custom" ]; then
  if step c01; then
    for v in $RV_VARIABLES; do ci_var_unset "$v"; done
    cycle_step c01 story integration uat v1.0.0-pi2-it4-uat-rc1 "uat format, PI 2 and IT 4 from the config" "PI=2 IT=4" "branch:uat"
  fi
  if step c02; then
    # A tag made by hand already has the name the next deployment computes: the provider refuses
    # it, the job retries with the next number. Lightweight and in a custom format: never read
    git -C "$WORK" fetch -q origin
    git -C "$WORK" tag -f v1.0.0-pi2-it4-uat-rc2 origin/main && git -C "$WORK" push -q origin v1.0.0-pi2-it4-uat-rc2
    save HAND_TAG v1.0.0-pi2-it4-uat-rc2
    # The hand-made tag is already on the remote: it is not one of the new tags of this step
    cycle_step c02 story integration uat v1.0.0-pi2-it4-uat-rc3 "rc2 taken by a tag made by hand: the job takes rc3" "PI=2 IT=4"
    assert_log c02-RETRY c02-deploy - "the job saw rc2 taken and computed the next version" \
      "Tag v1.0.0-pi2-it4-uat-rc2 was just created by another job"
  fi
  step c03 && cycle_step c03 promote uat preprod v1.0.0-preprod-rc1 "preprod format: its own counter starts at 1"
  if step c04; then
    # The story raises IT in the project config: it reaches uat with the promotion
    STORY_EDIT="sed -i 's/^  IT: 4\$/  IT: 5/' config/.sfdx-hardis.yml" \
      cycle_step c04 story integration uat v1.1.0-pi2-it5-uat-rc1 "A Pull Request sets IT 5: uat opens 1.1.0 with it" "PI=2 IT=5" "branch:uat"
  fi
  step c05 && cycle_step c05 hotfix "" preprod v1.0.0-preprod-rc2 "The hotfix joins the release waiting in preprod"
  if step c06; then
    cycle_step c06 promote preprod main v1.0.0 "Production keeps the plain version, its format is ignored" "" "releases"
    expect_release c06 v1.0.0 4
    assert_log c06-FINAL-FORMAT c06-deploy - "the format declared by main is ignored, with a warning" \
      "releaseVersioningTagFormat is ignored on main"
  fi
  if step c07; then
    ci_var_set SFDX_HARDIS_RELEASE_VERSIONING_VAR_PI 3
    ci_var_set SFDX_HARDIS_RELEASE_VERSIONING_VAR_IT 1
    cycle_step c07 story integration uat v1.1.0-pi3-it1-uat-rc1 "CI/CD variables PI 3 and IT 1: a new PI, no Pull Request" "PI=3 IT=1" "branch:uat"
  fi
  if step c08; then
    ci_var_set SFDX_HARDIS_RELEASE_VERSIONING_VAR_UAT_IT 2
    cycle_step c08 story integration uat v1.1.0-pi3-it2-uat-rc1 "The CI/CD variable of uat only sets IT 2" "PI=3 IT=2"
  fi
  if step c09; then
    ci_var_set SFDX_HARDIS_RELEASE_VERSIONING_VAR_UAT_IT 1
    cycle_step c09 story integration uat v1.1.0-pi3-it2-uat-rc2 "IT lowered to 1: no effect, the tags hold IT 2" "PI=3 IT=2"
  fi
  if step c10; then
    ci_var_set SFDX_HARDIS_RELEASE_VERSIONING_TAG_FORMAT 'v{MAJ}.{MIN}.{PATCH}-{BRANCH}-rc.{RC}'
    cycle_step c10 story integration uat v1.1.0-uat-rc.1 "A CI/CD variable overrides the format of every branch" "" "branch:uat"
  fi
  if step c11; then
    ci_var_unset SFDX_HARDIS_RELEASE_VERSIONING_TAG_FORMAT
    cycle_step c11 promote uat preprod v1.1.0-preprod-rc1 "Variable removed: preprod uses its own format again"
  fi
  if step c12; then
    cycle_step c12 promote preprod main v1.1.0 "1.1.0 reaches production" "" "releases,branch:uat,branch:preprod,branch:main,views,versions-off"
    expect_release c12 v1.1.0 6
    for v in $RV_VARIABLES; do ci_var_unset "$v"; done
  fi
fi

# ------------------------------------------------------------------ local: the CLI of the branch under test, no CI job
# hardis:project:version:list on the clone: the next version of uat with a CI/CD variable, an
# invalid format and a variable without value (local edits only, never pushed)
if step local; then
  cd "$WORK" || exit 1
  git fetch -q origin --tags --force && git checkout -q -f -B main origin/main
  next_uat() { json_of "((j.result.branches.find(b=>b.branchName==='uat')||{}).nextOnPromotion||[]).filter(p=>p.sourceBranch==='integration').map(p=>p.tag).join(',')" <"$LOGS/$1.json"; }
  vl() {
    local label="$1"
    shift
    env -u NODE_OPTIONS -u CI "$@" node "$DEV" hardis:project:version:list --no-fetch --json >"$LOGS/$label.json" 2>"$LOGS/$label.err"
  }
  vl local-base
  base_next=$(next_uat local-base)
  record LOCAL-BASE "$([ -n "$base_next" ] && echo OK || echo FAIL)" "next version of a promotion integration -> uat: ${base_next:-none}"
  if [ "$PART" = "custom" ]; then
    vl local-env SFDX_HARDIS_RELEASE_VERSIONING_VAR_PI=7 SFDX_HARDIS_RELEASE_VERSIONING_VAR_IT=1
    got=$(next_uat local-env)
    if [[ "$got" == *-pi7-it1-uat-rc1 ]]; then
      record LOCAL-ENV OK "with SFDX_HARDIS_RELEASE_VERSIONING_VAR_PI=7 and _IT=1, the next uat version is $got"
    else
      record LOCAL-ENV FAIL "with PI=7 IT=1 in the environment, the next uat version is ${got:-none}, expected *-pi7-it1-uat-rc1"
    fi
    sed -i 's/^releaseVersioningTagFormat: .*/releaseVersioningTagFormat: v{MAJ}.{MIN}{PATCH}-rc{RC}/' config/branches/.sfdx-hardis.uat.yml
    vl local-invalid
    got=$(next_uat local-invalid)
    # The warning is read from a run without --json, which prints the logs
    env -u NODE_OPTIONS -u CI node "$DEV" hardis:project:version:list --no-fetch >"$LOGS/local-invalid-text.log" 2>&1
    if grep -aq "Invalid releaseVersioningTagFormat" "$LOGS/local-invalid-text.log" && [[ "$got" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$ ]]; then
      record LOCAL-INVALID OK "an invalid uat format logs a warning, the default format is used: $got"
    else
      record LOCAL-INVALID FAIL "invalid uat format: next version ${got:-none}, warning lines $(grep -ac 'Invalid releaseVersioningTagFormat' "$LOGS/local-invalid-text.log")"
    fi
    sed -i 's/^releaseVersioningTagFormat: .*/releaseVersioningTagFormat: v{MAJ}.{MIN}.{PATCH}-s{SPRINT}-rc{RC}/' config/branches/.sfdx-hardis.uat.yml
    vl local-missing
    got=$(next_uat local-missing)
    if [ -z "$got" ]; then
      record LOCAL-MISSING OK "a format variable without value ({SPRINT}): no next version for uat"
    else
      record LOCAL-MISSING FAIL "a format variable without value gives the next version $got"
    fi
    git checkout -q -- config/branches/.sfdx-hardis.uat.yml
  fi
fi

# ------------------------------------------------------------------ version-list: what hardis:project:version:list says at the end
if step version-list; then
  cd "$WORK" || exit 1
  git fetch -q origin --tags --force && git checkout -q -f -B main origin/main
  env -u NODE_OPTIONS -u CI node "$DEV" hardis:project:version:list --json >"$LOGS/version-list.json" 2>"$LOGS/version-list.err"
  current() { json_of "((j.result.branches.find(b=>b.branchName==='$1')||{}).current||{}).tag" <"$LOGS/version-list.json"; }
  history() { json_of "j.result.history.map(h=>h.tag).sort().join(' ')" <"$LOGS/version-list.json"; }
  if [ "$PART" = "default" ]; then
    want_current="uat=v1.6.0-rc.1 preprod=v1.5.0-rc.3 main=v1.4.1"
    want_history="v1.3.0 v1.4.0 v1.4.0-rc.1 v1.4.0-rc.2 v1.4.0-rc.3 v1.4.1 v1.4.1-rc.1 v1.5.0-rc.1 v1.5.0-rc.2 v1.5.0-rc.3 v1.6.0-rc.1"
  else
    want_current="uat=v1.1.0-uat-rc.1 preprod=v1.1.0-preprod-rc1 main=v1.1.0"
    want_history="v1.0.0 v1.0.0-pi2-it4-uat-rc1 v1.0.0-pi2-it4-uat-rc3 v1.0.0-preprod-rc1 v1.0.0-preprod-rc2 v1.1.0 v1.1.0-pi2-it5-uat-rc1 v1.1.0-pi3-it1-uat-rc1 v1.1.0-pi3-it2-uat-rc1 v1.1.0-pi3-it2-uat-rc2 v1.1.0-preprod-rc1 v1.1.0-uat-rc.1"
  fi
  got_current="uat=$(current uat) preprod=$(current preprod) main=$(current main)"
  if [ "$got_current" = "$want_current" ]; then
    record VL-CURRENT OK "current version of each branch: $got_current"
  else
    record VL-CURRENT FAIL "current versions $got_current, expected $want_current"
  fi
  got_history=$(history)
  want_sorted=$(tr ' ' '\n' <<<"$want_history" | sort | tr '\n' ' ' | sed 's/ $//')
  if [ "$got_history" = "$want_sorted" ]; then
    record VL-HISTORY OK "history: $got_history${HAND_TAG:+ (the hand-made $HAND_TAG is not read)}"
  else
    record VL-HISTORY FAIL "history [$got_history], expected [$want_sorted]"
  fi
fi

# ------------------------------------------------------------------ timeline: the captures as one animated GIF
if step timeline; then
  if [ "$CAPTURE" != "1" ] || ! ls "$SHOTS"/*-pipeline.png >/dev/null 2>&1; then
    record TIMELINE SKIP "no capture of the DevOps Pipeline (CAPTURE=$CAPTURE)"
  elif python "$HERE/rv-timeline.py" "$(native "$SHOTS")" "$(native "$LOGS/timeline.gif")" >"$LOGS/timeline.log" 2>&1; then
    record TIMELINE OK "timeline.gif: the DevOps Pipeline after each step, with its caption"
  elif grep -q "No module named 'PIL'" "$LOGS/timeline.log"; then
    record TIMELINE SKIP "Pillow is not installed (pip install pillow)"
  else
    record TIMELINE FAIL "timeline.gif not written, see timeline.log"
  fi
fi

# ------------------------------------------------------------------ report (the last result of each id)
if step report; then
  awk -F'\t' '{last[$1]=$0; if(!($1 in seen)){order[++n]=$1; seen[$1]=1}} END{for(i=1;i<=n;i++) print last[order[i]]}' "$RESULTS" >"$LOGS/results-last.tsv"
  ok=$(grep -c $'\tOK\t' "$LOGS/results-last.tsv")
  fail=$(grep -c $'\tFAIL\t' "$LOGS/results-last.tsv")
  skip=$(grep -c $'\tSKIP\t' "$LOGS/results-last.tsv")
  case "$PROVIDER" in
  github) REPO_URL="https://github.com/${REPO:-?}" ;;
  gitlab) REPO_URL="${GL_HOST:-?}/${PROJECT_PATH:-?}" ;;
  esac
  {
    echo "# Release versioning e2e ($PART) - $RUN"
    echo
    echo "- provider: $PROVIDER, repository: $REPO_URL"
    echo "- sfdx-hardis branch: $SFDX_HARDIS_BRANCH ($(git -C "$ROOT" rev-parse --short HEAD))"
    echo "- extension: $EXT ($(git -C "$EXT" branch --show-current 2>/dev/null) $(git -C "$EXT" rev-parse --short HEAD 2>/dev/null))"
    echo "- org: $ORG (${ORG_USERNAME:-?}) for integration, uat, preprod and main"
    echo "- result: $ok OK, $fail FAIL, $skip SKIP"
    echo
    echo "| Check | Result | Detail |"
    echo "|-------|--------|--------|"
    awk -F'\t' '{gsub(/\|/,"\\|",$3); printf "| %s | %s | %s |\n", $1, $2, $3}' "$LOGS/results-last.tsv"
    echo
    if [ -f "$LOGS/timeline.gif" ]; then
      echo "## Timeline"
      echo
      echo "![The DevOps Pipeline after each step](timeline.gif)"
      echo
    fi
    if [ -f "$SHOTS/captions.tsv" ]; then
      echo "## The DevOps Pipeline after each step"
      echo
      while IFS=$'\t' read -r id caption; do
        echo "### $id - $caption"
        echo
        for shot in "$SHOTS/$id"-*.png; do
          [ -f "$shot" ] && echo "![$id $(basename "$shot" .png)](shots/$(basename "$shot"))" && echo
        done
      done <"$SHOTS/captions.tsv"
    fi
    echo "## CI jobs"
    echo
    echo '```'
    column -t -s $'\t' "$LOGS/ci-jobs.tsv" 2>/dev/null || cat "$LOGS/ci-jobs.tsv"
    echo '```'
  } >"$LOGS/report.md"
  # The report, its results, its captures and the timeline in the git-ignored hardis-report folder of
  # the working copy: nothing of a run is committed. rv-showcase.py builds the artifact page from it.
  REPORT_DIR="$ROOT/hardis-report/e2e/release-versioning/$RUN"
  mkdir -p "$REPORT_DIR"
  cp "$LOGS/report.md" "$LOGS/results-last.tsv" "$REPORT_DIR/"
  [ -d "$SHOTS" ] && cp -r "$SHOTS" "$REPORT_DIR/"
  [ -f "$LOGS/timeline.gif" ] && cp "$LOGS/timeline.gif" "$REPORT_DIR/"
  node -e 'const [run,part,provider,repo,branch,commit,extension]=process.argv.slice(1);console.log(JSON.stringify({run,part,provider,repo,branch,commit,extension,date:new Date().toISOString().slice(0,10)},null,2))' \
    "$RUN" "$PART" "$PROVIDER" "$REPO_URL" "$SFDX_HARDIS_BRANCH" "$(git -C "$ROOT" rev-parse --short HEAD)" \
    "$(git -C "$EXT" branch --show-current 2>/dev/null) $(git -C "$EXT" rev-parse --short HEAD 2>/dev/null)" >"$REPORT_DIR/meta.json"
  say "report: $REPORT_DIR/report.md ($ok OK, $fail FAIL, $skip SKIP)"
fi
echo "RV E2E DONE"
