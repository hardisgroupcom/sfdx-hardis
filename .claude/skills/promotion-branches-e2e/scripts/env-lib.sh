#!/usr/bin/env bash
# shellcheck shell=bash
# Settings of the end to end scripts: the environment first, then the .env file at the root of the
# sfdx-hardis working copy, then defaults derived from where this skill sits. Sourced by every entry
# script and library of this skill, so exporting by hand is optional. Nothing here prints a value.
#
#   E2E_ROOT        the sfdx-hardis working copy (git rev-parse --show-toplevel of this skill)
#   E2E_MAIN_ROOT   the main working copy when E2E_ROOT is a git worktree (where .env and the
#                   sibling vscode-sfdx-hardis usually are), else E2E_ROOT
#   E2E_ENV_FILE    the dotenv file: <E2E_ROOT>/.env, else <E2E_MAIN_ROOT>/.env
#   E2E_TMP         the OS temp dir, as a path bash, node and python all read (C:/... on Windows)
#
#   e2e_native_path <path>        a path node and python resolve (cygpath -m when it exists)
#   e2e_dotenv_value <key> <file> one key of a dotenv file
#   e2e_load_env <VAR>...         sets each VAR the environment does not set, from E2E_ENV_FILE
#   e2e_defaults [<run name>]     ORG (from E2E_ORG), DEV, EXT, API, and with a run name WORK, LOGS
#                                 and EXPECT under E2E_TMP: <run name>, <run name>-logs, -expect
#
# The variables of reference/env.example are all loaded by e2e_defaults.

if [ -z "${E2E_ENV_LIB_LOADED:-}" ]; then
  E2E_ENV_LIB_LOADED=1
  _E2E_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  e2e_native_path() {
    if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s\n' "$1"; fi
  }

  # One key of a dotenv file, without printing it: KEY=value, quotes stripped
  e2e_dotenv_value() {
    [ -f "$2" ] || return 0
    grep -m1 -E "^(export +)?$1=" "$2" | tr -d '\r' | sed -E "s/^(export +)?$1=//; s/^[\"']//; s/[\"']$//"
  }

  if [ -z "${E2E_ROOT:-}" ]; then
    E2E_ROOT="$(git -C "$_E2E_ENV_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$_E2E_ENV_DIR/../../../.." && pwd))"
  fi
  E2E_ROOT="$(e2e_native_path "$E2E_ROOT")"
  if [ -z "${E2E_MAIN_ROOT:-}" ]; then
    _e2e_common="$(git -C "$E2E_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
    if [ -n "$_e2e_common" ] && [ "$(basename "$_e2e_common")" = ".git" ]; then
      E2E_MAIN_ROOT="$(e2e_native_path "$(dirname "$_e2e_common")")"
    else
      E2E_MAIN_ROOT="$E2E_ROOT"
    fi
  fi
  if [ -z "${E2E_ENV_FILE:-}" ]; then
    E2E_ENV_FILE="$E2E_ROOT/.env"
    [ -f "$E2E_ENV_FILE" ] || E2E_ENV_FILE="$E2E_MAIN_ROOT/.env"
  fi
  if [ -z "${E2E_TMP:-}" ]; then
    _e2e_tmp="${TMPDIR:-${TEMP:-/tmp}}"
    E2E_TMP="$(e2e_native_path "${_e2e_tmp%/}")"
  fi
  export E2E_ROOT E2E_MAIN_ROOT E2E_ENV_FILE E2E_TMP

  # Sets each variable the environment does not set (unset, not empty) from the dotenv file
  e2e_load_env() {
    local name value
    for name in "$@"; do
      if [ -z "${!name+x}" ]; then
        value="$(e2e_dotenv_value "$name" "$E2E_ENV_FILE")"
        if [ -n "$value" ]; then
          printf -v "$name" '%s' "$value"
          # shellcheck disable=SC2163 # export the variable named by $name
          export "$name"
        fi
      fi
    done
  }

  # Every variable of reference/env.example
  E2E_ENV_VARS="E2E_ORG DEVHUB DEVORG DEVORG2 DEV_ORG API SFDX_HARDIS_BRANCH SFDX_HARDIS_IMAGE SFDX_HARDIS_VERSION
GH_E2E_OWNER GITLAB_E2E_HOST GITLAB_E2E_GROUP GITLAB_RUNNER_TAG GITLAB_E2E_CI_TOKEN
AZURE_PERSONAL_ACCESS_TOKEN AZ_ORG AZ_PROJECT AZURE_E2E_CI_TOKEN
ATLASSIAN_TOKEN ATLASSIAN_EMAIL BB_WORKSPACE BB_PROJECT_KEY
CI_WAIT_APPEAR_SECONDS CI_WAIT_QUEUE_SECONDS CI_WAIT_JOB_SECONDS"

  e2e_defaults() {
    # shellcheck disable=SC2086 # a list of names on purpose
    e2e_load_env $E2E_ENV_VARS
    ORG="${ORG:-${E2E_ORG:-}}"
    DEV="${DEV:-$E2E_ROOT/bin/dev.js}"
    EXT="${EXT:-$(dirname "$E2E_MAIN_ROOT")/vscode-sfdx-hardis}"
    API="${API:-67.0}"
    export ORG DEV EXT API
    if [ -n "${1:-}" ]; then
      WORK="${WORK:-$E2E_TMP/$1}"
      LOGS="${LOGS:-$E2E_TMP/$1-logs}"
      EXPECT="${EXPECT:-$E2E_TMP/$1-expect}"
      export WORK LOGS EXPECT
    fi
  }
fi
