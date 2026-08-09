# Dependency reduction plan

Goal: decrease the number of npm dependencies of sfdx-hardis to reduce the supply-chain attack surface.

Baseline (2026-08-09, v7.23.0):

- 66 runtime dependencies in `package.json`
- ~1782 locked entries in `yarn.lock`

General rules for every step:

- Before removing a package, run `yarn why <pkg>` to confirm nothing else depends on it.
- After each removal: `yarn install`, `yarn build`, `yarn test`, and a smoke test of the impacted command via `./bin/dev.js hardis:<cat>:<action>`.
- Package manager is Yarn only.
- When a tree shrinks, check whether related entries in the `resolutions` block of `package.json` are still needed and prune them.

## Phase 1 - Quick wins (low risk, ~1 afternoon)

- [x] **Remove `@langchain/community`**: zero imports found in `src/`. With langchain v1 it is an optional peer, not a hard requirement. Verify with `yarn why @langchain/community`, remove, rebuild, and smoke test one AI command (e.g. doc generation with an AI provider configured). It drags one of the largest transitive trees in the lockfile.
- [x] **Remove `fast-xml-builder`**: used only in `src/common/metadata-utils/crudMetadataApi.ts`. Replace with the `XMLBuilder` class exported by `fast-xml-parser` (already used in the same file).
- [x] **Remove `csv-stringify`**: used only in `src/common/utils/index.ts`. Replace with `Papa.unparse()` from `papaparse` (already used in 7 files).
- [x] **Remove `make-fetch-happen`** (+ `@types/make-fetch-happen`): used only in `src/common/utils/fileDownloader.ts`. Replace with native `fetch` (Node >= 20) streaming to a file, or with `axios` which is already a dependency.
- [x] **Remove `mega-linter-runner`**: used only in `src/commands/hardis/project/lint.ts`. Spawn `npx mega-linter-runner` with `cross-spawn` instead of importing the library, so its tree is only fetched by users who actually lint.

## Phase 2 - High security value replacements

- [x] ~~Replace `farmhash`~~ **KEPT (decision 2026-08-09)**: fingerprints are persisted (AI cache keys, flow-doc diff tooltips), changing the algorithm would invalidate them. Original text: **Replace `farmhash` with `node:crypto`**: native addon with prebuilt binaries, used only to hash strings in `src/common/aiProvider/utils.ts` and `src/common/utils/flowVisualiser/flowParser.ts`. Native modules are the worst supply-chain surface in the tree. Caution: if the hashes are persisted anywhere (cache keys, generated doc anchors), changing the algorithm invalidates them; check call sites first.
- [x] **Replace `isomorphic-dompurify`** (done with `sanitize-html`): used only in `src/common/notifProvider/markdownToHtml.ts` to sanitize notification HTML, but it bundles jsdom (huge tree). Replace with `sanitize-html` or a small allowlist sanitizer. Note the `dompurify` entry in `resolutions` can then be removed.
- [x] **Replace `update-notifier` and `read-package-up`**: used only in `src/hooks/init/check-upgrade.ts`. Replace with one `fetch` to `https://registry.npmjs.org/sfdx-hardis/latest` plus `semver.gt()` (`semver` stays, it is used elsewhere). Keep the same throttling behavior (do not check on every run).
- [x] **Replace `md-to-pdf`**: it depends on full `puppeteer` while the project already ships `puppeteer-core` + `chrome-launcher`, and `src/common/utils/markdownUtils.ts` already reaches into its internals (`md-to-pdf/dist/lib/...`). Reimplement as: markdown to HTML with `marked` (already a dependency), then print to PDF with the existing `puppeteer-core` setup.
- [x] **Replace the `cloudflare` SDK**: full SDK used for one command, `src/commands/hardis/doc/mkdocs-to-cf.ts`. Replace the few API calls with plain `fetch` calls to the Cloudflare REST API.

## Phase 3 - XML consolidation (moderate refactor)

Five XML libraries are currently shipped: `xml2js`, `fast-xml-parser`, `fast-xml-builder` (removed in Phase 1), `@xmldom/xmldom`, `xpath`. Target: `fast-xml-parser` only.

