import type { GraphQLClient } from "graphql-request";
import { extractGqlErrorCode } from "$lib/server/gqlError";
import { error } from "@sveltejs/kit";
import { t } from "$lib/i18n/t";
import {
  grantNodeRef,
  grantHolderKey,
  grantError,
  type Grant,
  type GrantPageSlice,
  type Holder,
} from "$lib/grants/types";
import { grantActorRefs } from "$lib/grants/approval";
import { APP_INSTALLED_AGENTS_QUERY } from "$lib/server/queries";
import {
  readableInstalledAgents,
  type InstalledAgent,
} from "$lib/app-installed-agents";
const GRANT_FIELDS = /* GraphQL */ `
  fragment AppGrantFields on Grant {
    id
    appId
    action
    holderKind
    holderId
    requestedByUserId
    requestedByWorkerId
    issuerUserId
    verifiedBy
    revokedByUserId
    values
    reason
    startsAt
    expiresAt
    maxUses
    useCount
    createdAt
    activatedAt
    revokedAt
    holderDepartedAt
    allows
  }
`;
const HOLDER_USER = /* GraphQL */ `
  query GrantHolderUser($ref: ID!) {
    user(ref: $ref) {
      id
      name
      urn
      handle
    }
  }
`;
const HOLDER_WORKER = /* GraphQL */ `
  query GrantHolderWorker($ref: ID!) {
    worker(ref: $ref) {
      id
      name
      urn
    }
  }
`;
const HOLDER_AGENT = /* GraphQL */ `
  query GrantHolderAgent($ref: ID!) {
    agent(ref: $ref) {
      id
      name
      urn
    }
  }
`;
const HOLDER_APP = /* GraphQL */ `
  query GrantHolderApp($ref: ID!) {
    app(ref: $ref) {
      id
      name
      urn
    }
  }
`;
export const GRANTS_APP = /* GraphQL */ `
  query AppGrantsApp($ref: ID!) {
    app(ref: $ref) {
      id
      name
      urn
      organizationId
      viewerManages
    }
  }
`;
export const GRANTS_PAGE = /* GraphQL */ `
  ${GRANT_FIELDS}
  query AppGrantsPage($appRef: String!, $limit: Int!, $offset: Int!) {
    appGrants(appRef: $appRef, limit: $limit, offset: $offset) {
      items {
        ...AppGrantFields
      }
      total
    }
  }
`;
export const CREATE_GRANT = /* GraphQL */ `
  ${GRANT_FIELDS}
  mutation CreateAppGrant($input: CreateGrantInput!) {
    createGrant(input: $input) {
      ...AppGrantFields
    }
  }
`;
export const REVOKE_GRANT = /* GraphQL */ `
  ${GRANT_FIELDS}
  mutation RevokeAppGrant($ref: ID!) {
    revokeGrant(ref: $ref) {
      ...AppGrantFields
    }
  }
`;
// The same roster surface used by loadWriteCandidates; no People or free-text holder option.
export const GRANT_WORKERS = /* GraphQL */ `
  query AppGrantWorkers($appRef: ID!) {
    teamRoster(appRef: $appRef) {
      workers {
        worker {
          id
          name
          urn
        }
      }
    }
  }
`;
export type GrantsApp = {
  id: string;
  name: string;
  urn: string;
  organizationId?: string | null;
  viewerManages: boolean;
};
export async function requireGrantManager(
  client: GraphQLClient,
  ref: string,
): Promise<GrantsApp> {
  const missing = () => error(404, t("grants.app.missing", "App not found."));
  let app: GrantsApp | null;
  try {
    ({ app } = await client.request<{ app: GrantsApp | null }>(GRANTS_APP, {
      ref,
    }));
  } catch (e) {
    // Match the sibling App route's explicit concealment codes. An outage is
    // unavailable, never evidence that this App does not exist.
    if (
      [
        "FORBIDDEN",
        "NOT_FOUND",
        "APP_NOT_FOUND",
        "UNAUTHENTICATED",
        "BAD_USER_INPUT",
      ].includes(extractGqlErrorCode(e) ?? "")
    )
      throw missing();
    throw error(503, grantError(null));
  }
  if (!app) throw missing();
  if (app.viewerManages !== true)
    throw error(
      403,
      t("grants.hidden", "This section is available to App managers."),
    );
  return app;
}
export async function grantChoices(client: GraphQLClient, appRef: string) {
  const [roster, installed] = await Promise.all([
    client.request<{ teamRoster: { workers: { worker: Holder }[] } }>(
      GRANT_WORKERS,
      { appRef },
    ),
    client.request<{
      app: { appAgents: { agent: InstalledAgent | null }[] | null } | null;
    }>(APP_INSTALLED_AGENTS_QUERY, { ref: appRef }),
  ]);
  const agents = readableInstalledAgents(installed.app?.appAgents);
  if (agents.kind === "withheld")
    throw error(
      503,
      t(
        "grants.choices.unavailable",
        "The holder choices could not be loaded.",
      ),
    );
  return {
    workers: roster.teamRoster.workers.map((w) => w.worker),
    agents: agents.agents,
  };
}
type IdentityRead = Record<
  string,
  (Holder & { handle?: string | null }) | null
