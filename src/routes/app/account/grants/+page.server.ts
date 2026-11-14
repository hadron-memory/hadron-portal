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
import type { Grant } from '$lib/grants/types';
import type { PageServerLoad } from './$types';

const GRANT_FIELDS = /* GraphQL */ `
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
export const MY_GRANTS_PAGE = /* GraphQL */ `
  ${GRANT_FIELDS}
  query MyGrantsPage($limit: Int!, $offset: Int!) {
    myGrants(limit: $limit, offset: $offset) {
      items {
        ...MyGrantFields
      }
      total
    }
  }
`;
export const MY_GRANT_APP = /* GraphQL */ `
  query MyGrantApp($ref: ID!) {
    app(ref: $ref) {
      id
      name
      urn
    }
  }
`;

const LIMIT = 200; // cor:api:120:04 cap
const MAX_PAGES = 50;

export type MyGrantApp = { id: string; name: string; urn: string };
export type MyGrant = Omit<Grant, 'holderDepartedAt'> & { app: MyGrantApp | null };

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.token || locals.impersonation) return { unavailable: true, grants: [] as MyGrant[] };
  const client = gqlClient(locals.token);
  const rows: Grant[] = [];
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
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
  const apps = new Map<string, MyGrantApp | null>();
  await Promise.all(
    [...new Set(rows.map((g) => g.appId))].map(async (id) => {
      try {
        const r = await client.request<{ app: MyGrantApp | null }>(MY_GRANT_APP, { ref: id });
        apps.set(id, r.app);
      } catch {
        apps.set(id, null);
      }
    }),
  );
  return {
    unavailable: false,
    grants: rows.map((g): MyGrant => ({ ...g, app: apps.get(g.appId) ?? null })),
  };
};
