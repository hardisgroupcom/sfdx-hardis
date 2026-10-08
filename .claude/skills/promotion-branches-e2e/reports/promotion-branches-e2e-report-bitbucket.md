# Promotion branches, deployment actions and backpromote: end to end test on Bitbucket Cloud

**Date:** 2026-10-08
**Result: not run.** No section ran on Bitbucket Cloud that day. The last live run on Bitbucket
remains the one of 2026-09-08, on another workspace and before the scripted sections existed.

___

## What stopped it

The workspace of `.env` (`BB_WORKSPACE`, project key `TES`) refuses every `git push` with HTTP 402:

```text
remote: [ALERT] Your push failed because the account '<workspace>' has exceeded its
remote: [ALERT] user limit and this repository is restricted to read-only access.
remote: [ALERT] Change your plan to restore write access
```

What was checked before giving up:

| Check                                                              | Result                                    |
|--------------------------------------------------------------------|-------------------------------------------|
| `preflight.sh`: token, workspace, project, repository listing      | OK, nothing announces the read-only state |
| Creating a private repository through the API (two of them)        | HTTP 200                                  |
| `git push` of `main` to each, as `x-bitbucket-api-token-auth`      | HTTP 402, both                            |
| `GET /workspaces/<workspace>/members` and `/permissions`           | one member, the owner                     |

The API lists a single member, so the limit is a setting of the plan that only the owner sees
(Workspace settings > Plan details). It is not a token scope: the same token creates repositories.
This is a setting of the account, not something a script should work around.

## What it means for the product

Nothing new is known about Bitbucket Cloud from this run. Still unproven there:

- the scripted sections 4, 4bis, 4ter, 6, 6bis, 6quater and 6sexies (`promotion-provider.sh` maps
  them since 2026-10-08, none has run);
- the real CI section 6quinquies on Bitbucket Pipelines and its fallback to the job simulator once
  the build minutes are used up;
- repository creation and push with the Atlassian API token of `.env` (creation: proven today;
  push: refused for the plan, so the git user name `x-bitbucket-api-token-auth` is only proven by
  the `git ls-remote` of 2026-10-08);
- backpromote on Bitbucket, whose hooks exist in the library and have never run.

The Azure DevOps run of the same day found a provider defect of the kind section 4ter exists for
(the Pull Request window was empty outside a pipeline). `bitbucket.ts` was not exercised the same
way: treat its Pull Request window as unverified.

## To run it

1. In Workspace settings > Plan details, bring the workspace back under its user limit (or change
   the plan) until a push is accepted.
2. Check with one push to a scratch branch of an existing repository of the workspace: it is the
   only check that sees the read-only state.
3. Run the sections as `SKILL.md` says, with `PROVIDER=bitbucket`.

The runbook holds this under section 8ter.

## Left behind

Two empty private repositories in the workspace: `sfdx-hardis-promo-e2e-bb-1` and
`sfdx-hardis-promo-e2e-bb-2`. They can be reused for the next attempt (nothing was pushed) or
deleted with `bb_api DELETE`.
