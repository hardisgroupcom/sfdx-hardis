import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git';

export type SimpleGitUnsafeOptions = SimpleGitOptions['unsafe'];

/**
 * The only place where sfdx-hardis creates a simple-git instance, so that every git call gets
 * the same environment.
 *
 * simple-git v4 removes every inherited GIT_* variable from the git process, and EDITOR, VISUAL,
 * PAGER, SSH_ASKPASS and PREFIX too, unless they are named in allowEnvironment. sfdx-hardis
 * needs them as v3 passed them: GIT_ASKPASS for pushes from the VS Code terminal,
 * GIT_SSL_CAINFO / GIT_SSL_NO_VERIFY behind a corporate proxy, GIT_CONFIG_COUNT/KEY/VALUE set
 * by CI runners, GIT_DIR / GIT_WORK_TREE, GIT_SSH_COMMAND... They come from the user or the CI
 * runner, never from data sfdx-hardis reads, so the whole inherited environment goes through.
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
