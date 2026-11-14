/**
 * hadron-portal#2134 — a person's own grants across Apps (`myGrants`,
 * hrn:node:hadronmemory.com:specs:cor:acl:140:05).
 *
 * The server answers an impersonated session (and an App key, run or worker
 * session) with an EMPTY page, never an error, so an empty answer cannot be
 * read as "no grants" there. Under impersonation we do not ask at all and say
 * the view is unavailable (display condition 3). A refused read is a 503, never
 * an empty list.
 */
import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { t } from '$lib/i18n/t';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import type { Grant } from '$lib/grants/types';
import type { PageServerLoad } from './$types';

const MY_GRANT_FIELDS = /* GraphQL */ `
  fragment MyGrantFields on Grant {
    id
    appId
    action
    holderKind
    holderId
    values
    reason
    startsAt
    expiresAt
    maxUses
    useCount
    createdAt
    activatedAt
    revokedAt
    allows
  }
`;
const MY_GRANTS_PAGE = /* GraphQL */ `
  ${MY_GRANT_FIELDS}
  query MyGrantsPage($limit: Int!, $offset: Int!) {
    myGrants(limit: $limit, offset: $offset) {
      items {
        ...MyGrantFields
      }
      total
    }
  }
`;
const MY_GRANT_APP = /* GraphQL */ `
  query MyGrantApp($ref: ID!) {
    app(ref: $ref) {
      id
      name
      urn
    }
  }
`;

const LIMIT = 200; // the page cap, hrn:node:hadronmemory.com:specs:cor:api:120:04
const APP_LOOKUPS_AT_ONCE = 8;

export type MyGrantApp = { id: string; name: string; urn: string };
// 'unopenable': the server answered and the App is not readable by this person (null).
// 'unavailable': the lookup itself failed, which says nothing about access.
export type MyGrant = Omit<Grant, 'holderDepartedAt'> & { app: MyGrantApp | null; appStatus: 'ok' | 'unopenable' | 'unavailable' };

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.token || locals.impersonation) return { unavailable: true, grants: [] as MyGrant[] };
  const client = gqlClient(locals.token);
  const rows: Grant[] = [];
  try {
    // Drain to the server-reported end: a silent cap would show a partial list as the whole one.
    // An empty page ends it (the list shrank under us); every other page grows `rows`.
    for (;;) {
      const { myGrants } = await client.request<{ myGrants: { items: Grant[]; total: number } }>(
        MY_GRANTS_PAGE,
        { limit: LIMIT, offset: rows.length },
      );
      rows.push(...myGrants.items);
      if (myGrants.items.length === 0 || rows.length >= myGrants.total) break;
    }
  } catch {
    throw error(503, t('grants.mine.unavailable', 'Your grants could not be loaded.'));
  }
  // An App the person can no longer open (or that is concealed) keeps its row,
  // named by id (display condition 4): membership is not a condition.
  const apps = new Map<string, { app: MyGrantApp | null; status: MyGrant['appStatus'] }>();
  const ids = [...new Set(rows.map((g) => g.appId))];
  const lookup = async (id: string) => {
    try {
      const r = await client.request<{ app: MyGrantApp | null }>(MY_GRANT_APP, { ref: id });
      apps.set(id, r.app ? { app: r.app, status: 'ok' } : { app: null, status: 'unopenable' });
    } catch (e) {
      // Only a concealment code is an access answer; an outage or rate limit is not.
      const refused = ['FORBIDDEN', 'NOT_FOUND', 'APP_NOT_FOUND'].includes(extractGqlErrorCode(e) ?? '');
      apps.set(id, { app: null, status: refused ? 'unopenable' : 'unavailable' });
    }
  };
  // Bounded: a person with many Apps must not burst one request per App at once.
  await Promise.all(
    Array.from({ length: Math.min(APP_LOOKUPS_AT_ONCE, ids.length) }, async () => {
      for (let id = ids.shift(); id !== undefined; id = ids.shift()) await lookup(id);
    }),
  );
  return {
    unavailable: false,
    grants: rows.map((g): MyGrant => {
      const a = apps.get(g.appId);
      return { ...g, app: a?.app ?? null, appStatus: a?.status ?? 'unavailable' };
    }),
  };
};