- [x] **Migrate `xml2js` usages to `fast-xml-parser`** (8 files): `src/common/utils/xmlUtils.ts`, `src/common/utils/index.ts`, `src/commands/hardis/lint/unusedmetadatas.ts`, `src/commands/hardis/lint/missingattributes.ts`, `src/commands/hardis/lint/access.ts`, `src/commands/hardis/misc/custom-label-translations.ts`, `src/commands/hardis/project/clean/filter-xml-content.ts`, plus any indirect helpers. `xml2js` is barely maintained and pulls `sax`. Attention points: attribute handling (`$`), array normalization (`explicitArray`), and round-trip fidelity for metadata XML (self-closing tags, encoding declarations). Add snapshot tests on representative metadata files before migrating.
- [x] **Evaluate `@xmldom/xmldom` + `xpath` removal** -> DECISION (2026-08-09): both stay, the XPath cleaning feature (`cleanXmlPatterns`) is kept. Documented in `src/commands/hardis/project/clean/xml.ts`. Original text:: both used only by `src/commands/hardis/project/clean/xml.ts` (XPath-based cleaning, driven by user config `cleanXmlPatterns`). Removing them means reworking or deprecating the XPath feature, which is a breaking change for users with XPath config. Decision needed; if kept, document that these two stay.

## Phase 4 - Duplicated clients

- [x] **HTTP consolidation** -> DECISION (2026-08-09): native fetch via `src/common/utils/httpUtils.ts`, axios removed. Original text:: `axios` is used in ~10 files, native `fetch` is available on Node >= 20. Either migrate all axios usages to fetch (removes `axios` and its `resolutions` pin) or explicitly keep axios as the single HTTP client. Decide once, then enforce.
- [x] **OpenAI clients**: three coexist: `openai` (in `src/common/aiProvider/openaiProvider.ts`), `@openai/codex-sdk`, `@langchain/openai`. Route `openaiProvider` through `@langchain/openai` and drop the standalone `openai` package. `@openai/codex-sdk` stays as long as the Codex provider exists.
- [x] **Evaluate `psl`** -> replaced by `src/common/utils/domainUtils.ts`. Original text:: used once in `src/commands/hardis/project/audit/remotesites.ts`. No transitive deps but ships a large data file. Low priority; possible replacement is a simple domain extraction since the command only groups remote sites.

## Phase 5 - Structural: split into oclif plugins (major version)

The biggest lever. Move optional feature families out of the core install so CI pipelines that only deploy/monitor do not fetch them:

- [ ] **`sfdx-hardis-ai` plugin**: `@langchain/anthropic`, `@langchain/core`, `@langchain/google-genai`, `@langchain/ollama`, `@langchain/openai`, `langchain`, `@openai/codex-sdk` (and `openai` if not already removed). Requires a plugin boundary around `src/common/aiProvider/`.
- [ ] **`sfdx-hardis-doc` plugin**: `@cparra/apexdocs`, `jsdoc-to-markdown`, `md-to-pdf` (if not already removed), `pptxgenjs`, `exceljs`. Requires a boundary around `src/common/docBuilder/` and the doc commands.
- [ ] Core detects whether the plugin is installed and prints an actionable install hint (`sf plugins install sfdx-hardis-ai`) when an AI/doc feature is invoked without it.

## Phase 6 - Guardrails (keep the number down)

- [ ] Add `npx knip` (or `depcheck`) to CI to catch unused dependencies.
- [ ] Add a lockfile-entry-count check in CI (fail or warn when a PR adds more than N transitive packages) so tree growth is visible at review time.
- [ ] After Phases 1-4, prune stale entries from `resolutions` (candidates once their parents are gone: `basic-ftp`, `yauzl`, `tar-fs` pins, `dompurify`, `undici`, `ip-address`).
- [ ] Re-run `rtk gain`-style measurement: record the new dependency count and lockfile entry count in this file after each phase.

## Progress log

| Date | Phase | Change | Runtime deps | yarn.lock entries |
|------|-------|--------|--------------|-------------------|
| 2026-08-09 | baseline | - | 66 | 1782 |
| 2026-08-09 | 1 | removed @langchain/community, fast-xml-builder, csv-stringify, make-fetch-happen, mega-linter-runner | 61 | - |
| 2026-08-09 | 2 | replaced isomorphic-dompurify (sanitize-html added), update-notifier, read-package-up, md-to-pdf, cloudflare; farmhash kept | 57 | - |
| 2026-08-09 | 3 | removed xml2js (fast-xml-parser compat layer); @xmldom/xmldom + xpath kept | 56 | - |
| 2026-08-09 | 4 | removed axios, openai, psl; pruned resolutions (dompurify, axios, mega-linter-runner/which, parse5, serve-handler) | 52 | 1423 |
