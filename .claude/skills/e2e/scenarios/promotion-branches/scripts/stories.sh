#!/usr/bin/env bash
# The six User Stories of the promotion-branches end to end test. Provider agnostic: source this
# file, the caller opens the Pull Requests and passes their numbers back.
#
#   source stories.sh
#   story_branch feature/E2E-101-alpha integration E2E_S1   # branch + static resource, pushed
#   ...open the Pull Request, get its number...
#   story_actions feature/E2E-101-alpha 1 pre-command+post-manual   # second commit, pushed
#
# One static resource per story, never a shared file: unrelated stories must not conflict.

: "${WORK:?set WORK to the local clone}"
: "${API:=67.0}"

# Create the story branch from its target, add its own static resource, push.
# Usage: story_branch <branch> <target branch> <resource name>
story_branch() {
  local branch="$1" target="$2" resource="$3"
  cd "$WORK" || return 1
  git checkout -q -f "$target" && git pull -q origin "$target"
  git checkout -q -b "$branch"
  mkdir -p force-app/main/default/staticresources
  printf 'promotion branches end to end test: %s\n' "$resource" \
    >"force-app/main/default/staticresources/$resource.resource"
  cat >"force-app/main/default/staticresources/$resource.resource-meta.xml" <<META
<?xml version="1.0" encoding="UTF-8"?>
<StaticResource xmlns="http://soap.sforce.com/2006/04/metadata">
    <cacheControl>Public</cacheControl>
    <contentType>text/plain</contentType>
    <description>$resource</description>
</StaticResource>
META
  # Only the files of the story: hardis-report/ is deliberately not gitignored, and a `git add -A`
  # would commit the reports a previous sfdx-hardis command left in the tree
  git add "force-app/main/default/staticresources/$resource.resource" "force-app/main/default/staticresources/$resource.resource-meta.xml"
  git commit -qm "feat: $resource"
  git push -q -u origin "$branch"
  echo "story_branch $branch -> $target ($resource)"
}

# The deployment actions of a story, in the file that travels with the cherry-picked commit.
# Usage: story_actions <branch> <pull request number> <kind>
#   kind: pre-command+post-manual | post-command | pre-command | recovery | pre-manual
#         identical | identical-twice | identical-check | identical-pre | same-id-a | same-id-b | flaky-uat
#         (section 6sexies)
story_actions() {
  local branch="$1" pr="$2" kind="$3"
  cd "$WORK" || return 1
  git checkout -q -f "$branch" && git pull -q origin "$branch"
  mkdir -p scripts/actions
  local file="scripts/actions/.sfdx-hardis.$pr.yml"
  case "$kind" in
  pre-command+post-manual)
    cat >"$file" <<YAML
commandsPreDeploy:
  - id: e2e-pre-$pr
    label: E2E pre-deploy of PR $pr
    type: command
    command: echo "E2E pre-deploy of PR $pr"
    context: all

commandsPostDeploy:
  - id: e2e-manual-$pr
    label: E2E manual step of PR $pr
    type: manual
    parameters:
      instructions: |
        Setup -> Quick Find -> Custom Labels -> open **PromoE2EShared** and read its value.
        Nothing to change: tick this box once you have read it.
    context: process-deployment-only
YAML
    ;;
  post-command)
    cat >"$file" <<YAML
commandsPostDeploy:
  - id: e2e-post-$pr
    label: E2E post-deploy of PR $pr
    type: command
    command: echo "E2E post-deploy of PR $pr"
    context: all
YAML
    ;;
  pre-command)
    cat >"$file" <<YAML
commandsPreDeploy:
  - id: e2e-pre-$pr
    label: E2E pre-deploy of PR $pr
    type: command
    command: echo "E2E pre-deploy of PR $pr"
    context: all
YAML
    ;;
  recovery)
    # Section 6quater: a pre-deployment manual step (stops the validation until it is marked as done),
    # a post-deployment command failing until e2e-recovery-ok.txt exists in the working copy, the
    # command it stops, and a post-deployment manual step
    mkdir -p scripts/e2e
    echo "process.exit(require('fs').existsSync('e2e-recovery-ok.txt') ? 0 : 1);" >"scripts/e2e/flaky-$pr.cjs"
    git add "scripts/e2e/flaky-$pr.cjs"
    cat >"$file" <<YAML
commandsPreDeploy:
  - id: e2e-gate-$pr
    label: E2E pre-deploy manual of PR $pr
    type: manual
    parameters:
      instructions: Nothing to do in the org, mark it as done.

