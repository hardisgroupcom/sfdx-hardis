---
name: training-publish
description: Publish and maintain the three Trailhead Trailmixes and the Cloudity badges of the sfdx-hardis training course. Load it when creating, renaming or reordering a Trailmix, when writing the copy shown on Trailhead, when a lab URL changes and the Trailmix steps must follow, or when touching the badge names, badge pages or the claim instructions. Also use it when the user says "Trailmix", "Trailhead", "badge", "claim" or "how do people enroll".
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

# Publishing the training on Trailhead

The course itself lives in `../sfdx-hardis-training` and is edited with [[training-update]].
This skill covers only the two surfaces outside that repository: the **Trailmixes** on
trailhead.salesforce.com, and the **badge** the course awards.

## What a Trailmix can and cannot do

Re-check these once before any publishing session: the Trailhead UI changes.

| Capability                                                   | Available        | Consequence                                                                |
|--------------------------------------------------------------|------------------|----------------------------------------------------------------------------|
| Add existing trails, modules, projects, superbadges as steps | Yes              | Used for the conceptual warm-up steps                                      |
| Add a **Link** step (any external URL)                       | Yes              | The main mechanism: one per lab page and per reference doc page            |
| Add a **Task** step (free text, no URL)                      | Yes              | Used for "create your orgs" and "claim your badge"                         |
| Mark a Link or Task required for completion                  | Yes              | On for every lab, off for optional reading                                 |
| Reorder steps                                                | Yes              | The order in the Trailmix is the authoritative reading order               |
| Public shareable URL                                         | Yes              | `https://trailhead.salesforce.com/users/<handle>/trailmixes/<slug>`        |
| Custom description and cover                                 | Yes              | Copy below                                                                 |
| Quizzes or hands-on challenges                               | **No**           | Verification is the local check plus the claim issue audit                 |
| Award a Trailhead badge                                      | **No**           | Cloudity issues its own                                                    |
| Gate a step behind another                                   | **No**           | Order is a suggestion, so every lab states its own preconditions and reset |
| Nest a Trailmix inside a Trailmix                            | **No (assumed)** | Each level links the next with a plain Link step                           |
| Author-side reporting on who completed what                  | **No**           | Completion data comes from the closed claim issues and `badges/`           |
| Localize one Trailmix                                        | **No**           | A translated course is a new Trailmix per language                         |

Authoring a real Trailhead badge is not an option: there is no self-serve program, and
myTrailhead / Enablement Sites (Trailmaker Content) is retiring. A Trailmix is the only
Trailhead-native surface open to us.

## Account, titles and URLs

| Item                     | Value                                                                                                               |
|--------------------------|---------------------------------------------------------------------------------------------------------------------|
| Owning Trailhead account | `nvuillamy` (profile `https://www.salesforce.com/trailblazer/nvuillamy`)                                            |
| Level 1 Trailmix         | `Salesforce DevOps with sfdx-hardis - Contributor Basics`                                                           |
| Level 2 Trailmix         | `Salesforce DevOps with sfdx-hardis - Contributor Advanced`                                                         |
| Level 3 Trailmix         | `Salesforce DevOps with sfdx-hardis - Release Manager`                                                              |
| Expected URL shape       | `https://trailhead.salesforce.com/users/nvuillamy/trailmixes/salesforce-devops-with-sfdx-hardis-contributor-basics` |
| Training site            | `https://hardisgroupcom.github.io/sfdx-hardis-training/`                                                            |
| Lab URL shape            | `<site>/en/level-2-contributor-advanced/2-7-resolve-a-git-merge-conflict/`                                          |
| Badge URL shape          | `<site>/badges/<github-handle>/`                                                                                    |

Two cautions, both permanent:

- **The URL embeds the account handle and the slug, and neither can be changed later**
  without breaking every link already shared. Trailhead derives the slug from the title:
  do not assume the transformation, read the slug it actually generated and record it in
  `labs/link-map.en.md` of the training repository.
- **These Trailmixes are personally owned.** If they should outlive one person, create them
  from an account whose credentials the team holds, or accept the risk explicitly.

## The copy

