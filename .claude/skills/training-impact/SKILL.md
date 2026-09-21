---
name: training-impact
description: Decide whether a change in sfdx-hardis or vscode-sfdx-hardis breaks a lab of the sfdx-hardis training, and name the labs it touches. Load it for any change to a command name or flag, a prompt, --json output, a config key, a report file, a documentation page URL, an LWC panel, or any behavior a lab walks through. Also use it when the user says "training impact", "does this break the course", "which labs use this", or asks to check the training before merging.
allowed-tools: Bash, Read, Grep, Glob
---

# Training impact

Three repositories move together now: sfdx-hardis, vscode-sfdx-hardis and
**sfdx-hardis-training**. The existing rule that every change states its VS Code extension impact
has a sibling: **every change states its training impact, even when it is "none"**.

This skill answers one question: *which labs does this change break, and does it need a training
Pull Request?*

It never edits the training repository. [[training-update]] does that, once this says there is an
impact.

## The sibling layout

`sfdx-hardis-training` is always a sibling of this repository, exactly like `vscode-sfdx-hardis`
already is:

```
C:/git/  (or wherever this repository lives)
├── sfdx-hardis/            <- the skills live here, and only here
├── sfdx-hardis-training/   <- sibling, cloned if absent
└── vscode-sfdx-hardis/     <- sibling, the screenshot harness
```

The path is never configurable: a fixed layout is what lets the skills act without asking.

**Clone it if it is missing**, do not fail and do not work from a temporary directory:

```bash
[ -d ../sfdx-hardis-training ] || git clone https://github.com/hardisgroupcom/sfdx-hardis-training.git ../sfdx-hardis-training
git -C ../sfdx-hardis-training fetch --all --prune
```

Read from the latest `main` unless the user says otherwise.

## What to read

`../sfdx-hardis-training/training-manifest.json`, generated from the `depends_on` front matter of
every lab. It holds, per lab: the commands, flags, config keys, documentation pages, panels and
screenshots it relies on, plus a `reverseIndex` keyed by each of those.

```bash
node -e "
const m = require('../sfdx-hardis-training/training-manifest.json');
const key = process.argv[1], value = process.argv[2];
console.log((m.reverseIndex[key] || {})[value] || 'no lab depends on it');
" commands hardis:work:save
```

It works offline and against the exact checked-out state, which is what makes this a check rather
than a habit.

## The course is in two languages, and one of them is the reference

The training ships in English and in French: `labs/en/` and `labs/fr/`, mirrored file for file.

**`labs/en/` is the reference, and the impact is always computed from it.** The manifest is
generated from the English front matter, so `reverseIndex` names English lab ids and nothing else.
That is correct and it is not a gap: a lab's `depends_on` is the same in every language, because the
commands, flags, config keys and panels it relies on are the same.

What it means for the answer you give: **a lab that is affected is affected in every locale.** Each
manifest entry carries a `translations` block naming the file and the URL of that lab in each other
locale, so name them:

```bash
node -e "
const m = require('../sfdx-hardis-training/training-manifest.json');
const lab = m.labs.find((one) => one.id === process.argv[1]);
console.log(lab.file, '+', Object.values(lab.translations || {}).map((t) => t.file).join(', '));
" lab-2-3
```

A change never breaks only the French version, and a French-only fix is never the answer: the
correction goes into `labs/en/` first and the translations follow. [[training-update]] has the
procedure.

## The procedure

1. **List what the change touches.** Be specific and literal:
    - command ids (`hardis:work:save`)
    - flags (`--check`, `--agent`)
    - config keys (`autoCleanTypes`, `useDeltaDeployment`)
    - documentation page slugs (`salesforce-devops-config-cleaning`)
    - LWC panels (`pipeline`, `backpromote`, `deploymentAction`)
    - report file names and shapes
2. **Look each one up in the reverse index.**
3. **Classify the impact** with the table below.
4. **State it in the analysis and in the design**, even when it is "none". Name the labs.

## Classifying

