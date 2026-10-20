"""Normalise two job log folders (timestamps, ids, durations, temp paths) and diff them.

Usage: PYTHONIOENCODING=utf-8 python ab-diff.py <dir-a> <dir-b>

Prints, per log file, the lines present in one run and not the other once the noise is gone.
Used to prove that a project with enablePromotionBranches off gets exactly the jobs it got before.
"""
import io
import os
import re
import sys

NOISE = [
    (re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?(?:[+-]\d{2}:\d{2})?"), "<TS>"),
    (re.compile(r"\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}Z"), "<TS>"),
    (re.compile(r"\d{4}-\d{2}-\d{2}"), "<DATE>"),
    (re.compile(r"\b0Af[0-9A-Za-z]{15}\b"), "<DEPLOY_ID>"),
    (re.compile(r"\b0:\d{2}:\d{2}\.\d{3}\b"), "<DURATION>"),
    (re.compile(r"\(node:\d+\)"), "(node:<PID>)"),
    (re.compile(r"ws://127\.0\.0\.1:\d+/[0-9a-f-]+"), "<INSPECTOR>"),
    (re.compile(r"issuecomment-\d+"), "issuecomment-<ID>"),
    (re.compile(r"[0-9a-f]{40}"), "<SHA40>"),
    (re.compile(r"\b[0-9a-f]{7}\b"), "<SHA7>"),
    (re.compile(r"\d+(\.\d+)?\s?(ms|s)\b"), "<ELAPSED>"),
    (re.compile(r"hardis-report[\\/][^\s\"']+"), "hardis-report/<FILE>"),
    (re.compile(r"[A-Za-z]:\\[^\s\"']+"), "<PATH>"),
    (re.compile(r"ab-\d+"), "<AB_BRANCH>"),
]
DROP = [
    re.compile(r"^Debugger (listening|attached)"),
    re.compile(r"^For help, see: https://nodejs.org"),
    re.compile(r"^Waiting for the debugger"),
    re.compile(r"^\s*$"),
    re.compile(r"Last updated:"),
]


def normalise(path):
    lines = []
    for raw in io.open(path, encoding="utf-8", errors="replace"):
        line = raw.rstrip("\r\n")
        if any(pattern.search(line) for pattern in DROP):
            continue
        for pattern, replacement in NOISE:
            line = pattern.sub(replacement, line)
        lines.append(line)
    return lines


def main(dir_a, dir_b):
    names = sorted(set(os.listdir(dir_a)) & set(os.listdir(dir_b)))
    total = 0
    for name in names:
        a = normalise(os.path.join(dir_a, name))
        b = normalise(os.path.join(dir_b, name))
        only_a = [line for line in a if line not in b]
        only_b = [line for line in b if line not in a]
        print("=" * 100)
        print("%s: %d lines vs %d lines, only in A: %d, only in B: %d"
              % (name, len(a), len(b), len(only_a), len(only_b)))
        for line in only_a:
            print("  A> " + line)
        for line in only_b:
            print("  B> " + line)
        total += len(only_a) + len(only_b)
    print("=" * 100)
    print("TOTAL DIFFERING LINES: %d" % total)
    return 0 if total == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