One-line descriptions, what Trailhead shows in a card. Ready to paste:

- **Contributor Basics**: Deliver your first Salesforce change the way a real team does: a
  User Story on its own branch, an org to build in, and a Pull Request that checks your work
  before anyone reviews it.
- **Contributor Advanced**: The stories that do not go through first time: deployment errors,
  deployment actions, overwrite protection, Apex test coverage, and a teammate who edited the
  same Flow as you.
- **Release Manager**: Own the pipeline: finish it up to production, review and merge what
  contributors send you, release to UAT and production, ship a hotfix, retrofit it, and
  monitor production.

If a single Trailmix is ever published instead of three, the title is
`Salesforce DevOps with sfdx-hardis` and the line is: A free hands-on course that builds a
complete Salesforce CI/CD pipeline on free orgs, one click at a time, from your first User
Story to a monitored production release.

Longer versions of the same three, for the description field when it accepts a paragraph, are
in the course `README.md` and the level index pages of the site. Keep them in step: the level
index page is what a learner reads right after the Trailmix card.

**Every description ends with the same sentence**: *This course awards a Cloudity badge. It is
not a certification.*

Level 2 is **recommended** to contribute and **required** to start Level 3. Say both, in that
order, wherever the prerequisites are listed: a learner may stop after Level 1 and deliver, and
a release manager cannot review a deployment error they have never solved.

## Building the step list of a Trailmix

The steps are not a copy of the lab list. The shape, in order:

1. A Link to the level index page of the site, not required, titled so it reads as "why this
   path exists" or "what changes at this level, and how to reset if you are joining here".
2. The Trailhead warm-up modules for the level, required only where the knowledge is genuinely
   assumed (Git basics for Level 1, nothing for Level 2).
3. A Link to the matching sfdx-hardis guide home on `sfdx-hardis.cloudity.com`.
4. A Task step for anything done outside both sites: creating the Developer Edition orgs and
   connecting them in Orgs Manager.
5. Then, per lab and in lab order: **one required Link to the lab page**, followed by the
   optional Links to the product doc pages that lab maps to. Every lab maps to a real
   sfdx-hardis command and a real doc page, so there is always at least one.
6. A required Task step carrying the claim instructions.
7. A final, not required, Link to the next level's Trailmix.

Lab titles and URLs come from `training-manifest.json` and `labs/link-map.en.md` in the
training repository, both generated by `scripts/build/universe.mjs`. Read them; never retype a
lab URL by hand, and re-check the whole step list whenever a lab is renamed, renumbered or
inserted, because the site URL is the file name.

Trailhead steps verified by hand and safe to link:

| Title                                                                    | URL under `trailhead.salesforce.com/`                                                   |
|--------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| Git and GitHub Basics for Effective Collaboration                        | `content/learn/modules/git-and-git-hub-basics`                                          |
| Org Development Model                                                    | `content/learn/modules/org-development-model`                                           |
| Package Development Model                                                | `content/learn/modules/sfdx_dev_model`                                                  |
| App Development with Salesforce DX                                       | `content/learn/modules/sfdx_app_dev`                                                    |
| DevOps Center: Quick Look                                                | `content/learn/modules/devops-center-quick-look`                                        |
| Explore the Software Development Lifecycle for Salesforce Admins (trail) | `content/learn/trails/explore-the-software-development-lifecycle-for-salesforce-admins` |

**Do not add a step whose URL has not been opened by hand**, and **never link a Trailhead
module published by a competing DevOps vendor**, even when it is the closest match on the topic.

## The badges

| Badge   | Awarded when                      | Name                                 |
|---------|-----------------------------------|--------------------------------------|
| Level 1 | the Level 1 audit passes          | **sfdx-hardis Contributor Basics**   |
| Level 2 | the Levels 1 and 2 audits pass    | **sfdx-hardis Contributor Advanced** |
| Level 3 | the Levels 1, 2 and 3 audits pass | **sfdx-hardis Release Manager**      |

Three separate badges, each shown on the learner's page with its date. Each name says what the
holder can do, which is what makes it worth putting on a profile.

Everything is free and GitHub-native, in `hardisgroupcom/sfdx-hardis-training`:

