/**
 * portal#2205 — the delete-worker contract, shared by the App roster's staff
 * tab and the worker's own page. Lives in $lib so neither route imports the
 * other's server module; the dialog (src/lib/components/WorkerDeleteDialog.svelte)
 * reads the result type, both page actions validate with the schema, and the
 * attestation token is the same literal in every slot.
 *
 * The guards below are here for the same reason: two pages run the SAME
 * consent and refusal machinery against the same mutation, and a refusal-code
 * or redaction fix applied to one action silently missing the other is exactly
 * the drift this module exists to prevent. Every helper is pure (no kit, no
 * fetch); each action wraps what it returns in its own fail()/redirect().
 */
import { z } from 'zod';
import { extractGqlErrorCode, isDefiniteRefusal } from '$lib/gql-error';
import { t } from '$lib/i18n/t';

/** Requester attestation token, never a claim of server eligibility. */
export const WORKER_DELETE_CONFIRMATION = 'verified-no-external-attribution';
export interface DeleteWorkerResult {
  ok: boolean;
  workerRef: string;
  message: string;
  code?: string | null;
  /**
   * portal#2227 — the outcome is UNKNOWN, not failed: the delete is one-way,
   * so a lost response or an unrecognized error can come after the server
   * committed. A dialog reading this must not offer a plain retry (the
   * sentence says reload-first) — retire's `retireResult.uncertain` is the
   * shape this copies.
   */
  uncertain?: true;
}
export const deleteWorkerSchema = z.object({
  _kind: z.literal('deleteWorker'),
  workerRef: z.string().trim().min(1, 'Worker is required.'),
  confirmation: z.literal(WORKER_DELETE_CONFIRMATION),
});

/** A refusal ready for an action to wrap in `fail()`; the shape both pages return. */
export interface DeleteWorkerRefusal {
  status: number;
  result: DeleteWorkerResult;
}

const confirmRequired = () => t('app.staff.delete.confirm-required', 'Explicit external-artifact verification is required.');

/**
 * The pre-mutation consent guards both delete actions run on the posted form:
 * each guarded field appears exactly once, and the user ticked the
 * external-attribution attestation THEMSELVES (the literal token — never
 * defaulted, never manufactured). On success returns the posted workerRef,
 * which the roster's mutation names; the worker page names its route's worker
 * instead and only shape-checks this one.
 */
export function readDeleteWorkerPost(posted: FormData): { ok: true; workerRef: string } | { ok: false; refusal: DeleteWorkerRefusal } {
  const workerRef = typeof posted.get('workerRef') === 'string' ? String(posted.get('workerRef')) : '';
  const refuse = (message: string): DeleteWorkerRefusal => ({
    status: 400,
    result: { ok: false, workerRef, message, code: null },
  });
  if (['_kind', 'workerRef', 'confirmation'].some((key) => posted.getAll(key).length !== 1)) {
    return { ok: false, refusal: refuse(confirmRequired()) };
  }
  const parsed = deleteWorkerSchema.safeParse(Object.fromEntries(posted));
  if (!parsed.success) return { ok: false, refusal: refuse(confirmRequired()) };
  return { ok: true, workerRef: parsed.data.workerRef };
}

/** Per-page sentences for `deleteWorkerFailureRefusal`; omit a sentence to keep the server's. */
export interface DeleteWorkerFailureSentences {
  /**
   * WORKER_IN_USE. The worker page answers with the fixed "retire it instead"
   * sentence — the reference census is private by law
   * (hrn:node:hadronmemory.com:specs:cor:dmo:050:11; FIT point 2 on #2205) —
   * while the roster keeps the server sentence. Optional.
   */
  inUse?: string;
  /**
   * FORBIDDEN. The worker page answers with the staffing sentence (the same
   * gate as retire: one menu, one voice); the roster keeps the server
   * sentence. Optional.
   */
  forbidden?: string;
  /** Non-refusal fallback when no server sentence is fit to show. Required. */
  failed: string;
  /**
   * portal#2227 — the UNKNOWN-OUTCOME sentence (transport loss or an
   * unrecognized error; the delete may have committed). Optional; the shared
   * default is retire's reload-first family.
   */
  uncertain?: string;
}

/**
 * The shared refusal mapping for a failed deleteWorker mutation. Only
 * GraphQL's own refusal sentence, never the request/extension census or a
 * transport exception carrying query variables, reaches the UI: an error
 * without a fit refusal message gets `failed`, so nothing raw leaks.
 */
export function deleteWorkerFailureRefusal(e: unknown, workerRef: string, sentences: DeleteWorkerFailureSentences): DeleteWorkerRefusal {
  // portal#2227 — an error that is not provably a pre-commit refusal (a lost
  // response, a codeless or unrecognized GraphQL error) is an UNKNOWN OUTCOME
  // on a one-way delete: the server may have committed before the answer was
  // lost, so never "failed" — 502 + uncertain, reload-first sentence. Retire
  // (this page's retireWorker and the roster's) is the convention this adopts;
  // the actions, not this pure mapper, log the closed transport record
  // (ruling 0247).
  if (!isDefiniteRefusal(e, ['FORBIDDEN', 'WORKER_NOT_FOUND', 'WORKER_IN_USE', 'WORKER_EXTERNAL_ATTRIBUTION_UNCONFIRMED'])) {
    return {
      status: 502,
      result: {
        ok: false, workerRef, uncertain: true, code: null,
        message: sentences.uncertain ?? t('app.staff.delete.uncertain', 'The delete may have succeeded. Reload to see the current state.'),
      },
    };
  }
  const code = extractGqlErrorCode(e);
  // Only GraphQL's own errors array is a fit server sentence, and only for
  // refusals (status < 500); anything else may embed transport details.
  const errors = (e as { response?: { errors?: { message?: string }[] } } | null)?.response?.errors;
  const serverSentence = typeof errors?.[0]?.message === 'string' ? errors[0].message : null;
  const status = code === 'FORBIDDEN' ? 403
    : code === 'WORKER_NOT_FOUND' ? 404
    : code === 'WORKER_IN_USE' || code === 'WORKER_EXTERNAL_ATTRIBUTION_UNCONFIRMED' ? 400 : 500;
  const message = code === 'WORKER_IN_USE' && sentences.inUse !== undefined
    ? sentences.inUse
    : code === 'FORBIDDEN' && sentences.forbidden !== undefined
      ? sentences.forbidden
      : status < 500 && serverSentence !== null
        ? serverSentence
        : sentences.failed;
  return { status, result: { ok: false, workerRef, message, code } };
}
