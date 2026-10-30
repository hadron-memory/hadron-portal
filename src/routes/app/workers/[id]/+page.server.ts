import { error, fail } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { t } from '$lib/i18n/t';
import { SET_WORKER_BOOT_PROMPT_MUTATION, TEAM_WORK_ITEMS_QUERY, UPDATE_WORKER_SIGNATURE_MUTATION, WORKER_BOOT_POINTER_QUERY, WORKER_QUERY, WORKER_SESSIONS_QUERY } from '$lib/server/queries';
import { pointerAction, readPointer, selfCanManage } from '$lib/server/boot-prompt-pointer';
import type { TeamWorkItem, Worker, WorkerSession } from '$lib/types';
import { APPLY_AGENT_TICKER_TEMPLATES_MUTATION, loadAppTickerSettings, loadWakeSettings } from '$lib/server/tickers';
import { applyRefusal } from '$lib/tickers/apply';
import type { Actions, PageServerLoad } from './$types';
import { updateSignatureFormId, updateSignatureSchema } from './schema';

const updateSignatureAdapter = zod4(updateSignatureSchema);

/** What `applyAgentTickerTemplates` selects (see APPLY_AGENT_TICKER_TEMPLATES_MUTATION). */
interface ApplyAgentTickerTemplatesResponse {
  created: Array<{ effectiveCadenceSeconds: number; template: { id: string; name: string }; ticker: { id: string; name: string; urn: string | null } }>;
  alreadyPresent: Array<{ id: string; name: string }>;
}

/**
 * #758 — the worker page's tab ids. These are ADDRESSES, not labels: they are
 * the `?tab=` values a shared link carries, and #761 made those survive the
 * `/app/u/<worker-urn>` resolver, which is the link every worker signs its
 * outward-facing work with. Rename a label freely; never rename one of these
 * (hrn:node:hadronmemory.com:hadron-portal:review:label-rename-is-not-an-id-rename).
 *
 * Validated in the LOADER rather than the component, mirroring the App page, so
 * URL parsing lives in one place and an unknown value falls back to the default
 * instead of rendering a page where no panel matches.
 */
const WORKER_TAB_IDS: readonly string[] = ['profile', 'briefing', 'sessions', 'worklog', 'wake'];

/**
 * #1010 — the Briefing tab's view mode, validated here for the same reason
 * `?tab=` is: URL parsing lives in one place, and an unknown value falls back
 * rather than reaching the component.
 *
 * It exists at all because a purely client-side toggle left the override
 * editor unreachable with JavaScript off (@codex on #857) — which also made
 * this page's non-enhanced POST handling unreachable. Addressable also means
 * a Source view can be linked to.
 */
const WORKER_VIEW_IDS: readonly string[] = ['rendered', 'source'];

/** Worker sessions shown before "…and N more". */
const SESSION_PAGE_SIZE = 20;
/** Worklog rows fetched; `total` tells the reader how many exist beyond them. */
const WORKLOG_PAGE_SIZE = 50;

