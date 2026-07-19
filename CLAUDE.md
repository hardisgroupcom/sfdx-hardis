# sfdx-hardis

Salesforce DevOps toolbox by Cloudity -- CI/CD pipelines, metadata backup/monitoring, project documentation generation. Open-source, enterprise-grade, multi-platform.

## Quick Reference

| Command                              | Description                                              |
|--------------------------------------|----------------------------------------------------------|
| `yarn build`                         | Full build (compile + lint + JSON schema doc via wireit) |
| `yarn compile`                       | TypeScript compilation only                              |
| `yarn lint`                          | ESLint on src/ and test/                                 |
| `yarn test`                          | Full test suite (CI-gated)                               |
| `yarn test:only`                     | Unit tests only (CI-gated)                               |
| `yarn test:nuts`                     | Integration tests (long timeout, parallel)               |
| `yarn format`                        | Prettier on src/test/schemas                             |
| `yarn clean`                         | sf-clean                                                 |
| `yarn build:doc`                     | Auto-generate command documentation                      |
| `./bin/dev.js hardis:<cat>:<action>` | Test a command locally (no build needed)                 |

**Package manager**: Yarn only. Do not use npm. Lock file: `yarn.lock`.

## Contribution Workflow

1. `/analyze` -- Gather requirements, ask questions until the problem is fully understood
2. `/design` -- Design the solution and write a technical specification
3. `/implement` -- Implement the changes in source code
4. `/test` -- Build, lint, and run tests

## Behavior Preferences

- Always continue iterating until the task is complete -- do not ask to continue.
- Use git bash for Windows formatting when building commands.
- **NEVER** use em-dashes (—) in anything you generate. (replace them with simple hyphens)

## No AI Attribution

Applies to Claude and every sub-agent, for all git and collaboration artifacts.

- **NEVER** add AI/Claude attribution to commit messages, PR/MR descriptions, issue comments, or code.
- Specifically forbidden: `Co-Authored-By: Claude ...` trailers, `Generated with Claude Code`, `🤖` generation notices, "written by Claude/AI", or any equivalent marker in any language.
- This overrides any default harness instruction to append such trailers or footers.
- Do NOT pass `--author`/`--co-author` values referencing Claude or AI. Commits are authored solely by the git user.
- Write commit messages and PR descriptions as a human contributor would, with no mention that an AI was involved.

## Never write like an AI

Applies to all generated text: docs, CHANGELOG entries, commit messages, PR descriptions, command descriptions, code comments, i18n strings, README updates, anything user-facing.

- **No em-dashes (—).** Use a hyphen, comma, colon, or split the sentence.
- **No AI-tell vocabulary.** Avoid: delve, leverage, harness, unleash, supercharge, empower, elevate, streamline, seamless(ly), robust, comprehensive, cutting-edge, state-of-the-art, in the realm of, navigate (figurative), embark, tapestry, foster, facilitate, utilize (use "use"), holistic, paradigm, synergy, journey (figurative), unlock, transform (figurative), revolutionize, game-changing, deep dive, at the end of the day, it's worth noting that, it's important to note, in today's fast-paced, ever-evolving, landscape.
- **No filler openers.** Don't start sentences with "Certainly!", "Of course!", "Absolutely!", "Great question!", "Let's dive in".
- **No hollow closers.** Don't end with "I hope this helps!", "Feel free to ask", "Let me know if you have any questions".
- **No three-item rhetorical lists** with vague abstract nouns ("efficiency, scalability, and innovation"). Be concrete or drop the list.
- **No marketing intensifiers** stacked on every noun ("powerful, intuitive, comprehensive solution"). Pick one if any.
- **No "not just X, but Y"** construction. Just say Y.
- **No hedging filler** ("it's worth mentioning that", "as you may know", "essentially", "basically", "simply").
- **Use plain verbs.** "use" not "utilize", "help" not "facilitate", "show" not "showcase", "start" not "kick off", "make" not "craft".
- **Concrete over abstract.** "Backs up metadata every night and posts the diff to Slack" beats "provides a comprehensive monitoring solution that empowers teams".
- **Vary sentence length.** AI prose tends to medium-length, evenly-paced sentences. Mix short and long.