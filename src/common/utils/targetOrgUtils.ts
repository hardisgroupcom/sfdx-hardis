import { Org } from '@salesforce/core';
import { extractTargetOrgFromArgv } from './authUtils.js';

export type TargetUsernameSource = 'commandLine' | 'branchConfig' | 'defaultOrg';

/* Decides which org a command targets, before the interactive confirmation.

   1. --target-org typed on the command line: the user asked for that org.
   2. targetUsername of the branch config: the org linked to the target branch.
   3. The default org, that the --target-org flag falls back to when it is not typed.

   The flag value alone can not tell 1 from 3, so the command line is read from argv.
   flagUsername is the username the flag resolved, alias included.
*/
export function resolveTargetUsername(options: {
  argv: string[] | undefined;
  branchConfigTargetUsername: string | null | undefined;
  flagUsername: string | null | undefined;
}): { username: string; source: TargetUsernameSource } {
  const flagUsername = options.flagUsername || '';
  if (extractTargetOrgFromArgv(options.argv) && flagUsername) {
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
