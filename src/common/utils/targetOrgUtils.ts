import { Org } from '@salesforce/core';

export type TargetUsernameSource = 'commandLine' | 'branchConfig' | 'defaultOrg';

/* True when the flag was given on the command line, in any form (--target-org x, -ox, -u x...).
   oclif marks a flag whose value comes from its default with metadata.flags[name].setFromDefault.
   A flag that is absent from the parse result was not given at all. */
export function isFlagTyped(
  parseOutput: { flags?: Record<string, any>; metadata?: { flags?: Record<string, { setFromDefault?: boolean }> } },
  flagName: string
): boolean {
  if (parseOutput.flags?.[flagName] === undefined) {
    return false;
  }
  return parseOutput.metadata?.flags?.[flagName]?.setFromDefault !== true;
}

/* Decides which org a command targets, before the interactive confirmation.

   1. --target-org typed on the command line: the user asked for that org.
   2. targetUsername of the branch config: the org linked to the target branch.
   3. The default org, that the --target-org flag falls back to when it is not typed.

   The flag value alone can not tell 1 from 3: targetOrgTyped comes from the parse metadata
   (see isFlagTyped). flagUsername is the username the flag resolved, alias included.
*/
export function resolveTargetUsername(options: {
  targetOrgTyped: boolean;
  branchConfigTargetUsername: string | null | undefined;
  flagUsername: string | null | undefined;
}): { username: string; source: TargetUsernameSource } {
  const flagUsername = options.flagUsername || '';
  if (options.targetOrgTyped && flagUsername) {
    return { username: flagUsername, source: 'commandLine' };
  }
  if (options.branchConfigTargetUsername) {
    return { username: options.branchConfigTargetUsername, source: 'branchConfig' };
  }
  return { username: flagUsername, source: 'defaultOrg' };
}

// Reuses the org of the --target-org flag when it is the selected one, so no second authentication is made
export async function getTargetOrg(targetUsername: string, flagOrg: Org | undefined): Promise<Org> {
  if (flagOrg && flagOrg.getUsername() === targetUsername) {
    return flagOrg;
  }
  return Org.create({ aliasOrUsername: targetUsername });
}
