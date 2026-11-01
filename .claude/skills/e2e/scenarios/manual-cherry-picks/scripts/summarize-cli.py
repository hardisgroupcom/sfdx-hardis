"""One line per candidate of each list-candidates result: what the detection said about it.

    python summarize-cli.py <OUT folder> <e2e-state file> <name>-<setting>-<source>-<target> ...
"""
import json
import os
import sys

out, state_file = sys.argv[1], sys.argv[2]
state = dict(line.strip().split("=", 1) for line in open(state_file, encoding="utf-8") if "=" in line)
# Merge request number -> story label, and commits -> their name, for readable lines
labels = {state[k]: k[:-3] for k in state if k.endswith("_MR")}
commits = {state[k]: k for k in state if not k.endswith("_MR") and len(state[k]) == 40}


def name_of(sha):
    for full, key in commits.items():
        if sha and (full.startswith(sha) or sha.startswith(full)):
            return key
    return (sha or "")[:8]


def describe(entry):
    numbers = ", ".join(f"!{n} {labels.get(str(n), '')}".strip() for n in entry.get("pullRequests", [])) or f"commit {name_of(entry.get('commit'))}"
    by = entry.get("alreadyPromotedBy")
    if by and by.get("manualCherryPick"):
        manual = by["manualCherryPick"]
        carrier = manual.get("carrier") or {}
        via = f"!{carrier['pullRequest']} {labels.get(str(carrier['pullRequest']), '')}" if carrier.get("pullRequest") else f"commit {name_of(manual.get('targetCommit'))}"
        own = ""
        if "ownCommits" in carrier:
            own = f" (held source commits: {carrier.get('heldSourceBranchCommits')}, own commits: {carrier.get('ownCommits')})"
        return f"{numbers}: MOVED by {manual['signal']} via {via}{own}"
    if by:
        return f"{numbers}: PROMOTED by {by.get('branch')}"
    if entry.get("partiallyCherryPicked"):
        part = entry["partiallyCherryPicked"]
        return f"{numbers}: PARTIAL {len(part.get('foundCommits', []))}/{part.get('totalCommits')}"
    if entry.get("probablyCherryPicked"):
        return f"{numbers}: PROBABLE ({entry['probablyCherryPicked'].get('subject')})"
    return f"{numbers}: candidate"


for run in sys.argv[3:]:
    data = json.load(open(os.path.join(out, run + ".json"), encoding="utf-8"))
    print(f"== {run}")
    rows = list(data.get("candidates", [])) + list(data.get("alreadyPromoted", []))
    for line in sorted(describe(entry) for entry in rows):
        print("   " + line)
