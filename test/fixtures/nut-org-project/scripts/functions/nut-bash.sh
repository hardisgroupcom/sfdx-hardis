#!/usr/bin/env bash
# Custom function fixture, bash runtime.
#
# Same contract as the node one: log the inputs, then print the outputs as a JSON object on the
# last non-empty line of stdout.
set -euo pipefail

echo "HARDIS_NUT_BASH_FUNCTION_RAN"
echo "bash environment=${SFDX_HARDIS_IN_ENVIRONMENT:-}"
echo "bash targetBranch=${SFDX_HARDIS_TARGET_BRANCH:-}"

echo "{\"bashReport\":\"bash-report-1\",\"bashStatus\":\"ok\"}"