| What changed                                   | Training impact                                                                    | What it needs                                  |
|------------------------------------------------|------------------------------------------------------------------------------------|------------------------------------------------|
| A command is renamed or removed                | **Breaking.** Every lab naming it stops working                                    | A training Pull Request, in the same effort    |
| A flag is renamed, or its default changes      | **Breaking** if a lab relies on the behavior                                       | A training Pull Request                        |
| A prompt's wording or its choices change       | **Text only**, unless a lab tells the learner what to pick                         | Update the lab step                            |
| A config key is renamed                        | **Breaking.** Labs quote these in "Under the hood" blocks                          | A training Pull Request                        |
| `--json` output or a report file changes shape | **Breaking** if `scripts/verify/rules.mjs` reads it                                | A training Pull Request, and re-run the audit  |
| A documentation page is renamed                | **Breaking link.** `link-check.yml` catches it monthly, which is too late          | Update `depends_on.docs` and the lab links     |
| An LWC panel is redesigned                     | **Screenshots are wrong**, the text may still be right                             | [[training-update]] re-runs the Helios capture |
| A new feature, nothing existing changed        | **None**, unless it replaces a path a lab takes                                    | Say "none" and move on                         |
| Behaviour a seeded failure depends on          | **Breaking, and silent.** The lab still reads fine and the failure no longer fires | A training Pull Request, and re-walk the lab   |

The screenshot rows are never just a re-capture. Every click a lab describes has to be shown, the
pills have to be redrawn and every image has to be looked at again. The hard rules for that live in
[[training-update]], section **Screenshots**: read them before sizing a panel change.

That last row is the dangerous one. The training deliberately seeds failures (a field excluded by
`.forceignore`, a field that cannot be made required, a hardcoded id that trips PMD). A change that
makes one of them stop failing turns a lab into a page describing something that does not happen,
and no test anywhere notices.

## Checking it mechanically

```bash
node scripts/check-training-impact.mjs
node scripts/check-training-impact.mjs --base main
```

It diffs the working tree against the base branch, extracts the command ids, flags, config keys and
documentation slugs the diff touches, and names the labs that depend on them. Run it where the JSON
schema check already runs.

It is a helper, not an oracle: it cannot see that a behavior changed under an unchanged name. The
table above is the part that needs judgement.

## What to output

In the analysis and the design, a **Training impact** section:

```markdown
## Training impact

**Affected labs**: lab-2-3 (Lab 2.3), lab-2-4 (Lab 2.4), in `labs/en/` and `labs/fr/`

`commandsPostDeploy` gains a `retryCount` key. Both labs quote the YAML in their
"Under the hood" block, so both blocks are now incomplete rather than wrong.
No screenshot changes: the editor gains no field.

**Needs a training Pull Request**: yes, small. Load `training-update`.
```

When there is none, say so in one line and name what you checked:

```markdown
## Training impact

None. The change touches `hardis:org:diagnose:unusedlicenses`, which no lab uses.
```

## The labs are not a reliable record of the product

Worth knowing before you conclude a lab is fine. A pass that checked every claim in the course
against the sources found **six of the nine Level 2 labs and all eleven Level 3 labs** carrying at
least one wrong statement, and six of those labs could not be followed at all.

So when you are deciding whether a change affects a lab, do not read the lab and ask "does this
still match". Read what the command or the panel does now, and ask whether the lab was ever right.
The four shapes that keep appearing:

- **The command does more than its name says.** `hardis:work:resetselection` soft-resets every
  commit since the branch point. A lab said in bold that it does not.
- **A promised failure cannot happen.** A merge conflict needs both edits in the same region of a
  file; a permission the lab asks you to grant may already be granted.
- **A panel field does not exist, or not at that scope.** `sfdxHardisConfigHelper.ts` decides what
  the settings panel renders; a branch-scoped key is invisible while the scope reads Global.
- **A setting is taught as active that this project leaves off.**

If a change you are assessing lands anywhere near one of those, the honest answer is that the lab
needs reading against the source, not just patching.

## Process

One Pull Request per repository, cross-linked, exactly like the CLI and extension rule. Order: CLI
first, then the extension, then the training. **A change that invalidates a lab is not finished
until the training Pull Request is open**, and that Pull Request states which labs it re-verified.

Labs are versioned against a pinned sfdx-hardis version, so a breaking change does not break
learners mid-course. The training Pull Request bumps the pin and updates the labs together.

## Related

- [[training-update]] performs the edits once this says there is an impact
- The `vscode-sfdx-hardis` skill, for the extension side of the same change
