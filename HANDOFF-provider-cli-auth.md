# Handoff: provider connection check and gh / glab / az tokens

Branch `feat/provider-cli-auth`, draft Pull Request. Delete this file before the merge.

## What the user asked

1. When the token of a git provider is missing from the environment or `.env`, or refused, get it from `gh`, `glab` or `az`. Tokens must never appear in logs.
2. Check whether a provider (git, ticketing) is connected: `true` / `false`, plus instructions when `false`.

Decisions taken with the user:

- Only for agents: with `--agent`, or `SFDX_HARDIS_PROVIDER_CLI_AUTH=true` (`false` turns it off even with `--agent`). Never in CI.
- Order: variable of the environment, then `.env` (a real variable always wins over `.env`), then the CLI.
- An environment token is checked with one call (read the current repository). `SFDX_HARDIS_PROVIDER_TOKEN_CHECK=false` skips that call.
- The CLI token goes in the first token variable of the provider, for this process only, registered with `registerSecretValue` first. Nothing is written to `.env`.
- Azure: `az account get-access-token --resource 499b84ac-...` (Entra token, Bearer), used for Azure DevOps and Azure Boards.
- glab: `glab auth status --hostname <host> --show-token`, the `Token found:` line is parsed in memory (glab has no "print token" command).
- New command `hardis:project:connection:check`, exit code 0, the answer is in `connected`.
- VS Code extension impact: none (the extension needs the token value itself).
- Training impact: none (no lab mentions these).

## Deviation from the design

The design said "off when launched by VS Code (`WebSocketClient.isAlive()`)". That cannot work: in agent mode the CLI never opens its WebSocket (`src/hooks/init/start-ws-client.ts:64`). The VS Code row was dropped: the `--agent` commands the extension launches also get the fallback. The extension can pass `SFDX_HARDIS_PROVIDER_CLI_AUTH=false` if that is ever unwanted.

## Where things are

| What | Where |
|------|-------|
| Enable rules, CLI runner, token source and failure records, `ProviderConnectionStatus` | `src/common/utils/providerCliAuthUtils.ts` |
| Silent spawn (no output, timeout, `.cmd` through cmd.exe with checked args), shared with git credential | `src/common/utils/silentCommandUtils.ts`, `gitCredentialUtils.ts` |
| `which` without the current folder | `src/common/utils/whichUtils.ts` (`skipCurrentDirectory`) |
| Hooks: `providerLabel`, `tokenVariableNames`, `getCliTokenSource`, `readCliToken`, `checkConnection` | `src/common/gitProvider/gitProviderRoot.ts` and the 4 providers |
| Fallback flow, `checkConnection` | `src/common/gitProvider/index.ts` (`applyCliTokenFallback`, `applyCliTokenFallbackFor`, `resolveToken`...) |
| Ticketing check, `getConnectionHelp` on each connector, Azure Boards az token | `src/common/ticketProvider/index.ts` (`checkConnections`), each provider |
| Command | `src/commands/hardis/project/connection/check.ts`, `src/common/utils/connectionCheckUtils.ts` |
| Debug env dump masks secret variables | `src/hooks/init/log.ts` (`maskSecretEnvVars`) |
| Azure PAT prompt now `sensitive: true` | `azureDevops.ts` `handleLocalIdentification` |
| Tests | `test/common/utils/providerCliAuth.test.ts`, `test/common/gitProvider/gitProviderCliFallback.test.ts`, `whichUtils.test.ts` |
| Docs | `docs/all-env-variables.md`, `salesforce-devops-setup-integration-{github,gitlab,azure,azure-boards}.md`, `salesforce-agentic-automation.md`, `defaults/templates/monitoring/AGENTS.md`, CHANGELOG |
| Screenshot spec (replay) | `scripts/command-screenshots/specs/project/connection/check.yml`, `transcripts/hardis_project_connection_check.json` |

## Done

- `tsc --noEmit` clean, the new tests and the related ones pass (54 passing), `monitoringAgentsMd` tests pass.
- i18n: 17 keys in the 9 locales.

## Left to do

1. `yarn build` and `yarn test:only` in full (only the related test files were run).
2. `yarn build:doc --commands hardis:project:connection:check` (the doc page `docs/hardis/project/connection/check.md` the docs link to is not generated yet), then `yarn screenshots:commands hardis:project:connection:check`.
3. Real runs (`./bin/dev.js hardis:project:connection:check --agent --json`):
   - GitHub repo with `gh` logged in and no token variable: expect `tokenSource: "gh"`, `connected: true`.
   - Same with a wrong `GITHUB_TOKEN` in `.env`: expect the "refused ... using the token of gh" log line.
   - Self-managed GitLab with `glab`.
   - Azure DevOps: `az` 2.93 is installed on the first machine, needs `az login` on an account with an Azure DevOps organization.
   - No CLI on PATH: the detail must give the install URL.
   - After each run, check that no token value appears in `hardis-report/commands/*.log` (read the token into a variable and grep for it, never print it).
4. Remove this file, mark the Pull Request ready.
