import type { GraphQLClient } from "graphql-request";
import { extractGqlErrorCode } from "$lib/server/gqlError";
import { error } from "@sveltejs/kit";
import { t } from "$lib/i18n/t";
import { type Grant, type Holder } from "$lib/grants/types";
import { APP_INSTALLED_AGENTS_QUERY } from "$lib/server/queries";
import { readableInstalledAgents } from "$lib/app-installed-agents";
const GRANT_FIELDS = /* GraphQL */ `
  fragment AppGrantFields on Grant {
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
  const { app } = await client.request<{ app: GrantsApp | null }>(GRANTS_APP, {
    ref,
  });
  if (!app) throw error(404, t("grants.app.missing", "App not found."));
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
      app: { appAgents: { agent: Holder | null }[] | null } | null;
    }>(APP_INSTALLED_AGENTS_QUERY, { ref: appRef }),
  ]);
  const agents = readableInstalledAgents(
    installed.app?.appAgents as Parameters<typeof readableInstalledAgents>[0],
  );
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
export async function grantHolders(
  client: GraphQLClient,
  grants: Grant[],
): Promise<Record<string, Holder>> {
  const entries = new Map(
    grants.map((g) => [`${g.holderKind}:${g.holderId}`, g]),
  );
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
          const r = await client.request<
            Record<string, (Holder & { handle?: string | null }) | null>
          >(
            {
              USER: HOLDER_USER,
              WORKER: HOLDER_WORKER,
              AGENT: HOLDER_AGENT,
              APP: HOLDER_APP,
            }[g.holderKind],
            { ref: g.holderId },
          );
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
