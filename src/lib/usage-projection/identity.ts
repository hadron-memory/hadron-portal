import type { UsageAccount } from './types';
/** A URL selection key, never an unchecked GraphQL selector. */
export function accountKey(a: Pick<UsageAccount, 'account' | 'host' | 'family'>): string {
  return JSON.stringify([a.account, a.host, a.family]);
}
