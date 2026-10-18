import { getEnvVar } from '../../config/index.js';
import { SecretsProviderRoot, SecretValueResult } from './secretsProviderRoot.js';

/**
 * Secrets stored as CI/CD variables (GitHub secrets, GitLab masked variables, Azure secret
 * variables, Bitbucket secured variables, Jenkins credentials exposed as environment variables).
 *
 * For a target branch, NAME_<BRANCH> is read first, then NAME: the same convention as
 * SFDX_CLIENT_ID_<BRANCH>. The branch is written the way the branch config files are named
 * (release/uat -> release__uat), as is, upper-cased, then with any character that a CI variable
 * name cannot hold turned into "_".
 */
export class CiVariablesSecretsProvider extends SecretsProviderRoot {
  public static providerKey = 'ciVariables';

  public getKey(): string {
    return CiVariablesSecretsProvider.providerKey;
  }

  public getLabel(): string {
    return 'CI/CD variables';
  }

  public describeLookup(secretName: string, targetBranch: string | null): string[] {
    const names: string[] = [];
    if (targetBranch) {
      const formatted = targetBranch.replace(/\//g, '__');
      names.push(`${secretName}_${formatted}`);
      names.push(`${secretName}_${formatted.toUpperCase()}`);
      names.push(`${secretName}_${formatted.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`);
    }
    names.push(secretName);
    return [...new Set(names)];
  }

  public async getSecret(secretName: string, targetBranch: string | null): Promise<SecretValueResult> {
    const lookedUp = this.describeLookup(secretName, targetBranch);
    for (const variableName of lookedUp) {
      // getEnvVar treats an unresolved Azure "$(VAR)" as not set
      const value = getEnvVar(variableName);
      if (value != null && value !== '') {
        return { value, source: variableName, lookedUp };
      }
    }
    return { value: null, source: null, lookedUp };
  }
}
