import { error, fail, isHttpError } from "@sveltejs/kit";
import { gqlClient } from "$lib/server/api";
import { extractGqlErrorCode } from "$lib/server/gqlError";
import { deploymentOffersSigning } from "$lib/server/signing-capability";
import { loadNodeMemories } from "$lib/server/node-memories";
import {
  CREATE_GRANT,
  REVOKE_GRANT,
  GRANTS_PAGE,
  grantChoices,
  grantHolders,
  grantNodes,
  requireGrantManager,
} from "$lib/server/app-grants";
import {
  grantActions,
  grantError,
  GRANT_REASON_MAX,
  grantReasonLimitMessage,
  type Grant,
  type GrantAction,
} from "$lib/grants/types";
import { t } from "$lib/i18n/t";
import type { Actions, PageServerLoad } from "./$types";
const offsetOf = (url: URL) => {
  const raw = url.searchParams.get("offset") ?? "0";
  const n = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(n) && n <= 2147483647
    ? n
    : 0;
};
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const offset = offsetOf(url);
  try {
    const client = gqlClient(locals.token);
    const app = await requireGrantManager(client, params.appId);
    const signing =
      !locals.impersonation && (await deploymentOffersSigning(locals.token));
    const memories = signing
      ? loadNodeMemories(client, "app-grants")
      : Promise.resolve({ kind: "ok" as const, value: [] });
    const [{ appGrants }, choices] = await Promise.all([
      client.request<{ appGrants: { items: Grant[]; total: number } }>(
        GRANTS_PAGE,
        { appRef: app.id, limit: 20, offset },
      ),
      signing
        ? grantChoices(client, app.id).then(
            (v) => ({ ...v, failed: false }),
            () => ({ workers: [], agents: [], failed: true }),
          )
        : Promise.resolve({ workers: [], agents: [], failed: false }),
    ]);
    const [holders, nodes] = await Promise.all([
      grantHolders(client, appGrants.items),
      grantNodes(client, appGrants.items),
    ]);
    return {
      routeRef: params.appId,
      app,
      signing,
      grants: appGrants,
      holders,
      nodes,
      choices,
      memories,
      offset,
    };
  } catch (e) {
    if (isHttpError(e)) throw e;
    throw error(
      extractGqlErrorCode(e) === "GRANT_NOT_MANAGER" ? 403 : 503,
      grantError(extractGqlErrorCode(e)),
    );
  }
};
async function manage(event: Parameters<NonNullable<Actions[string]>>[0]) {
  if (event.locals.impersonation)
    throw error(403, grantError("GRANT_NOT_MANAGER"));
  return requireGrantManager(gqlClient(event.locals.token), event.params.appId);
}
function refused(e: unknown) {
  return fail(isHttpError(e) ? e.status : 400, {
    error: isHttpError(e)
      ? grantError(e.status === 403 ? "GRANT_NOT_MANAGER" : null)
      : grantError(extractGqlErrorCode(e)),
  });
}
export const actions: Actions = {
  revoke: async (event) => {
    try {
      const app = await manage(event);
      const fd = await event.request.formData();
      const ref = String(fd.get("ref") ?? "");
      if (!ref) return fail(400, { error: grantError("GRANT_NOT_FOUND") });
      const client = gqlClient(event.locals.token);
      const page = await client.request<{ appGrants: { items: Grant[] } }>(
        GRANTS_PAGE,
        { appRef: app.id, limit: 20, offset: offsetOf(event.url) },
      );
      const previous = page.appGrants.items.find((g) => g.id === ref);
      if (!previous)
        return fail(409, {
          error: t(
            "grants.row-moved",
            "This grant is not on the current page. Refresh before trying again.",
          ),
        });
      const { revokeGrant } = await client.request<{ revokeGrant: Grant }>(
        REVOKE_GRANT,
        { ref },
      );
      // Present the exact returned row, even when revocation was already stamped.
      return {
        grant: revokeGrant,
        appId: app.id,
        operation: "revoke" as const,
        alreadyRevoked: previous.revokedAt !== null,
      };
    } catch (e) {
      return refused(e);
    }
  },
  create: async (event) => {
    const bad = (status: number, error: string) =>
      fail(status, {
        error,
        operation: "create" as const,
        appId: event.params.appId,
      });
    try {
      const app = await manage(event);
      if (!(await deploymentOffersSigning(event.locals.token)))
        return bad(
          403,
          t(
            "grants.signing.off",
            "Creating a grant is unavailable on this deployment.",
          ),
        );
      const fd = await event.request.formData();
      const text = (key: string) => String(fd.get(key) ?? "").trim();
      const holder = text("holder"),
        action = text("action") as GrantAction,
        nodeId = text("nodeId"),
        reason = text("reason");
      const choices = await grantChoices(gqlClient(event.locals.token), app.id);
      const allowed = [
        ...choices.workers.map((w) => `WORKER:${w.id}`),
        ...choices.agents.map((a) => `AGENT:${a.id}`),
      ];
      if (!allowed.includes(holder))
        return bad(400, grantError("GRANT_HOLDER_NOT_ALLOWED"));
      if (!Object.hasOwn(grantActions, action))
        return bad(400, grantError("GRANT_ACTION_UNKNOWN"));
      if (
        !nodeId ||
        nodeId.includes(":") ||
        nodeId === "*" ||
        nodeId.includes(",") ||
        /[\s]/.test(nodeId)
      )
        return bad(400, grantError("GRANT_VALUES_INVALID"));
      const starts = text("startsAt"),
        expires = text("expiresAt"),
        uses = text("maxUses");
      const utc = (raw: string) => {
        if (!raw) return null;
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw))
          return null;
        const date = new Date(`${raw}Z`);
        return Number.isFinite(date.getTime()) &&
          date.toISOString().slice(0, raw.length) === raw
          ? date
          : null;
      };
      const startDate = utc(starts),
        expiryDate = utc(expires);
      if ([...reason].length > GRANT_REASON_MAX)
        return bad(400, grantReasonLimitMessage());
      if (
        !reason ||
        (starts && !startDate) ||
        (expires && !expiryDate) ||
        (startDate && expiryDate && expiryDate <= startDate) ||
        (uses &&
          (!/^\d+$/.test(uses) ||
            Number(uses) < 1 ||
            Number(uses) > 2147483647))
      )
        return bad(400, grantError("GRANT_TERMS_INVALID"));
      const colon = holder.indexOf(":");
      const input = {
        appRef: app.id,
        holderKind: holder.slice(0, colon),
        holderRef: holder.slice(colon + 1),
        action,
        values: { [grantActions[action]]: nodeId },
        reason,
        ...(startDate ? { startsAt: startDate.toISOString() } : {}),
        ...(expiryDate ? { expiresAt: expiryDate.toISOString() } : {}),
        ...(uses ? { maxUses: Number(uses) } : {}),
      };
      const { createGrant } = await gqlClient(event.locals.token).request<{
        createGrant: Grant;
      }>(CREATE_GRANT, { input });
      return {
        grant: createGrant,
        appId: app.id,
        operation: "create" as const,
      };
    } catch (e) {
      return bad(
        isHttpError(e) ? e.status : 400,
        isHttpError(e)
          ? grantError(e.status === 403 ? "GRANT_NOT_MANAGER" : null)
          : grantError(extractGqlErrorCode(e)),
      );
    }
  },
};