commandsPostDeploy:
  - id: e2e-flaky-$pr
    label: E2E flaky post-deploy of PR $pr
    type: command
    command: node scripts/e2e/flaky-$pr.cjs
    context: process-deployment-only
  - id: e2e-after-flaky-$pr
    label: E2E after the flaky one of PR $pr
    type: command
    command: echo "E2E after the flaky one of PR $pr"
    context: process-deployment-only
  - id: e2e-manual-$pr
    label: E2E manual step of PR $pr
    type: manual
    parameters:
      instructions: Nothing to do in the org, mark it as done.
    context: process-deployment-only
YAML
    ;;
  pre-manual)
    cat >"$file" <<YAML
commandsPreDeploy:
  - id: e2e-gate-$pr
    label: E2E pre-deploy manual of PR $pr
    type: manual
    parameters:
      instructions: Nothing to do in the org, mark it as done.
YAML
    ;;
  identical)
    # Section 6sexies: the shared step. Every story carrying it writes the same command, so the
    # actions are identical whatever their id and label. It appends one character to
    # e2e-identical-count.txt (untracked), which counts the real runs of a job
    cat >"$file" <<YAML
commandsPostDeploy:
  - id: e2e-shared-$pr
    label: E2E shared step of PR $pr
    type: command
    command: >-
      node -e "require('fs').appendFileSync('e2e-identical-count.txt','r')"
    context: process-deployment-only
YAML
    ;;
  identical-twice)
    # The shared step written twice in one Pull Request, another step between them: meant twice
    cat >"$file" <<YAML
commandsPostDeploy:
  - id: e2e-shared-$pr
    label: E2E shared step of PR $pr
    type: command
    command: >-
      node -e "require('fs').appendFileSync('e2e-identical-count.txt','r')"
    context: process-deployment-only
  - id: e2e-between-$pr
    label: E2E step between the shared steps of PR $pr
    type: command
    command: echo "E2E step between the shared steps of PR $pr"
    context: process-deployment-only
  - id: e2e-shared-again-$pr
    label: E2E shared step again of PR $pr
    type: command
    command: >-
      node -e "require('fs').appendFileSync('e2e-identical-count.txt','r')"
    context: process-deployment-only
YAML
    ;;
  identical-check)
    # The shared step with context all: the validation job runs it too, once for the Pull Requests
    # that carry it, and the deployment job finds them done
    cat >"$file" <<YAML
commandsPostDeploy:
  - id: e2e-check-shared-$pr
    label: E2E shared check step of PR $pr
    type: command
    command: >-
      node -e "require('fs').appendFileSync('e2e-identical-count.txt','r')"
    context: all
YAML
    ;;
  identical-pre)
    # The same command before the deployment: another phase, never merged with the post-deploy ones
    cat >"$file" <<YAML
commandsPreDeploy:
  - id: e2e-shared-pre-$pr
    label: E2E shared step before the deployment of PR $pr
    type: command
    command: >-
      node -e "require('fs').appendFileSync('e2e-identical-count.txt','r')"
    context: process-deployment-only
YAML
    ;;
  same-id-a | same-id-b)
    # Two Pull Requests reusing one hand-written id with different commands: both must run
    local variant
    variant=$(printf '%s' "${kind#same-id-}" | tr '[:lower:]' '[:upper:]')
    cat >"$file" <<YAML
commandsPostDeploy:
  - id: e2e-same-id
    label: E2E same id, command $variant of PR $pr
    type: command
    command: echo "E2E same id, command $variant"
    context: process-deployment-only
YAML
    ;;
  flaky-uat)
    # A post-deployment command failing in uat until e2e-identical-ok.txt exists in the working copy.
    # One script per story: a shared file would only reach the branch with the first story
    mkdir -p scripts/e2e
    echo "process.exit(require('fs').existsSync('e2e-identical-ok.txt') ? 0 : 1);" >"scripts/e2e/flaky-$pr.cjs"
    git add "scripts/e2e/flaky-$pr.cjs"
    cat >"$file" <<YAML
commandsPostDeploy:
  - id: e2e-flaky-$pr
    label: E2E flaky post-deploy of PR $pr
    type: command
    command: node scripts/e2e/flaky-$pr.cjs
    context: process-deployment-only
    includeTargetBranches:
      - uat
YAML
    ;;
  *)
    echo "unknown action kind: $kind" >&2
    return 1
    ;;
  esac
  git add "$file"
  git commit -qm "chore: deployment actions of PR $pr"
  git push -q origin "$branch"
  echo "story_actions $branch PR $pr ($kind)"
}
