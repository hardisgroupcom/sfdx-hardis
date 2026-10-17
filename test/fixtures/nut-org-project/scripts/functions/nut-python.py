"""Custom function fixture, python runtime.

Same contract as the node and bash ones: log the inputs, then print the outputs as a JSON
object on the last non-empty line of stdout. It also consumes what the earlier functions
returned, passed to it as an ordinary input by a replacement in the action parameters.
"""
import json
import os

print("HARDIS_NUT_PYTHON_FUNCTION_RAN")
print("python severity=" + os.environ.get("SFDX_HARDIS_IN_SEVERITY", ""))
print("python fromNode=" + os.environ.get("SFDX_HARDIS_IN_FROMNODE", ""))
print("python fromBash=" + os.environ.get("SFDX_HARDIS_IN_FROMBASH", ""))
print("python targetBranch=" + os.environ.get("SFDX_HARDIS_TARGET_BRANCH", ""))

print(json.dumps({"pythonSummary": "python-summary-1"}))
