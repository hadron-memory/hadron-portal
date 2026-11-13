import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from './gqlError';
import { isActionDefinition, type GrantActionDefinition } from '$lib/grants/actions';

// Field names pinned to server#3708 merge c5a7abf2b, not the issue's draft API.
export const GRANT_ACTIONS = /* GraphQL */ `
  query AppGrantActions($appRef: String!, $limit: Int!, $offset: Int!) {
    grantActions(appRef: $appRef, limit: $limit, offset: $offset) {
      items { name parameters { name type refusesWildcard } }
      total
    }
  }
`;

/** Read per request. The deployment-owned registry is not persisted in the client. */
export async function readGrantActions(client: GraphQLClient, appRef: string): Promise<GrantActionDefinition[]> {
  const actions: GrantActionDefinition[] = [];
  const seen = new Set<string>();
  for (let offset = 0; ; ) {
    let page: { items: GrantActionDefinition[]; total: number } | null;
    try {
      page = (await client.request<{ grantActions: typeof page }>(GRANT_ACTIONS,
        { appRef, limit: 100, offset })).grantActions;
    } catch (e) {
      if (['FORBIDDEN', 'UNAUTHENTICATED', 'APP_NOT_FOUND', 'NOT_FOUND', 'BAD_USER_INPUT'].includes(extractGqlErrorCode(e) ?? '')) return [];
      throw e;
    }
    // Refused and empty are deliberately indistinguishable. No old-table fallback.
    if (!page) return [];
    if (!Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0 ||
      !page.items.every(isActionDefinition)) throw Error('Invalid action catalogue');
    for (const action of page.items) {
      if (seen.has(action.name)) throw Error('Repeated action catalogue item');
      seen.add(action.name);
      actions.push(action);
    }
    offset += page.items.length;
    if (offset >= page.total) return actions;
    if (!page.items.length) throw Error('Incomplete action catalogue');
  }
}