/**
 * The worker page (#735) — the canonical destination for a `hrn:worker:` URN.
 *
 * It exists because hadron-server#1008 has every worker sign outward-facing
 * artifacts with a clickable URN so a reader "can see who you are rather than
 * guessing whether a human wrote it". That reader is arriving from a GitHub
 * issue asking *who is this*, and until now they landed on a 404 — the portal
 * resolved no `worker` kind even though the server has since #991.
 *
 * Deliberately a page rather than a redirect to the App's Staff tab: a roster
 * answers "which team", not "who is this". #737 grows this page with the
 * worker's sessions and worklog, which is the other half of that question.
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const rawTab = url.searchParams.get('tab');
  const initialTab = WORKER_TAB_IDS.includes(rawTab ?? '') ? rawTab : null;
  const rawView = url.searchParams.get('view');
  const initialView = WORKER_VIEW_IDS.includes(rawView ?? '') ? rawView : null;
  let worker: Worker | null;
  try {
    ({ worker } = await gqlClient(locals.token).request<{ worker: Worker | null }>(WORKER_QUERY, {
      ref: params.id,
    }));
  } catch (err) {
    // The worker read is gated server-side (`requireWorkerReadAccess`), and for
    // the NAME form a denial is deliberately reported as WORKER_NOT_FOUND so
    // the roster is not an existence oracle. Mirror that here: a refusal and a
    // miss both surface as the same 404, and only KNOWN codes are mapped —
    // anything else rethrows so an outage stays a distinguishable 500
    // (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only, hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch).
    if (err instanceof ClientError && err.response?.errors?.length) {
      const code = (err.response.errors[0].extensions as { code?: string } | undefined)?.code;
      if (code === 'WORKER_NOT_FOUND' || code === 'NOT_FOUND' || code === 'FORBIDDEN') {
        throw error(404, 'No worker found here, or you do not have access to it.');
      }
    }
    throw err;
  }

  if (!worker) {
    throw error(404, 'No worker found here, or you do not have access to it.');
  }

  // #737 — the two sections that answer "what have they actually done".
  //
  // Each fetch fails INDEPENDENTLY and reports null rather than []. The issue is
  // explicit about why: "a section the viewer cannot read should surface as
  // unavailable, not silently render as empty. An empty worklog and a hidden
  // worklog must not look the same." Collapsing a refusal or an outage into an
  // empty array is the portal telling the reader this worker has done nothing.
  //
  // They are also independent of each other and of the identity block above: a
  // worklog outage must not blank the sessions list, and neither may 404 a page
  // whose identity half loaded fine.
  const client = gqlClient(locals.token);
  const [sessions, worklog] = await Promise.all([
    client
      // limit+1: `sessions` has no `total`, so "is there more" is answered by
      // observing a short page, not by counting.
      .request<{ sessions: WorkerSession[] }>(WORKER_SESSIONS_QUERY, {
        workerRef: worker.id,
        limit: SESSION_PAGE_SIZE + 1,
      })
      .then((d) => d.sessions)
      .catch((e) => {
        console.warn(`[worker-page] worker-sessions fetch failed for ${params.id}:`, e);
        return null;
      }),
    // teamWorkItems REQUIRES an appRef, and `worker.app` runs its own read gate
    // and masks to null on deny (#552). So a masked App is not an outage and
    // not an empty worklog — it is a section we cannot even ask for, and it
    // reports as unavailable rather than as "no records".
    worker.app?.id
      ? client
          .request<{ teamWorkItems: { items: TeamWorkItem[]; total: number } }>(
            TEAM_WORK_ITEMS_QUERY,
            { appRef: worker.app.id, workerRef: worker.id, limit: WORKLOG_PAGE_SIZE },
          )
          .then((d) => d.teamWorkItems)
          .catch((e) => {
            console.warn(`[worker-page] worklog fetch failed for ${params.id}:`, e);
            return null;
          })
      : Promise.resolve(null),
  ]);

  const sessionsTruncated = !!sessions && sessions.length > SESSION_PAGE_SIZE;

  // portal#1099 — the Wake-ups tab (Tickers S7a, read-only). Each read is
  // classified on its own (ok / not-participant / failed) and never throws, so
  // neither can blank the rest of the page. The App's settings only supply the
  // wake-rate floor line; without a readable App there is nothing to ask.
  const [wake, wakeAppSettings, bootPointer, canManageWorkerApp] = await Promise.all([
    loadWakeSettings(client, worker.id),
    worker.app?.id ? loadAppTickerSettings(client, worker.app.id) : Promise.resolve(null),
    // portal#1142 S8: the worker's boot-prompt pointer, and whether to offer
    // its form. The setter belongs to the worker's APP manager (R23): holding
    // the worker grants nothing, so nothing here reads who holds it.
    readPointer(
      () => client.request<{ worker: { bootPromptRef: string | null; bootPromptTargetDeleted: boolean | null } | null }>(WORKER_BOOT_POINTER_QUERY, { ref: worker.id }),
      (r) => r.worker,
      `worker ${worker.id}`,
    ),
    selfCanManage(client, locals.user?.id, worker.app?.urn),
  ]);

  // portal#1142 P4: seeded with the stored templates and, as bases, the same
  // values, so a save sends only what the reader changed. A masked (null) field
  // seeds as '': the page shows it as "not shown" (it reads worker.signature,
  // not this form) and posts nothing for it.
  // portal#1448: the id is per worker — see updateSignatureFormId.
  const signatureForm = await superValidate(
    {
      signature: worker.signature ?? '',
      trailer: worker.trailer ?? '',
      signatureBase: worker.signature ?? '',
      trailerBase: worker.trailer ?? '',
    },
    updateSignatureAdapter,
    { errors: false, id: updateSignatureFormId(params.id) },
  );

  return {
    worker,

    signatureForm,
    initialTab,
    initialView,
    workerSessions: sessions ? sessions.slice(0, SESSION_PAGE_SIZE) : null,
    sessionsTruncated,
    worklog: worklog?.items ?? null,
    worklogTotal: worklog?.total ?? 0,
    wake,
    wakeAppSettings,
    wakeLoadedAt: new Date().toISOString(),
    bootPointer,
    canManageWorkerApp,
    // The key a pointer result carries (the action's own params.id).
    bootPointerKey: params.id,
  };
};

export const actions: Actions = {
  // portal#1142 S8 (hadron-server#2219): set or clear the worker's pointer.
  // The worker's App manager, as themselves; the server decides.
  setBootPrompt: async ({ request, params, locals }) =>
    pointerAction(await request.formData(), 'app', params.id, (nodeRef) =>
      gqlClient(locals.token).request(SET_WORKER_BOOT_PROMPT_MUTATION, { workerRef: params.id, nodeRef })),

  /**
   * portal#1462 (hadron-server#2860) — apply the Agent's ticker templates to
   * THIS worker. The worker is the route's, never a posted field, and the
   * caller is whoever is signed in: the server decides who may. A refusal comes
   * back keyed to this worker and local to the Wake-ups tab; a call that fails
   * without a recognised refusal is outcome-unknown, and is never retried.
   */
  applyTickerTemplates: async ({ params, locals }) => {
    try {
      const r = await gqlClient(locals.token).request<{ applyAgentTickerTemplates: ApplyAgentTickerTemplatesResponse }>(APPLY_AGENT_TICKER_TEMPLATES_MUTATION, { workerRef: params.id });
      return {
        applyTickers: {
          key: params.id,
          ok: true as const,
          created: r.applyAgentTickerTemplates.created.map((c) => ({
            tickerId: c.ticker.id,
            tickerName: c.ticker.name,
            tickerUrn: c.ticker.urn ?? null,
            templateId: c.template.id,
            templateName: c.template.name,
            effectiveCadenceSeconds: c.effectiveCadenceSeconds,
          })),
          alreadyPresent: r.applyAgentTickerTemplates.alreadyPresent.map((a) => ({ id: a.id, name: a.name })),
        },
      };
    } catch (e: unknown) {
      const { status, ...refusal } = applyRefusal(extractGqlErrorCode(e));
      if (refusal.outcomeUnknown) console.warn(`[worker-page] apply tickers for ${params.id} failed:`, e);
      return fail(status, { applyTickers: { key: params.id, refusal } });
    }
  },

  /**
   * portal#1142 P4 (hadron-server#1602 / #2120) — save the signature and/or
   * trailer TEMPLATE. Only a field the page showed AND the reader changed is
   * sent: an unchanged one is omitted (the server preserves it), a masked one
   * was never posted, and nothing is ever sent as null (the server refuses it).
   * An emptied template goes as text: it stores '' and delivers nothing.
   *
   * Refusals are the server's to make. FORBIDDEN gets a fixed line that gives
   * no reason: who may write is the server's rule (H26 is provisional), and the
   * portal does not restate it. BAD_USER_INPUT and WORKER_RETIRED carry their
   * reason, so their message is shown whole. Every path returns the posted
   * form, so the draft stays on screen.
   */
  updateSignature: async ({ request, params, locals }) => {
    const posted = await request.formData();
    // portal#1448/#1450 — the reply carries the id the POST carried when it
    // had one (superValidate echoes a posted __superform_id over this options
    // id, so an enhanced submission's reply returns to the mount that sent
    // it — see signature-instance-id.ts) and otherwise the loader's per-worker
    // stamp (a no-JS POST, whose reply the server render matches the same
    // way; see updateSignatureFormId).
    const form = await superValidate(posted, updateSignatureAdapter, { id: updateSignatureFormId(params.id) });
    if (!form.valid) return fail(400, { form });

    // Gene's blind P2 on #1157: clear intent comes from what was POSTED, never
    // from the schema's '' default. A template counts only when it and its base
    // were both posted; an omitted one (or one without a base) is left alone.
    const sent = (field: 'signature' | 'trailer') => posted.has(field) && posted.has(`${field}Base`);
    const vars: { workerRef: string; signature?: string; trailer?: string } = { workerRef: params.id };
    if (sent('signature') && form.data.signature !== form.data.signatureBase) vars.signature = form.data.signature;
    if (sent('trailer') && form.data.trailer !== form.data.trailerBase) vars.trailer = form.data.trailer;
    if (!('signature' in vars) && !('trailer' in vars)) return { form };

    try {
      await gqlClient(locals.token).request(UPDATE_WORKER_SIGNATURE_MUTATION, vars);
      return message(form, {
        type: 'success',
        text: t('worker.signature.saved', 'Saved. It applies from this worker’s next bind.'),
      });
    } catch (e: unknown) {
      const code = extractGqlErrorCode(e);
      if (code === 'FORBIDDEN') {
        return message(
          form,
          { type: 'error', text: t('worker.signature.error.forbidden', "You can't change this worker's signature or trailer.") },
          { status: 403 },
        );
      }
      if (code === 'BAD_USER_INPUT' || code === 'WORKER_RETIRED') {
        return message(form, { type: 'error', text: extractGqlError(e, '', ["BAD_USER_INPUT","WORKER_RETIRED"]) }, { status: 400 });
      }
      return message(
        form,
        { type: 'error', text: t('worker.signature.error.failed', "The signature and trailer couldn't be saved.") },
        { status: 500 },
      );
    }
  },

};