- **The image**: an SVG rendered from `badges/_template.svg`, Cloudity colors, badge name,
  handle, date. Committed, no image service.
- **The page**: built by `scripts/build/site.mjs` from the record, once per language, and
  published at `<site>/badges/<trailblazer>/` and `<site>/<locale>/badges/<trailblazer>/`. It shows
  the badges earned with their dates, the Trailblazer profile the learner declared and the audit
  result. Nothing is committed for it: a claim writes the record and the image, and a badge earned
  before a language existed gains its page in it on the next build. One page per learner, so the
  URL they share stays the same as they progress. This is the URL the learner shares.
- **The machine-readable record**: `badges/<handle>.json`, Open Badges shaped (issuer,
  recipient, achievement, issuedOn, evidence), unsigned. Real certifications for clients and
  partners, if they ever come, are a different scheme; this shape does not block it and these
  URLs do not have to move.
- **Revocation** is a commit.

Two consequences to state in the claim instructions and accept up front: `badges/` grows in the
repository forever, and learner GitHub handles become public in it.

### Wording rules, not preferences

- **Badge, never certification.** No copy anywhere may imply an exam or an accreditation.
- Tell learners to put the badge page on LinkedIn under **Featured**, or as a course, **not**
  under *Licenses & certifications*. Say it on the badge page itself.
- The badge page is keyed by **GitHub handle**, which is what the audit can prove. The
  Trailblazer username is shown as declared and is never a gate: a Trailmix awards nothing
  queryable and the only profile endpoint is unofficial.

## Claiming, and who reviews it

A learner opens a GitHub issue from a form carrying the level, their Trailblazer username and
their public repository URL. `claim.yml` clones the repository, runs the audit, comments and
closes. **Nobody reviews claims.** The residual human duty is reading `needs-work` issues:
those are course bug reports.

The audit asserts outcomes, never procedures, never verifies org state, and never asks for
credentials. Its failure messages are the only support channel a learner has, so each one names
the lab, what was looked for and where. The rules live in `scripts/verify/rules.mjs`; editing
them is [[training-update]]'s job.

## Translation

The course ships in **English and French**, `labs/en/` and `labs/fr/`, mirrored file for file, with
English as the reference. Every translated page carries a `source_rev` front matter key naming the
English commit it was made from, so staleness is detectable.

**A Trailmix cannot be localized, so each language is its own Trailmix per level**: six today, three
English and three French. They are built from the same step list with `/fr/` in place of `/en/` in
every target, and `labs/link-map.fr.md` is generated by `scripts/build/universe.mjs` to hold exactly
those URLs, next to the English one. Read the link map rather than transcribing URLs: that file is
what `link-check.yml` proves resolves.

Two things the French Trailmix keeps in English:

- **The badge names.** `sfdx-hardis Contributor Basics`, `Contributor Advanced` and
  `Release Manager` are one badge each, whatever language the learner took the course in, and the
  badge pages are locale independent
- **Anything the learner clicks in the product.** The course assumes sfdx-hardis, the extension and
  the orgs are in English, because the screenshots are, and a Trailmix description that promises
  otherwise sets the wrong expectation before the first lab

Never translated: command names, flags, config keys, branch names, org aliases, file paths, the
cast names, and the badge names.

## Still open

Small, and each can be settled when the phase that needs it arrives:

1. **A learner who deletes or makes their repository private keeps the badge?** The badge page
   is committed and survives, but its evidence link would 404. Recommendation: keep the badge,
   and have `sync-check.yml` mark the evidence link unreachable rather than revoke anything.
2. **Which handle wins when a learner's GitHub handle and Trailblazer username differ?** The
   page is keyed by GitHub handle and shows the Trailblazer username as declared. Confirm that
   is the right way round before the issue form is finalized.

## Related

- [[training-update]] edits the labs, the universe, the rules and the screenshots.
- [[training-impact]] decides whether a change here or in the extension breaks a lab.
- [[vscode-sfdx-hardis]] for the panels the labs click through.
- [[training-e2e]] walks the labs for real, including the claim and the badge audit.