>;
type IdentityReads = Map<string, Promise<IdentityRead>>;
function readIdentity(
  client: GraphQLClient,
  kind: Grant["holderKind"],
  id: string,
  reads: IdentityReads,
) {
  const key = kind + ":" + id;
  let held = reads.get(key);
  if (!held) {
    held = client.request<IdentityRead>(
      {
        USER: HOLDER_USER,
        WORKER: HOLDER_WORKER,
        AGENT: HOLDER_AGENT,
        APP: HOLDER_APP,
      }[kind],
      { ref: id },
    );
    reads.set(key, held);
  }
  return held;
}
export async function grantActors(
  client: GraphQLClient,
  grants: Grant[],
  reads: IdentityReads = new Map(),
): Promise<Record<string, Holder>> {
  const refs = new Map(
    grants.flatMap(grantActorRefs).map((r) => [r.kind + ":" + r.id, r]),
  );
  return Object.fromEntries(
    await Promise.all(
      [...refs].map(async ([key, r]) => {
        try {
          const raw = await readIdentity(client, r.kind, r.id, reads);
          const actor = raw[r.kind === "USER" ? "user" : "worker"];
          return [
            key,
            actor
              ? { ...actor, name: actor.name || actor.handle || r.id }
              : { id: r.id, name: r.id },
          ];
        } catch {
          return [key, { id: r.id, name: r.id }];
        }
      }),
    ),
  );
}
export async function grantHolders(
  client: GraphQLClient,
  grants: Grant[],
  reads: IdentityReads = new Map(),
): Promise<Record<string, Holder>> {
  const entries = new Map(grants.map((g) => [grantHolderKey(g), g]));
  return Object.fromEntries(
    await Promise.all(
      [...entries].map(async ([key, g]) => {
        const field = {
          USER: "user",
          WORKER: "worker",
          AGENT: "agent",
          APP: "app",
        }[g.holderKind];
        const fallback =
          g.holderKind === "WORKER"
            ? t("grants.deleted.worker", "a deleted worker")
            : g.holderKind === "USER"
              ? g.holderDepartedAt
                ? t("grants.deleted.user", "a deleted user")
                : t("grants.holder.unavailable", "Holder unavailable")
              : g.holderKind === "AGENT"
                ? t("grants.holder.agent", "Agent")
                : t("grants.holder.app", "App");
        try {
          const r = await readIdentity(client, g.holderKind, g.holderId, reads);
          const holder = r[field];
          return [
            key,
            holder
              ? { ...holder, name: holder.name || holder.handle || fallback }
              : { id: g.holderId, name: fallback },
          ];
        } catch (e) {
          return [
            key,
            {
              id: g.holderId,
              name:
                g.holderKind === "WORKER" &&
                extractGqlErrorCode(e) === "WORKER_NOT_FOUND"
                  ? fallback
                  : t("grants.holder.unavailable", "Holder unavailable"),
            },
          ];
        }
      }),
    ),
  );
}

const GRANT_SUBJECT_NODE = /* GraphQL */ `
  query GrantSubjectNode($ref: ID!) {
    node(ref: $ref) {
      id
      name
      urn
    }
  }
`;
export async function grantNodes(
  client: GraphQLClient,
  grants: Grant[],
): Promise<Record<string, Holder | null>> {
  const refs = [
    ...new Set(
      grants
        .slice(0, 20)
        .map(grantNodeRef)
        .filter((ref): ref is string => ref !== null),
    ),
  ];
  return Object.fromEntries(
    await Promise.all(
      refs.map(async (ref) => {
        try {
          const { node } = await client.request<{ node: Holder | null }>(
            GRANT_SUBJECT_NODE,
            { ref },
          );
          return [ref, node] as const;
        } catch {
          // A grant does not make its referenced node readable. Never invent a URN.
          return [ref, null] as const;
        }
      }),
    ),
  );
}

export function grantOffset(url: URL): number {
  const raw = url.searchParams.get("offset") ?? "0";
  const n = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(n) && n <= 2147483647
    ? n
    : 0;
}
export async function readGrantPage(
  client: GraphQLClient,
  appId: string,
  offset: number,
): Promise<GrantPageSlice> {
  const { appGrants } = await client.request<{
    appGrants: { items: Grant[]; total: number };
  }>(GRANTS_PAGE, { appRef: appId, limit: 20, offset });
  const reads: IdentityReads = new Map();
  const [holders, nodes, actors] = await Promise.all([
    grantHolders(client, appGrants.items, reads),
    grantNodes(client, appGrants.items),
    grantActors(client, appGrants.items, reads),
  ]);
  return { grants: appGrants, holders, nodes, actors };
}

export const REQUEST_GRANT_SIGNATURE = /* GraphQL */ `
  mutation RequestAppGrantSignature($grantRef: ID!) {
    requestGrantSignature(grantRef: $grantRef) {
      ceremonyUrl
    }
  }
`;
