#!/usr/bin/env bash
# Sourced by every shell script of this skill. Nothing is hardcoded to one
# machine: the paths are derived from this file's own location, which is
# <sfdx-hardis>/.claude/skills/training-e2e/scripts/, and each one can be
# overridden with an environment variable.
E2E_HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HARDIS=${SFDX_HARDIS_DIR:-$(cd "$E2E_HERE/../../../.." && pwd)}
SIBLINGS=$(cd "$HARDIS/.." && pwd)
COURSE=${COURSE:-$SIBLINGS/sfdx-hardis-training}
RUN=${RUN:-$SIBLINGS/training-run}
MONRUN=${MONRUN:-$SIBLINGS/training-monitoring}
LOGS=${LOGS:-$SIBLINGS/training-e2e}
UPSTREAM=${UPSTREAM:-hardisgroupcom/sfdx-hardis-training}
# GH_LOGIN, FORK and MONREPO are resolved by the same rules as env.mjs: the two
# halves of the harness must never end up pointing at different repositories.
GH_LOGIN=${GH_LOGIN:-$(gh api user -q .login)}
FORK=${FORK:-$GH_LOGIN/sfdx-hardis-training}
MONREPO=${MONREPO:-${FORK%%/*}/sfdx-hardis-training-monitoring}
export E2E_HERE HARDIS SIBLINGS COURSE RUN MONRUN LOGS UPSTREAM GH_LOGIN FORK MONREPO
