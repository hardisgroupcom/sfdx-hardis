// CI/CD variable references in a Browserforce setting value: a string value written exactly
// "${NAME}" (the rule of Browserforce itself, "$${NAME}" stays literal). sfdx-hardis reads them
// through the secrets provider for the target branch (NAME_<BRANCH> first, then NAME) and hands
// the values to Browserforce as environment variables only.
import { getSecretsProvider } from '../../secretsProvider/index.js';
import { registerSecretValue } from '../../utils/secretMaskingUtils.js';
import { DEV_SANDBOXES_BRANCH_NAME } from '../../utils/actionUtils.js';

const VARIABLE_REFERENCE_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
// Placeholder of the variable name in the lookup templates given to the VS Code extension
export const VARIABLE_NAME_PLACEHOLDER = '{NAME}';

export interface VariableReference {
  name: string;
  // Path of the value in the setting, as Browserforce writes it (portals[0].name, MyProvider.consumerSecret)
  path: string;
}

export interface VariableLookup extends VariableReference {
  // For each major branch, then dev-sandboxes: the variables read, in order
  lookupByBranch: { branch: string; names: string[] }[];
}

export interface SecretsLookupDescription {
  provider: string;
  label: string;
  // Names read for a variable called {NAME}, per major branch, then for dev-sandboxes
  branches: { branch: string; names: string[] }[];
}

export interface ResolvedVariables {
  env: Record<string, string>;
  missing: { name: string; lookedUp: string[] }[];
}

/** Every variable reference of a setting value, in the order of the value */
export function findVariableReferences(value: any, pathPrefix = ''): VariableReference[] {
  if (typeof value === 'string') {
    const match = VARIABLE_REFERENCE_PATTERN.exec(value);
    return match ? [{ name: match[1], path: pathPrefix }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findVariableReferences(item, `${pathPrefix}[${index}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => findVariableReferences(child, pathPrefix ? `${pathPrefix}.${key}` : key));
  }
  return [];
}

/**
 * Reads the value of each referenced variable for the target branch. A value is registered for
 * masking when one of its references is a secret: an ordinary value per org (Compact, a URL) masked
 * everywhere would turn the same word into *** in every log and comment of the job.
 */
export async function resolveVariables(
  references: VariableReference[],
  targetBranch: string | null,
  isSecret: (reference: VariableReference) => boolean = () => true
): Promise<ResolvedVariables> {
  const resolved: ResolvedVariables = { env: {}, missing: [] };
  const names = [...new Set(references.map((reference) => reference.name))];
  if (names.length === 0) {
    return resolved;
  }
  const secretsProvider = await getSecretsProvider();
  for (const name of names) {
    const secret = await secretsProvider.getSecret(name, targetBranch);
    if (secret.value == null) {
      resolved.missing.push({ name, lookedUp: secret.lookedUp });
      continue;
    }
    if (references.some((reference) => reference.name === name && isSecret(reference))) {
      registerSecretValue(secret.value);
    }
    resolved.env[name] = secret.value;
  }
  return resolved;
}

/** The variables a setting value references, with the names to declare for each org */
export async function describeVariableLookups(value: any): Promise<VariableLookup[]> {
  const references = findVariableReferences(value);
  if (references.length === 0) {
    return [];
  }
  const lookup = await describeSecretsLookup();
  return references.map((reference) => ({
    ...reference,
    lookupByBranch: lookup.branches.map((branch) => ({
      branch: branch.branch,
      names: branch.names.map((name) => name.split(VARIABLE_NAME_PLACEHOLDER).join(reference.name)),
    })),
  }));
}

/** How the secrets provider names a variable for each major branch and for the developer orgs */
export async function describeSecretsLookup(): Promise<SecretsLookupDescription> {
  const secretsProvider = await getSecretsProvider();
  const { listMajorOrgs } = await import('../../utils/orgConfigUtils.js');
  const majorBranches: string[] = (await listMajorOrgs())
    .map((majorOrg: any) => majorOrg?.branchName)
    .filter((branchName: any) => typeof branchName === 'string' && branchName !== '');
  const branches = [...new Set(majorBranches)].map((branch) => ({
    branch,
    names: secretsProvider.describeLookup(VARIABLE_NAME_PLACEHOLDER, branch),
  }));
  branches.push({ branch: DEV_SANDBOXES_BRANCH_NAME, names: secretsProvider.describeLookup(VARIABLE_NAME_PLACEHOLDER, null) });
  return { provider: secretsProvider.getKey(), label: secretsProvider.getLabel(), branches };
}
