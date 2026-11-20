// An entry of availableTargetBranches is a branch name, optionally followed by a label after a comma:
// "preprod,Choose this branch for HOTFIX tickets". Whatever reads the branches uses the name only.
// No imports: backpromoteRules, pipelineDescribeUtils and orgInitUtils use it without loading git utilities.

/** "preprod,HOTFIX tickets" -> "preprod". Anything that is not a string -> "". */
export function getTargetBranchName(entry: unknown): string {
  return typeof entry === 'string' ? entry.split(',')[0].trim() : '';
}

/** Bare names of availableTargetBranches, in config order, without empty values or duplicates. */
export function listAvailableTargetBranchNames(config: any): string[] {
  const names: string[] = [];
  const entries = Array.isArray(config?.availableTargetBranches) ? config.availableTargetBranches : [];
  for (const entry of entries) {
    const name = getTargetBranchName(entry);
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}
