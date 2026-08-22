/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from '../../../../common/utils/fsUtils.js';
import * as path from 'path';
import { createTempDir, execCommand, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { getConfig, setConfig } from '../../../../config/index.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class SkillsImport extends SfCommand<any> {
  public static title = 'Import Skills';

  public static description = `
## Command Behavior

**Imports Claude Code skills, agents, and rules from a remote git repository into the current project.**

This command makes it easier to share and reuse AI coding agent configurations across projects. It clones a remote repository containing Claude Code configuration files (skills, agents, rules) into a temporary directory, then copies them into the current project's \`.claude/\` folder.

Key functionalities:

- **Remote Repository Cloning:** Clones the specified git repository into a temporary directory for file extraction.
- **Flexible Source Layout:** Reads skills and agents from the repository root (\`skills/\`, \`agents/\`) and rules from \`.claude/rules/\`, which is the layout used by the Cloudity framework repo. Older repos that keep everything under \`.claude/\` (\`.claude/skills/\`, \`.claude/agents/\`) are still supported as a fallback. For each kind, the first matching source location wins.
- **File Copy with Overwrite Control:** Copies the resolved \`skills/\`, \`agents/\`, \`rules/\` into the project's \`.claude/\` folder, plus \`CLAUDE.md\` and \`WORKFLOW.md\` from the repo root. If any files already exist, prompts once to overwrite all or skip all (defaults to overwrite).
- **Config Persistence:** When \`--repo\` is not provided, reads the repo URL from the \`skillsRepo\` config property. If not found, prompts the user and stores the URL for future use.
- **Add-On Mode:** When \`--addon\` is used, the resolved repository URL is appended to the \`skillsRepoAddOns\` array config property instead of being saved as the main \`skillsRepo\`. This lets you track a main skills repo plus a list of complementary add-on repos in the project config. The actual files are still imported from a single repo per invocation; merging across the main repo and add-ons is expected to be handled separately by an agent later.
- **Agent Mode:** Supports \`--agent\` flag for non-interactive CI/CD and automation use. In agent mode, \`--repo\` or \`skillsRepo\` config must be set, and existing files are always overwritten.

<details markdown="1">
<summary>Technical explanations</summary>

- Clones the repo with \`git clone --depth 1\` (shallow clone for speed) into a temp directory created via \`createTempDir()\`.
- For each kind of config, resolves the source directory from a list of candidate locations and copies every file into the matching \`.claude/<kind>/\` path in the current project: \`skills\` from \`skills/\` then \`.claude/skills/\`; \`agents\` from \`agents/\` then \`.claude/agents/\`; \`rules\` from \`.claude/rules/\` then \`rules/\`. The first existing candidate wins for each kind.
- If none of the candidate locations and no root \`CLAUDE.md\`/\`WORKFLOW.md\` are found, the command fails with a clear error.
- In interactive mode, if any existing files are detected, a single overwrite prompt is shown (default: overwrite all).
- In agent mode (\`--agent\`), all existing files are silently overwritten.
- With \`--addon\`, the URL is appended (deduplicated) to the \`skillsRepoAddOns\` string array config property; without it, the URL replaces the \`skillsRepo\` string config property as before.
- The temporary directory is cleaned up after the operation completes.
</details>
`;

  public static examples = [
    '$ sf hardis:project:skills:import',
    '$ sf hardis:project:skills:import --repo https://github.com/mycompany/claude-skills.git',
    '$ sf hardis:project:skills:import --repo https://github.com/mycompany/claude-skills-billing.git --addon',
    '$ sf hardis:project:skills:import --agent --repo https://github.com/mycompany/claude-skills.git',
  ];

  public static flags: any = {
    repo: Flags.string({
      char: 'r',
      description: 'Git repository URL containing .claude/ skills, agents, and rules to import',
    }),
    addon: Flags.boolean({
      default: false,
      description: 'Persist the repository URL to the skillsRepoAddOns array config property instead of the main skillsRepo property',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
  };

  public static requiresProject = false;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(SkillsImport);
    this.debugMode = flags.debug || false;
    const agentMode = flags.agent === true;
    const addonMode = flags.addon === true;

    // Resolve repo URL: flag > config > prompt
    const repoUrl = await this.resolveRepoUrl(flags.repo, agentMode);

    // Clone repo into temp directory
    const tmpDir = await createTempDir();
    uxLog("action", this, c.cyan(t("skillsImportCloningRepo", { repo: repoUrl })));
    try {
      await execCommand(`git clone --depth 1 ${repoUrl} ${tmpDir}`, this, {
        fail: true,
        output: true,
        debug: this.debugMode,
      });
    } catch (e) {
      await fs.remove(tmpDir);
      throw new Error(t("skillsImportCloneError", { repo: repoUrl, error: (e as Error).message }));
    }

    // Clone succeeded: persist repo URL in project config (main or add-ons list)
    await this.persistRepoUrl(repoUrl, addonMode);

    // Collect all files to copy into the project's .claude/ folder.
    // Source layout varies between repos: the Cloudity framework keeps skills and agents at the
    // repository root (skills/, agents/) and only rules under .claude/rules/, while older layouts
    // kept everything under .claude/. For each target subdir, try the candidate source locations
    // in order and use the first one that exists.
    const targetClaudeDir = path.join(process.cwd(), '.claude');
    const subdirSources: Array<{ subdir: string; candidates: string[] }> = [
      { subdir: 'skills', candidates: ['skills', path.join('.claude', 'skills')] },
      { subdir: 'agents', candidates: ['agents', path.join('.claude', 'agents')] },
      { subdir: 'rules', candidates: [path.join('.claude', 'rules'), 'rules'] },
    ];
    const filesToCopy: Array<{ sourcePath: string; targetPath: string; label: string }> = [];

    for (const { subdir, candidates } of subdirSources) {
      for (const candidate of candidates) {
        const sourceSubdir = path.join(tmpDir, candidate);
        if (!(await fs.pathExists(sourceSubdir))) {
          continue;
        }
        const files = await this.listFilesRecursive(sourceSubdir);
        for (const relPath of files) {
          filesToCopy.push({
            sourcePath: path.join(sourceSubdir, relPath),
            targetPath: path.join(targetClaudeDir, subdir, relPath),
            label: path.join(subdir, relPath),
          });
        }
        // First existing candidate location wins for this subdir
        break;
      }
    }

    // Also collect root-level files (CLAUDE.md, WORKFLOW.md)
    const rootFiles = ['CLAUDE.md', 'WORKFLOW.md'];
    for (const rootFile of rootFiles) {
      const sourceFile = path.join(tmpDir, rootFile);
      if (await fs.pathExists(sourceFile)) {
        filesToCopy.push({
          sourcePath: sourceFile,
          targetPath: path.join(process.cwd(), rootFile),
          label: rootFile,
        });
      }
    }

    // Nothing matched any of the expected source locations
    if (filesToCopy.length === 0) {
      await fs.remove(tmpDir);
      throw new Error(t("skillsImportNothingFound", { repo: repoUrl }));
    }

    // Check if any target files already exist and ask overwrite once
    const hasExistingFiles = await this.hasAnyExistingTarget(filesToCopy.map((f) => f.targetPath));
    let overwriteExisting = agentMode;
    if (hasExistingFiles && !agentMode) {
      overwriteExisting = await this.promptOverwrite();
    }

    // Copy all files
    uxLog("action", this, c.cyan(t("skillsImportCopyingFiles")));
    let copiedCount = 0;
    let skippedCount = 0;

    for (const { sourcePath, targetPath, label } of filesToCopy) {
      if ((await fs.pathExists(targetPath)) && !overwriteExisting) {
        uxLog("log", this, c.grey(t("skillsImportSkipped", { file: label })));
        skippedCount++;
        continue;
      }

      await fs.ensureDir(path.dirname(targetPath));
      await fs.copy(sourcePath, targetPath);
      uxLog("action", this, c.green(t("skillsImportCopied", { file: label })));
      copiedCount++;
    }

    // Cleanup temp directory
    await fs.remove(tmpDir);

    uxLog("action", this, c.cyan(t("skillsImportComplete", { copied: copiedCount, skipped: skippedCount })));

    return { outputString: 'Imported skills', copiedCount, skippedCount, repoUrl, addonMode };
  }

  private async resolveRepoUrl(flagRepo: string | undefined, agentMode: boolean): Promise<string> {
    // 1. Use --repo flag if provided
    if (flagRepo) {
      return flagRepo;
    }

    // 2. Look in sfdx-hardis config
    const config = await getConfig('project');
    if (config.skillsRepo) {
      uxLog("log", this, c.grey(t("skillsImportUsingConfigRepo", { repo: config.skillsRepo })));
      return config.skillsRepo;
    }

    // 3. In agent mode, fail if no repo found
    if (agentMode) {
      throw new Error(t("skillsImportNoRepoAgent"));
    }

    // 4. Prompt user for repo URL
    const response = await prompts({
      type: 'text',
      name: 'repoUrl',
      message: t("skillsImportPromptRepo"),
      description: t("skillsImportPromptRepo"),
      validate: (value: string) => (value.length > 0 ? true : t("skillsImportRepoRequired")),
    });

    if (!response.repoUrl) {
      throw new Error(t("skillsImportRepoRequired"));
    }

    return response.repoUrl;
  }

  private async persistRepoUrl(repoUrl: string, addonMode: boolean): Promise<void> {
    const config = await getConfig('project');

    if (addonMode) {
      const existing: string[] = Array.isArray(config.skillsRepoAddOns) ? config.skillsRepoAddOns : [];
      if (existing.includes(repoUrl)) {
        return;
      }
      const updated = [...existing, repoUrl];
      await setConfig('project', { skillsRepoAddOns: updated });
      uxLog("action", this, c.cyan(t("skillsImportAddonSaved", { repo: repoUrl })));
      return;
    }

    if (config.skillsRepo === repoUrl) {
      return;
    }
    await setConfig('project', { skillsRepo: repoUrl });
    uxLog("log", this, c.grey(t("skillsImportRepoSaved", { repo: repoUrl })));
  }

  private async promptOverwrite(): Promise<boolean> {
    const response = await prompts({
      type: 'confirm',
      name: 'overwrite',
      message: t("skillsImportOverwritePrompt"),
      description: t("skillsImportOverwritePrompt"),
      initial: true,
    });
    return response.overwrite !== false;
  }

  private async hasAnyExistingTarget(targetPaths: string[]): Promise<boolean> {
    for (const targetPath of targetPaths) {
      if (await fs.pathExists(targetPath)) {
        return true;
      }
    }
    return false;
  }

  private async listFilesRecursive(dir: string, base = ''): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const relPath = base ? path.join(base, entry.name) : entry.name;
      if (entry.isDirectory()) {
        files.push(...(await this.listFilesRecursive(path.join(dir, entry.name), relPath)));
      } else {
        files.push(relPath);
      }
    }
    return files;
  }
}
