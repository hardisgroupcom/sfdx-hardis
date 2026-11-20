import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git';

export type SimpleGitUnsafeOptions = SimpleGitOptions['unsafe'];

/**
 * The only place where sfdx-hardis creates a simple-git instance, so that every git call gets
 * the same environment. ESLint (no-restricted-imports in eslint.config.mjs) refuses an import of
 * simpleGit from 'simple-git' anywhere else in src/.
 *
 * Inherited environment: simple-git v4 removes every inherited GIT_* variable from the git
 * process, and EDITOR, VISUAL, PAGER, SSH_ASKPASS and PREFIX too, unless they are named in
 * allowEnvironment. sfdx-hardis needs them as v3 passed them: GIT_ASKPASS for pushes from the
 * VS Code terminal, GIT_SSL_CAINFO / GIT_SSL_NO_VERIFY behind a corporate proxy,
 * GIT_CONFIG_COUNT/KEY/VALUE set by CI runners, GIT_DIR / GIT_WORK_TREE, GIT_SSH_COMMAND...
 * They come from the user or the CI runner, never from data sfdx-hardis reads, so the whole
 * inherited environment goes through.
 * Limit: allowEnvironment only accepts a list of names, and simple-git turns it into a fixed set
 * when the instance is created. The values are read when each git process starts, but a guarded
 * variable (GIT_*, EDITOR...) whose name first appears in process.env after the instance was
 * created is removed.
 * git() creates a new instance on every call, so this only matters for an instance kept and
 * reused after such a change: create a new one instead.
 *
 * Abbreviated options: simple-git v4 also sets GIT_TEST_DISALLOW_ABBREVIATED_OPTIONS=true on
 * every git process (the fix for GHSA-858h-whjf-mvg5), so git refuses an abbreviated long
 * option such as --dry for --dry-run. sfdx-hardis keeps it on (allowAbbreviatedOptions is not
 * set): every git argument must be spelled in full. The variable is inherited by what git
 * starts, so git hooks, aliases and merge drivers that call git with an abbreviated option fail
 * the same way.
 *
 * The argument and config guards stay on: unsafe is only set for a call that needs it.
 */
export function createSimpleGit(baseDir?: string, unsafe?: SimpleGitUnsafeOptions): SimpleGit {
  const options: Partial<SimpleGitOptions> = {
    allowEnvironment: Object.keys(process.env),
  };
  if (baseDir) {
    options.baseDir = baseDir;
  }
  if (unsafe) {
    options.unsafe = unsafe;
  }
  return simpleGit(options);
}
