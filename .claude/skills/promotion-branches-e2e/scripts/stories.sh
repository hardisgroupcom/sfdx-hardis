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
  git add "force-app/main/default/staticresources/$resource.resource"     "force-app/main/default/staticresources/$resource.resource-meta.xml"
  git commit -qm "feat: $resource"
  git push -q -u origin "$branch"
  echo "story_branch $branch -> $target ($resource)"
}

# The deployment actions of a story, in the file that travels with the cherry-picked commit.
# Usage: story_actions <branch> <pull request number> <kind>
#   kind: pre-command+post-manual | post-command | pre-command
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
