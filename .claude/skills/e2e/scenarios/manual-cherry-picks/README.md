# Manual cherry-picks: end to end test

Proves `detectManualCherryPicks` (Beta) on a real GitLab project built through real merge requests:
what `hardis:project:promotion:list-candidates` finds on each promotion step, and where the DevOps
Pipeline of vscode-sfdx-hardis lists each story. It also proves that with the setting off, the CLI
JSON and the pipeline are exactly what `main` gives.

No Salesforce org and no CI job: the CLI runs locally with the GitLab connection in the
environment, and the extension's own `PipelineDataProvider` runs headless
(`../promotion-branches/scripts/check-pipeline.cjs`), starting the real `sf` on the PATH.

## The repository

`scripts/build-repo.sh` creates a private project in the namespace of the token and builds, through
merge requests merged by the API (merge commit, or squash), one story per pattern:

| Story | How it reaches uat                                                                          | Expected with the setting on          |
|-------|---------------------------------------------------------------------------------------------|---------------------------------------|
| S1    | picked `-x` into release/1, squash-merged into uat (R1)                                     | moved (provider listing)              |
| S2    | picked `-x` into release/2, merged with a merge commit (R2)                                 | moved (trailer of uat)                |
| S3    | picked `-x` straight onto uat, then uat is back-merged into integration                     | moved (trailer before the merge base) |
| S4    | picked without `-x` straight onto uat                                                       | probable (same title)                 |
| S5    | two commits, the first one picked `-x` onto uat                                             | partial 1/2                           |
| S6    | dragged by hotfix/h branched from integration with a fix of its own, squashed into uat (HF) | moved, HF stays listed                |
| S7    | a real promotion branch (`promotion:create`)                                                | promoted, not a manual pick           |
| S8    | nothing                                                                                     | candidate                             |
| S9    | picked into release/9, a merge request opened before S9 was merged, squashed (R9)           | moved                                 |
| R1    | its squash commit picked `-x` onto preprod (step uat -> preprod)                            | moved, S1 follows it to preprod       |
| S10   | merged into uat directly                                                                    | candidate of uat -> preprod           |

Phase B merges uat into preprod with a merge commit: every story waiting in uat must then be listed
in preprod, none in no window.

## Run

```bash
export GL_HOST=https://<gitlab host> GL_TOKEN="$(glab config get token --host <gitlab host>)"
export WORK="$TEMP/mcp-e2e/work" NAME=mcp-e2e-<date>
S=.claude/skills/e2e/scenarios/manual-cherry-picks/scripts
bash $S/build-repo.sh                       # writes $WORK/../e2e-state

# CLI builds to compare: worktrees of main (and of any older commit) with a node_modules junction
# to the main working copy (PowerShell New-Item -ItemType Junction), compiled with
# node node_modules/typescript/bin/tsc -p .
OUT="$TEMP/mcp-e2e/cli-a" bash $S/run-cli.sh main=<main wt>/bin/run.js new=/c/git/sfdx-hardis/bin/run.js
cmp $OUT/main-off-integration-uat.json $OUT/new-off-integration-uat.json   # must be identical
python $S/summarize-cli.py $OUT $WORK/../e2e-state new-on-integration-uat new-on-uat-preprod

# Extension: an extension worktree compiled with tsc, the branch clone compiled with yarn compile
EXT=<ext main wt> bash $S/run-pipeline.sh off main-off.json
EXT=../vscode-sfdx-hardis bash $S/run-pipeline.sh off new-off.json   # same dump as main
EXT=../vscode-sfdx-hardis bash $S/run-pipeline.sh on new-on.json     # windows and flags
```

Then merge uat into preprod with a merge request (merge commit) and run the pipeline dumps again.

## Traps

- The merge request of phase B must keep `uat`: pass `remove_source_branch=false` when creating it
  (the project default deletes the source branch on merge). Without `uat`, every later
  `list-candidates` fails with `couldn't find remote ref uat`.
- A stale `oclif.manifest.json` in the working copy (gitignored) makes the linked `sf` warn
  "Mismatched version" and may hide new commands: regenerate it with
  `node node_modules/oclif/bin/run.js manifest` after a release.
- GitLab answers 400 to a merge request opened right after the push of its branch: `mr_open` retries.
- The state file lives next to the clone, never inside: a `git add -A` of a story would commit it.
- A Windows path inside a `python -c` source breaks on its backslashes: pass paths as arguments.
- Bash heredocs mangle backslashes on this machine: edit the scripts with the Edit tool.
- The linked `sf` runs the compiled `lib/` of the main working copy: `yarn compile` it before the
  extension dumps, or the extension asks an older CLI.
- With the setting on, the back-merge commit of integration is a candidate with no number. `main`
  lists it the same way: not part of this feature.
- release/2, merged with a merge commit, stays a row of uat: S2 is found by the trailer of uat's own
  history, which names a commit, not the merge request, so the merge request is never flagged as a
  carrier. Same before the review fixes.

## Cleanup

Delete the project (`curl -X DELETE $GL_HOST/api/v4/projects/<id>`) and the worktrees
(`git worktree remove --force`) once the report is written.
