"""Showcase page of release versioning end to end runs, published as a claude.ai artifact.

Reads the run folders written by the report step of rv-e2e.sh (meta.json, results-last.tsv,
shots/captions.tsv, shots/*.png) and writes <out>/index.html with <out>/shots/<run>/*.png next to
it: one page for every run, the DevOps Pipeline after each step, the other captures of the step,
and every check. Publish the folder with the publish_files tool of the claude-artifacts server.

    python rv-showcase.py <out folder> <run folder> [<run folder> ...] [--findings findings.json]

findings.json: [{"kind": "bug" | "fixed" | "question" | "harness" | "environment", "title": "...", "text": "..."}]

The captures are cropped to the editor area of VS Code (no title bar, activity bar or status bar),
with Pillow when it is installed, else copied as they are.
"""

import argparse
import csv
import json
import re
import shutil
import sys
from pathlib import Path

TAG_DETAIL = re.compile(r"^([\w./-]+): (\S+) on ")
# Editor area of a 1920 x 1020 capture of the UI harness: left, top, right, bottom
EDITOR_AREA = (62, 86, 1898, 986)


def copy_capture(source: Path, target: Path) -> None:
    try:
        from PIL import Image
    except ImportError:
        shutil.copyfile(source, target)
        return
    with Image.open(source) as image:
        if image.size == (1920, 1020):
            image = image.crop(EDITOR_AREA)
        image.save(target, optimize=True)


def read_run(folder: Path) -> dict:
    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    checks = []
    with (folder / "results-last.tsv").open(encoding="utf-8") as handle:
        for row in csv.reader(handle, delimiter="\t", quoting=csv.QUOTE_NONE):
            if len(row) >= 2:
                checks.append(
                    {
                        "id": row[0],
                        "status": row[1],
                        "detail": row[2] if len(row) > 2 else "",
                    }
                )
    captions = {}
    captions_file = folder / "shots" / "captions.tsv"
    if captions_file.exists():
        with captions_file.open(encoding="utf-8") as handle:
            for row in csv.reader(handle, delimiter="\t", quoting=csv.QUOTE_NONE):
                if len(row) >= 2:
                    captions[row[0]] = row[1]
    shots = sorted(p.name for p in (folder / "shots").glob("*.png"))
    steps = []
    for step_id, caption in captions.items():
        tag = branch = ""
        for check in checks:
            if check["id"] == f"{step_id}-TAG":
                match = TAG_DETAIL.match(check["detail"])
                if match:
                    branch, tag = match.group(1), match.group(2)
        step_checks = [c for c in checks if c["id"].startswith(step_id + "-")]
        steps.append(
            {
                "id": step_id,
                "caption": caption,
                "branch": branch,
                "tag": tag,
                "shots": [s for s in shots if s.startswith(step_id + "-")],
                "ok": all(c["status"] != "FAIL" for c in step_checks),
            }
        )
    meta["steps"] = steps
    meta["checks"] = checks
    meta["count"] = {
        s: sum(1 for c in checks if c["status"] == s) for s in ("OK", "FAIL", "SKIP")
    }
    return meta


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("out")
    parser.add_argument("runs", nargs="+")
    parser.add_argument("--findings", default="")
    args = parser.parse_args()
    out = Path(args.out)
    (out / "shots").mkdir(parents=True, exist_ok=True)
    runs = []
    for folder in map(Path, args.runs):
        run = read_run(folder)
        target = out / "shots" / run["run"]
        target.mkdir(parents=True, exist_ok=True)
        for step in run["steps"]:
            for shot in step["shots"]:
                copy_capture(folder / "shots" / shot, target / shot)
        runs.append(run)
    findings = (
        json.loads(Path(args.findings).read_text(encoding="utf-8"))
        if args.findings
        else []
    )
    data = json.dumps({"runs": runs, "findings": findings}, ensure_ascii=False).replace(
        "</", "<\\/"
    )
    template = (Path(__file__).parent / "rv-showcase.html").read_text(encoding="utf-8")
    (out / "index.html").write_text(
        template.replace("/*DATA*/null", data), encoding="utf-8"
    )
    total = {s: sum(r["count"][s] for r in runs) for s in ("OK", "FAIL", "SKIP")}
    print(
        f"{out / 'index.html'}: {len(runs)} runs, {total['OK']} OK, {total['FAIL']} FAIL, {total['SKIP']} SKIP"
    )
    print("files:", sum(1 for _ in (out / "shots").rglob("*.png")) + 1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
