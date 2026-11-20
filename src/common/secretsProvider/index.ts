import { SfError } from '@salesforce/core';
import { getConfig } from '../../config/index.js';
import { t } from '../utils/i18n.js';
import { CiVariablesSecretsProvider } from './ciVariablesSecretsProvider.js';
import { SecretsProviderRoot } from './secretsProviderRoot.js';

export type { SecretValueResult } from './secretsProviderRoot.js';
export { SecretsProviderRoot } from './secretsProviderRoot.js';

type SecretsProviderClass = {
  new(): SecretsProviderRoot;
  providerKey: string;
};

// A vault connector is one more entry here
export const allSecretsProviders: SecretsProviderClass[] = [CiVariablesSecretsProvider];

export const DEFAULT_SECRETS_PROVIDER = CiVariablesSecretsProvider.providerKey;

export function secretsProviderKeys(): string[] {
  return allSecretsProviders.map((provider) => provider.providerKey);
}

/** The provider named by `secretsProvider` in .sfdx-hardis.yml, CI/CD variables by default */
export async function getSecretsProvider(config?: any): Promise<SecretsProviderRoot> {
  const projectConfig = config || (await getConfig('project'));
  const key = projectConfig?.secretsProvider || DEFAULT_SECRETS_PROVIDER;
  const providerClass = allSecretsProviders.find((provider) => provider.providerKey === key);
  if (!providerClass) {
    throw new SfError(t('secretsProviderUnknown', { provider: key, providers: secretsProviderKeys().join(', ') }));
  }
  return new providerClass();
}
