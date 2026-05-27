---
title: Salesforce CI/CD with sfdx-hardis
description: Easy handling of Salesforce DX to use CI/CD & DevOps principles on your Salesforce projects
---

<!-- markdownlint-disable MD013 -->

## Salesforce CI/CD with sfdx-hardis

Run a **production-grade Salesforce CI/CD pipeline** on the Git platform, runners, and tools you already use. No vendor lock-in, no extra license, no data leaving your infrastructure.

![DevOps Pipeline](assets/images/sfdx-hardis-pipeline-view.gif)

> Used in production by major companies worldwide. Open-source and free, with optional [Cloudity](https://cloudity.com/) Professional Services for setup, support, and release management.

---

## Why pick sfdx-hardis?

There are many ways to do DevOps with Salesforce. Each has its advantages and limitations.

![DevOps comparison](assets/images/devops-comparison.png){ align=center }

- **Admin-friendly**: every persona (Admin, Developer, Release Manager, Project Lead) is autonomous. Admins build pull requests from clicks in the VS Code extension. No command line needed.
- **Your tools, your infrastructure**: no "sfdx-hardis servers" anywhere. Everything runs in your Git platform, your CI runner, your VS Code. Cloudity has zero access to your data.
- **AI-agent ready**: 130+ commands support an `--agent` flag for non-interactive execution by Claude Code, Copilot, Codex, and others.
- **No license fees**: open-source. Many vendors charge 250+ EUR per contributor per month for the same workflow.
- **Monitoring included**: a [daily metadata backup and observability layer](salesforce-monitoring-home.md) runs in a **separate** monitoring repository (not the CI/CD one) on the same Git platform and CI runner you already use.
- **Documentation included**: generate a [searchable documentation website](salesforce-project-documentation.md) of your whole project (Flows, Objects, Profiles, Apex, Lightning Pages) with AI-written explanations and visual Flow diff history.

---

## Who uses it

![Persona pipeline](assets/images/pipeline-4-persona.png)

| Role                 | How they use sfdx-hardis                                                                                                                            |
|----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|
| **Admins**           | [Build pull requests](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-publish-task/) from the **VS Code extension** with clicks. No command line. |
| **Developers**       | Same as Admins, plus the **Advanced mode** in the UI to see what runs under the hood through the Salesforce CLI.                                    |
| **Release Managers** | Configure pipelines with the **Visual DevOps Pipeline Builder** and track pull requests and deployments through the **DevOps Pipeline View**.       |
| **Project Managers** | Track application lifecycle through native integrations with **Jira** and **Azure Boards**.                                                         |

---

## Plays nicely with your stack

![Technical stack](assets/images/slide-technical-stack.png)

- **Git and CI/CD**: GitHub, GitLab, Bitbucket, Azure DevOps, Gitea, Jenkins
- **Messaging**: Slack, Microsoft Teams, Email
- **Ticketing**: Jira, Azure Boards, or anything else via webhooks
- **AI**: Agentforce, OpenAI, Anthropic, Gemini
- **Observability**: Grafana, Vector.dev (DataDog, Splunk...)

Compliance stays in your hands: it depends on the tools you already operate (Git platform, runner, Jira, AI providers, SSO) and the security policies you apply to them.

---

## What you get

**Smart deployments**

- [Delta deployments](salesforce-ci-cd-config-delta-deployment.md): deploy only what changed.
- [Overwrite management](salesforce-ci-cd-config-overwrite.md): protect metadata that should never be overwritten.
- [Smart Apex test runs](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/#smart-deployments-tests): skip tests that cannot break on sandbox pull requests.
- [Automated source cleaning](salesforce-ci-cd-config-cleaning.md): tidy profiles, flow positions, and more.

**Releases and reporting**

- [DORA Metrics](hardis/doc/salesforce-ci-cd-dora-report.md): Deployment Frequency, Lead Time for Changes, Change Failure Rate, MTTR, scored Elite / High / Medium / Low against industry benchmarks.
- [Release Notes](hardis/doc/salesforce-ci-cd-release-notes.md): generated from git history, tickets, metadata changes, and deployment actions. Outputs Markdown, PDF, XLSX with optional AI-powered summary.
- [Backpromote (Beta)](hardis/work/backpromote.md): push changes from a parent branch back to a developer's sandbox with org conflict detection and diff reports.

**Integrations**

- [Slack, Teams, and email notifications](salesforce-ci-cd-setup-integrations-home.md) with detailed deployment results.
- [Jira](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-jira/), [Azure Boards](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-azure-boards/), or [any other ticketing tool](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-generic-ticketing/).
- [Deployment Agent](salesforce-deployment-agent-home.md): resolves deployment issues with core rules plus AI (Agentforce or direct calls to OpenAI, Anthropic, Gemini).

> Read the [full smart deployment workflow](salesforce-ci-cd-smart-deployment.md) to see how it all fits together.

---

## AI-agent ready

Every command that involves prompts supports an `--agent` flag that switches to fully non-interactive execution:

- **No tokens wasted on menus**: agents skip multi-choice prompts entirely.
- **Predictable execution**: required values pass as CLI flags. The command fails fast with a clear error if something is missing.
- **Safe defaults**: sensible defaults apply when prompts are skipped. Destructive operations still need an explicit flag.

With 130+ commands supporting `--agent`, your coding agent can drive the whole Salesforce DevOps lifecycle: create user stories, deploy metadata, run diagnostics, purge obsolete data, manage packages.

See [Using AI Coding Agents](salesforce-ci-cd-agent-skills.md) for the full picture.

---

## Ready-to-use pipeline templates

Deployment simulation results are posted as comments on every pull request.

| Platform       | CI/CD template                                                                                                                                                                                                                                                                                           |
|----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| GitLab         | [GitLab CI configuration](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/ci/.gitlab-ci.yml)                                                                                                                                                                                            |
| Azure DevOps   | [Azure Pipelines checks](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/ci/azure-pipelines-checks.yml), [Azure Pipelines deployment](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/ci/azure-pipelines-deployment.yml)                                               |
| GitHub & Gitea | [GitHub Actions / Gitea workflow checks](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/ci/.github/workflows/check-deploy.yml), [GitHub Actions / Gitea workflow deployment](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/ci/.github/workflows/process-deploy.yml) |
| Bitbucket      | [Bitbucket Pipelines](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/ci/bitbucket-pipelines.yml)                                                                                                                                                                                       |
| Jenkins        | [Jenkinsfile](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/ci/Jenkinsfile)                                                                                                                                                                                                           |

Pipelines adapt to other platforms like [TeamCity](https://www.jetbrains.com/teamcity/).

_An advanced branch and org model you can build with sfdx-hardis. Simpler RUN-only models also work:_

![CI/CD branch and org schema](assets/images/ci-cd-schema-main.jpg){ align=center }

For deeper Q&A, see this article:

[![Questions/Answers](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-questions-answers.jpg)](https://nicolas.vuillamy.fr/what-devops-experts-want-to-know-about-salesforce-ci-cd-with-sfdx-hardis-q-a-1f412db34476)

---

## Monitoring on the same Git platform

CI/CD is only half the story. Once your changes hit production, you still need to **know what is happening in your orgs**. sfdx-hardis ships with a built-in [Monitoring layer](salesforce-monitoring-home.md) that lives in its own **separate repository** (not the CI/CD one), on the same Git platform and CI runner you already use. No extra license, no extra platform.

![Monitoring configuration preview](assets/images/monitoring-config-2026.gif)

What you get out of the box:

- **Daily metadata backup** with exact git diff between yesterday and today (who changed what, before / after).
- **Suspect setup actions** detected from the Salesforce Audit Trail, so production changes never go unnoticed.
- **Apex tests, code quality (MegaLinter), org limits, deprecated API calls, release updates, unsecured Connected Apps, unused licenses, missing access...** all scheduled and reported automatically.
- **Per-channel notifications** routed independently to [Slack / Microsoft Teams](salesforce-ci-cd-setup-integration-slack.md), [email](salesforce-ci-cd-setup-integration-email.md), and [API / Grafana / Prometheus](salesforce-ci-cd-setup-integration-api.md), with a per-notification-type severity threshold (stream everything to Grafana, keep Slack for warnings and errors only).
- **Ready-to-use Grafana dashboards** to visualize org health, backups, tests, security, and license usage over time.
- **Fully configurable** from the [VS Code SFDX Hardis extension](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis) or directly in `.sfdx-hardis.yml` (frequency, thresholds, channels, custom commands).

> Pick CI/CD with sfdx-hardis and you also get a production-grade monitoring stack in the same move. See the [Monitoring documentation](salesforce-monitoring-home.md) for the full picture.

---

## Open-source, no license fees

Everything is **open-source**. There are **no license costs**.

> In comparison, many Salesforce DevOps vendors charge more than 250 EUR per contributor per month.

Run it yourself, or ask [**Cloudity**](https://cloudity.com/) Professional Services for support.

---

## Used in production worldwide

![sfdx-hardis usage](assets/images/sfdx-hardis-usage.png)

Featured in conferences, blogs, and webinars.

_Interview on SalesforceBen with a live demo:_

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/vtWx_IWoL9k" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

> The Dreamforce presentation and slides below were recorded before sfdx-hardis got its current **LWC-based UI**. The concepts still apply, but the on-screen experience is now built around proper Lightning Web Component screens instead of CLI menus.

_Dreamforce presentation:_

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/o0Mm9F07UFs" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

_Slides from the [Dreamforce '23 session](https://reg.salesforce.com/flow/plus/df23/sessioncatalog/page/catalog/session/1684196389783001OqEl){target=\_blank}:_

<iframe src="https://www.slideshare.net/slideshow/embed_code/key/qroQjoKmRUUjqx?hostedIn=slideshare&page=upload" width="714" height="600" frameborder="0" marginwidth="0" marginheight="0" scrolling="no"></iframe>

_Detailed article on SalesforceDevOps.net (also published before the LWC-based UI - concepts still apply, the on-screen experience has moved on from CLI menus to proper Lightning Web Component screens):_

[![SalesforceDevOps.net article](assets/images/article-cicd-salesforcedevopsnet.jpg)](https://salesforcedevops.net/index.php/2023/03/01/sfdx-hardis-open-source-salesforce-release-management/){target=\_blank}

---

## Get started

### Set it up yourself

Open-source and free. The [**Setup Guide**](salesforce-ci-cd-setup-home.md) walks you through initializing a Salesforce CI/CD project from scratch.

### Get help from Cloudity

sfdx-hardis works perfectly well on its own. It works even better with the people who built it on your side: a sharper branch model, a cleaner pipeline, edge cases anticipated upfront. [**Cloudity**](https://cloudity.com/), the company behind sfdx-hardis, offers four service tiers to match every team's needs and budget.

---

#### Assisted Setup - _for experienced teams_

> **Best for:** Teams with solid Git and Salesforce CLI skills who want expert guidance without handing over the wheel.

Your team drives the setup. A Cloudity expert rides along: reviewing your branch model, validating your pipeline configuration, unblocking tricky situations, and making sure you follow best practices from the start.

**What's included:**

- Branch and org model review and recommendations
- Guided pipeline configuration (CI checks, deployments, notifications)
- Code review of your sfdx-hardis configuration files
- Q&A sessions with a Cloudity expert at key milestones
- Guidance and material to train your team on sfdx-hardis best practices

The most cost-effective way to get professional assurance without a full engagement.

---

#### Full Setup Service - _end-to-end, done for you_

> **Best for:** Teams that want a production-ready CI/CD pipeline without investing internal time in setup and configuration.

Cloudity takes full ownership. You receive a battle-tested, fully configured CI/CD pipeline tailored to your org structure, team size, and release process. Ready to go live.

**What's included:**

- Analysis of your existing Salesforce org and release process
- Full pipeline setup on your Git platform (GitHub, GitLab, Azure DevOps, Bitbucket, Jenkins...)
- Branch model and deployment strategy definition
- Training sessions for contributors, release managers, and project leads
- Change management support to accelerate adoption across your organization
- Handover documentation and knowledge transfer

---

#### Option: Support Subscription - _peace of mind, ongoing_

> **Best for:** Any team that wants guaranteed access to sfdx-hardis expertise after go-live, and wants to stay ahead of Salesforce releases.

A Cloudity expert is available whenever you need them: to answer questions, resolve blockers, and review changes. You also directly fund the sustainability of sfdx-hardis as an open-source project.

**What's included:**

- A skilled Cloudity experts pool, reachable by your team
- Priority response for incidents and deployment issues
- Proactive alerts on Salesforce API changes and sfdx-hardis updates that may affect your pipelines
- Access to new sfdx-hardis features and security patches as they ship
- Direct influence on the sfdx-hardis roadmap through feedback and feature requests

---

#### Option: Release Manager as a Service - _your release process, covered_

> **Best for:** Teams without a dedicated release manager, or who need cover during holidays, parental leave, or peak release periods.

A Cloudity release manager takes the wheel, permanently or on demand. Your team keeps shipping, your release cadence stays on track, no matter what.

**What's included:**

- Day-to-day management of pull requests, deployments, and release branches
- Coordination between development, QA, and business teams
- Incident response and rollback management
- Available as a permanent service or as a temporary cover arrangement

---

<div style="text-align:center; margin:2rem 0;">
  <a href="https://cloudity.com/contact-us/" target="_blank" rel="noopener noreferrer">
    <img src="../assets/images/cloudity-banner.png" alt="Cloudity" style="max-width:100%;" />
  </a>
  <br/>
  <a href="https://cloudity.com/contact-us/" target="_blank" rel="noopener noreferrer" role="button" aria-label="Cloudity Professional Services"
     style="display:inline-block; padding:0.75rem 1.25rem; background:#0070d2; color:#ffffff; text-decoration:none; border-radius:0.25rem; font-weight:600; margin-top:1rem;">
    Talk to a Cloudity expert
  </a>
</div>

---

## Next steps

- [**Setup guide**](salesforce-ci-cd-setup-home.md): initialize a Salesforce CI/CD project from scratch.
- [**Contributor guide**](salesforce-ci-cd-use-home.md): work on CI/CD projects as a Business Analyst, Admin, or Developer.
- [**Release Manager guide**](salesforce-ci-cd-release-home.md): drive releases on a CI/CD project.
- [**Pair it with Monitoring**](salesforce-monitoring-home.md): a separate repository (not the CI/CD one) on the same Git platform.
