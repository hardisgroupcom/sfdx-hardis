import { GitProvider } from '../gitProvider/index.js';
import { TicketProvider } from '../ticketProvider/index.js';
import { ProviderConnectionStatus } from './providerCliAuthUtils.js';

export type ConnectionCheckType = 'git' | 'ticketing';

export const CONNECTION_CHECK_TYPES: ConnectionCheckType[] = ['git', 'ticketing'];

export interface ConnectionCheckResult {
  /** True when every provider checked is connected */
  connected: boolean;
  providers: ProviderConnectionStatus[];
}

/** Checks the git provider of the current repository and the ticketing systems of the project */
export async function checkProviderConnections(types: ConnectionCheckType[] = CONNECTION_CHECK_TYPES): Promise<ConnectionCheckResult> {
  const providers: ProviderConnectionStatus[] = [];
  if (types.includes('git')) {
    providers.push(await GitProvider.checkConnection());
  }
  if (types.includes('ticketing')) {
    providers.push(...(await TicketProvider.checkConnections()));
  }
  return { connected: providers.length > 0 && providers.every((provider) => provider.connected), providers };
}

/** One line per provider, for the table of the command */
export function connectionStatusRows(providers: ProviderConnectionStatus[]): Record<string, string>[] {
  return providers.map((provider) => ({
    type: provider.type,
    provider: provider.label || '-',
    connected: provider.connected ? 'yes' : 'no',
    tokenSource: provider.tokenSource || '-',
    detail: provider.detail || '',
  }));
}
