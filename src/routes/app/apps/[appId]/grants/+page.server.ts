import { readGrantActions } from "$lib/server/grant-actions";
import { grantableAction } from "$lib/grants/actions";
import { error, fail, isHttpError, isRedirect, redirect } from "@sveltejs/kit";
import { ClientError } from "graphql-request";
import { gqlClient } from "$lib/server/api";
import { classifyGqlError, extractGqlErrorCode } from "$lib/server/gqlError";
import { deploymentOffersSigning } from "$lib/server/signing-capability";
import { loadNodeMemories } from "$lib/server/node-memories";
import {
  CREATE_GRANT,
  REVOKE_GRANT,
  REQUEST_GRANT_SIGNATURE,
  GRANTS_PAGE,
  grantChoices,
  grantOffset,
  readGrantPage,
  requireGrantManager,
} from "$lib/server/app-grants";
import {
  grantError,
  GRANT_REASON_MAX,
  grantReasonLimitMessage,
  type Grant,
} from "$lib/grants/types";
import { t } from "$lib/i18n/t";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const offset = grantOffset(url);
  try {
    const client = gqlClient(locals.token);
    const app = await requireGrantManager(client, params.appId);
    const signing =
      !locals.impersonation && (await deploymentOffersSigning(locals.token));
    const memories = signing
      ? loadNodeMemories(client, "app-grants")
      : Promise.resolve({ kind: "ok" as const, value: [] });
    const [page, choices] = await Promise.all([
      readGrantPage(client, app.id, offset),
      signing
        ? grantChoices(client, app.id).then(
            (v) => ({ ...v, failed: false }),
            () => ({ workers: [], agents: [], failed: true }),
          )
        : Promise.resolve({ workers: [], agents: [], failed: false }),
    ]);
    return {
      routeRef: params.appId,
      app,
      signing,
      impersonating: !!locals.impersonation,
      ...page,
      viewerId: locals.user?.id ?? null,
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
  approve: async (event) => {
    if (!event.locals.token || !event.locals.user?.id) redirect(303, "/signin");
    let appId = event.params.appId;
    const refused = (status: number, message: string) =>
      fail(status, { error: message, operation: "approve" as const, appId });
    try {
      const app = await manage(event);
      appId = app.id;
      if (!(await deploymentOffersSigning(event.locals.token)))
        return refused(
          403,
          t(
            "grants.approve.unavailable",
            "Approval is unavailable on this deployment.",
          ),
        );
      const ref = String((await event.request.formData()).get("ref") ?? "");
      if (!ref) return refused(400, grantError("GRANT_NOT_FOUND"));
      const client = gqlClient(event.locals.token);
      const page = await client.request<{
        appGrants: { items: Grant[]; total: number };
      }>(GRANTS_PAGE, {
        appRef: app.id,
        limit: 20,
        offset: grantOffset(event.url),
      });
      if (!page.appGrants.items.some((g) => g.id === ref && g.appId === app.id))
        return refused(
          409,
          t(
            "grants.row-moved",
            "This grant is not on the current page. Refresh before trying again.",
          ),
        );
      // Only the server judges pending/expiry and whether terms are representable.
      const result = await client.request<{
        requestGrantSignature: { ceremonyUrl: string };
      }>(REQUEST_GRANT_SIGNATURE, { grantRef: ref });
      if (
        typeof result.requestGrantSignature?.ceremonyUrl !== "string" ||
        !result.requestGrantSignature.ceremonyUrl
      )
        return refused(503, grantError(null));
      redirect(303, result.requestGrantSignature.ceremonyUrl);
    } catch (e) {
      // Kit redirects are control flow, not failures to redact.
      if (isRedirect(e)) throw e;
      const code = extractGqlErrorCode(e);
      if (
        e instanceof ClientError &&
        [
          "GRANT_NOT_PENDING",
          "GRANT_EXPIRED",
          "GRANT_TERMS_UNREPRESENTABLE",
          "FORBIDDEN",
        ].includes(code ?? "")
      ) {
        const entry = e.response.errors?.find(
          (r) => r.extensions?.code === code,
        );
        if (typeof entry?.message === "string")
          return refused(400, entry.message);
      }
      return refused(
        isHttpError(e) ? e.status : 503,
        grantError(
          isHttpError(e) && e.status === 403 ? "GRANT_NOT_MANAGER" : null,
        ),
      );
    }
  },
  revoke: async (event) => {
    try {
      const app = await manage(event);
      const fd = await event.request.formData();
      const ref = String(fd.get("ref") ?? "");
      if (!ref) return fail(400, { error: grantError("GRANT_NOT_FOUND") });
      const client = gqlClient(event.locals.token);
      const page = await client.request<{ appGrants: { items: Grant[] } }>(
        GRANTS_PAGE,
        { appRef: app.id, limit: 20, offset: grantOffset(event.url) },
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
        action = text("action"),
        reason = text("reason");
      let choices: Awaited<ReturnType<typeof grantChoices>>;
      try {
        choices = await grantChoices(gqlClient(event.locals.token), app.id);
      } catch (e) {
        // 503 only for an outage (transport, INTERNAL_SERVER_ERROR, or the
        // read's own withheld-list 503). A typed refusal keeps its mapping.
        const outage = isHttpError(e)
          ? e.status === 503
          : ["transport", "internal"].includes(classifyGqlError(e).kind);
        if (!outage) throw e;
        return bad(
          503,
          t(
            "grants.choices.unavailable-create",
            "The holder choices could not be loaded. Try again.",
          ),
        );
      }
      const allowed = [
        ...choices.workers.map((w) => `WORKER:${w.id}`),
        ...choices.agents.map((a) => `AGENT:${a.id}`),
      ];
      if (!allowed.includes(holder))
        return bad(400, grantError("GRANT_HOLDER_NOT_ALLOWED"));
      const definitions = await readGrantActions(gqlClient(event.locals.token), app.id);
      const definition = definitions.find((a) => a.name === action);
      if (!definition || !grantableAction(definition))
        return bad(400, grantError("GRANT_ACTION_UNKNOWN"));
      const values = Object.fromEntries(definition.parameters.map((p) => [p.name, text("parameter:" + p.name)]));
      if (Object.values(values).some((id) => !id || id.includes(":") || id === "*" || /[\s,]/.test(id)))
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
        values,
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
