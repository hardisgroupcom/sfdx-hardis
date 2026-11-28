#!/bin/sh
# Lint the staged files with MegaLinter native mode (NATIVE_LINTERS in .mega-linter.yml), without Docker.
# Called by .husky/pre-commit. CI still runs every active linter.
# Skipped when uv is missing: see https://megalinter.io/latest/install-native/
# Set SKIP_MEGALINTER_NATIVE=true to skip it for one commit.

if [ "$SKIP_MEGALINTER_NATIVE" = "true" ]; then
  exit 0
fi
if ! command -v uv >/dev/null 2>&1; then
  echo "[megalinter-native] uv not found: native MegaLinter skipped (https://megalinter.io/latest/install-native/)"
  exit 0
fi

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR)
if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# Prefer a global runner that knows native mode, else the beta runner from npm
if command -v mega-linter-runner >/dev/null 2>&1 && mega-linter-runner --help 2>/dev/null | grep -q -- "--native-setup"; then
  RUNNER="mega-linter-runner"
else
  RUNNER="npx --yes mega-linter-runner@beta"
fi

WORKTREE_BEFORE=$(git diff | git hash-object --stdin)

# shellcheck disable=SC2086
echo "$STAGED_FILES" | tr '\n' '\0' | xargs -0 $RUNNER --native --fix --filesonly --env CLEAR_REPORT_FOLDER=true --env LOG_LEVEL=warning
LINT_STATUS=$?

if [ "$LINT_STATUS" -ne 0 ]; then
  echo "[megalinter-native] Errors found: see megalinter-reports/linters_logs"
  exit "$LINT_STATUS"
fi

WORKTREE_AFTER=$(git diff | git hash-object --stdin)
if [ "$WORKTREE_BEFORE" != "$WORKTREE_AFTER" ]; then
  echo "[megalinter-native] Fixes were applied to some files: review them, git add them, then commit again"
  exit 1
fi
