import {
  grantHolderKey,
  grantNodeRef,
  type Grant,
  type Holder,
  type GrantListPayload,
} from "$lib/grants/types";
export type GrantReadScope = {
  appId: string;
  viewerId: string;
  routeRef: string;
  offset: number;
};
export const GRANT_READ_TIMEOUT_MS = 10_000;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const nullableText = (v: unknown) => v === null || text(v);
const nullableInt = (v: unknown) => v === null || Number.isSafeInteger(v);
function holder(raw: unknown): Holder | null {
  if (
    !object(raw) ||
    !text(raw.id) ||
    !text(raw.name) ||
    !(raw.urn === undefined || nullableText(raw.urn))
  )
    return null;
  return {
    id: raw.id,
    name: raw.name,
    ...(raw.urn === undefined ? {} : { urn: raw.urn as string | null }),
  };
}
export function parseGrantList(
  raw: unknown,
  scope: GrantReadScope,
): GrantListPayload | null {
  if (
    !object(raw) ||
    raw.appId !== scope.appId ||
    raw.viewerId !== scope.viewerId ||
    raw.offset !== scope.offset ||
    !object(raw.grants) ||
    !object(raw.holders) ||
    !object(raw.nodes)
  )
    return null;
  if (
    !Array.isArray(raw.grants.items) ||
    raw.grants.items.length > 20 ||
    !Number.isSafeInteger(raw.grants.total) ||
    (raw.grants.total as number) < 0
  )
    return null;
  const items: Grant[] = [];
  const holders: Record<string, Holder> = Object.create(null);
  const nodes: Record<string, Holder | null> = Object.create(null);
  const ids = new Set<string>();
  for (const g of raw.grants.items) {
    if (
      !object(g) ||
      !["id", "appId", "action", "holderId", "reason", "createdAt"].every((k) =>
        text(g[k]),
      ) ||
      !g.id ||
      g.appId !== scope.appId ||
      !["USER", "WORKER", "AGENT", "APP"].includes(String(g.holderKind)) ||
      ![
        "startsAt",
        "expiresAt",
        "activatedAt",
        "revokedAt",
        "holderDepartedAt",
      ].every((k) => nullableText(g[k])) ||
      !nullableInt(g.maxUses) ||
      !Number.isSafeInteger(g.useCount) ||
      typeof g.allows !== "boolean" ||
      !Object.hasOwn(g, "values") ||
      g.values === undefined ||
      ids.has(g.id as string)
    )
      return null;
    const grant = g as unknown as Grant;
    ids.add(grant.id);
    const key = grantHolderKey(grant);
    const h = holder(raw.holders[key]);
    if (!h) return null;
    holders[key] = h;
    const ref = grantNodeRef(grant);
    if (ref) {
      if (!Object.hasOwn(raw.nodes, ref)) return null;
      const n = raw.nodes[ref] === null ? null : holder(raw.nodes[ref]);
      if (raw.nodes[ref] !== null && !n) return null;
      nodes[ref] = n;
    }
    items.push(grant);
  }
  // Count and rows are separate server reads: a concurrent change may make the
  // reported total lag the rows. Do not turn that legal payload into absence.
  return {
    appId: scope.appId,
    viewerId: scope.viewerId,
    offset: scope.offset,
    grants: { items, total: raw.grants.total as number },
    holders,
    nodes,
  };
}
/** Never rejects. Timeout/abort cover both fetch and JSON parsing. */
export async function readGrantList(
  scope: GrantReadScope,
  signal?: AbortSignal,
): Promise<GrantListPayload | null> {
  if (signal?.aborted) return null;
  const controller = new AbortController();
  let cancel!: () => void;
  const failure = new Promise<null>((resolve) => {
    cancel = () => {
      controller.abort();
      resolve(null);
    };
  });
  const timer = setTimeout(cancel, GRANT_READ_TIMEOUT_MS);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await Promise.race([
      failure,
      (async () => {
        try {
          const response = await fetch(
            `/app/apps/${encodeURIComponent(scope.routeRef)}/grants/list?offset=${scope.offset}`,
            {
              headers: { accept: "application/json" },
              credentials: "same-origin",
              cache: "no-store",
              signal: controller.signal,
            },
          );
          if (!response.ok) return null;
          const body = await response.json();
          return controller.signal.aborted ? null : parseGrantList(body, scope);
        } catch {
          return null;
        }
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    controller.abort();
  }
}
