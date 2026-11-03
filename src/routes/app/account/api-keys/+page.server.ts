/**
 * Spec 025-oauth-for-mcp US2 / T051 — /app/account/api-keys page server.
 *
 * Uses the user-key GraphQL operations shipped in hadron-server:
 *   - Query `myUserApiKeysPage` (portal#1615, every page followed) — list every active + revoked key the caller
 *     owns. Returned newest-first by the resolver (PR #145 D6).
 *   - Mutation `createUserApiKey(label)` — mint one. Returns the raw
 *     `hdr_user_<…>` token EXACTLY ONCE on the result; only the hash
 *     persists. Caller is responsible for surfacing it to the user
 *     immediately.
 *   - Mutation `revokeUserApiKey(id)` — flip `revokedAt`. Idempotent +
 *     race-safe; cross-user calls collapse to NOT_FOUND (no id-enumeration
 *     channel; see PR #145 review).
 *   - Mutation `setUserApiKeyHidden(id, hidden)` — reversible list visibility
 *     for a revoked own key; no deletion or token-validity change.
 *   - Mutation `deleteUserApiKey(id)` (portal#1011 P2, hadron-server#3298,
 *     hrn:node:hadronmemory.com:specs:cor:dmo:070:03) — delete an own live, revoked or hidden key. A live key
 *     is revoked first with its live subtree; the keys it minted stay, revoked,
 *     and only its direct children lose their parent. Returns one append-only
 *     record with no secret or hash.
 *
 * Route home note: tasks.md T050 / T051 specified `/app/api-keys/` as the
 * URL; we landed at `/app/account/api-keys/` instead because user-scoped
 * settings already nest under `/app/account/` (matches the portal's
 * existing IA). The page behavior is identical to what the spec describes;
 * only the URL differs.
 */

import { fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { apiKeysStrings as i18n } from '$lib/i18n/api-keys-strings';
import {
  MY_USER_API_KEYS_QUERY,
  CREATE_USER_API_KEY_MUTATION,
  REVOKE_USER_API_KEY_MUTATION,
  SET_USER_API_KEY_HIDDEN_MUTATION,
  DELETE_USER_API_KEY_MUTATION,
} from '$lib/server/queries';
import { readAllPages, type PageEnvelope } from '$lib/server/paged';
import type { UserApiKey, UserApiKeyCreateResult } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { createUserApiKeySchema, revokeUserApiKeySchema, keyVisibilitySchema, deleteUserApiKeySchema } from './schema';

const createUserApiKeyFormAdapter = zod4(createUserApiKeySchema);
const revokeUserApiKeyFormAdapter = zod4(revokeUserApiKeySchema);

export const load: PageServerLoad = async ({ locals, url }) => {
  const includeHidden = url?.searchParams.get('includeHidden') === 'true';
  // No-JS confirmation step for Delete: the row's <noscript> link asks for it.
  // Honoured only for a key in the list this load returned.
  const confirmDelete = url?.searchParams.get('confirmDelete') ?? null;
  const form = await superValidate({}, createUserApiKeyFormAdapter, { errors: false });
  const revokeForm = await superValidate({}, revokeUserApiKeyFormAdapter, { errors: false });
  // Auth gate: locals.token is set by the +layout.server.ts auth flow;
  // a missing token means the user isn't signed in (the layout should
  // already have redirected). If we somehow get here without one, show
  // an empty list rather than blow up — the page renders the "no keys"
  // empty state, and the actions below 401 cleanly.
  if (!locals.token) {
    return { keys: [] as UserApiKey[], includeHidden, deleteTarget: null, form, revokeForm };
  }
  try {
    const client = gqlClient(locals.token);
    // portal#1615: every page; one refused page is the page's load error.
    const keys = await readAllPages((limit, offset) =>
      client
        .request<{ myUserApiKeysPage: PageEnvelope<UserApiKey> }>(MY_USER_API_KEYS_QUERY, { includeHidden, limit, offset })
        .then((r) => r.myUserApiKeysPage),
    );
    const deleteTarget = confirmDelete && keys.some((k) => k.id === confirmDelete) ? confirmDelete : null;
    return { keys, includeHidden, deleteTarget, form, revokeForm };
  } catch (e) {
    // Same posture as other portal loaders: surface a friendly empty
    // state on transient failure rather than crashing the page. The
    // user can retry; nothing destructive happens.
    return {
      keys: [] as UserApiKey[],
      includeHidden,
      deleteTarget: null,
      form,
      revokeForm,
      loadError: extractGqlError(e, 'Could not load your API keys.'),
    };
  }
};

type DeletionNotice = { type: 'success' | 'error'; text: string; recover?: true };
const deletionFailure = (status: number, text: string, recover = false) =>
  fail(status, { deletion: (recover ? { type: 'error', text, recover: true } : { type: 'error', text }) as DeletionNotice });
// Refusals the server answers before any write: fixed copy, never its prose.
// Unknown and foreign ids are one NOT_FOUND, so they render identically.
const DELETION_REFUSALS: Record<string, [number, () => string]> = {
  NOT_FOUND: [404, i18n.deleteNotFound],
  FORBIDDEN: [403, i18n.deleteForbidden],
  UNAUTHENTICATED: [401, i18n.deleteSignedOut],
  SESSION_EXPIRED: [401, i18n.deleteSignedOut],
  BAD_USER_INPUT: [400, i18n.deleteInvalid],
};
const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export const actions: Actions = {
  /**
   * portal#1011 P2: delete one own key. Success is claimed only when the
   * returned record names the submitted key; anything else that is not a
   * classified refusal may or may not have committed, so it is UNCERTAIN and
   * the page offers a GET reload, never a replay.
   */
  delete: async ({ request, locals }) => {
    const values = await request.formData();
    if (!locals.token) return deletionFailure(401, i18n.notSignedIn());
    const parsed = deleteUserApiKeySchema.safeParse({ id: values.get('id') });
    if (!parsed.success) return deletionFailure(400, i18n.deleteInvalid());
    const { id } = parsed.data;
    let data: { deleteUserApiKey?: { keyId?: unknown; revokedKeyIds?: unknown; mintedKeyIds?: unknown } | null };
    try {
      data = await gqlClient(locals.token).request(DELETE_USER_API_KEY_MUTATION, { id });
    } catch (e) {
      const refusal = DELETION_REFUSALS[extractGqlErrorCode(e) ?? ''];
      if (refusal) return deletionFailure(refusal[0], refusal[1]());
      return deletionFailure(502, i18n.deleteUncertain(), true);
    }
    const rec = data?.deleteUserApiKey;
    if (!rec || rec.keyId !== id || !isIdList(rec.revokedKeyIds) || !isIdList(rec.mintedKeyIds)) {
      return deletionFailure(502, i18n.deleteUncertain(), true);
    }
    const text = rec.revokedKeyIds.length > 0 ? i18n.deleteSuccessLive() : i18n.deleteSuccessRevoked();
    return { deletion: { type: 'success', text } as DeletionNotice };
  },
  visibility: async ({ request, locals }) => {
    const values = await request.formData();
    const parsed = keyVisibilitySchema.safeParse({ id: values.get('id'), hidden: values.get('hidden') });
    if (!locals.token) return fail(401, { visibility: { type: 'error' as const, text: i18n.notSignedIn() } });
    if (!parsed.success) return fail(400, { visibility: { type: 'error' as const, text: i18n.invalidVisibility() } });
    const { id, hidden } = parsed.data;
    try {
      await gqlClient(locals.token).request<{ setUserApiKeyHidden: Pick<UserApiKey, 'id' | 'hiddenAt'> }>(
        SET_USER_API_KEY_HIDDEN_MUTATION, { id, hidden },
      );
      return { visibility: { type: 'success' as const, id, text: i18n.visibilitySuccess(hidden) } };
    } catch (e) {
      // Render only the server's plain refusal, never transport/request diagnostics.
      const errors = (e as { response?: { errors?: { message?: string }[] } } | null)?.response?.errors;
      const code = extractGqlErrorCode(e);
      const refused = code !== null && ['BAD_USER_INPUT', 'NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED', 'SESSION_EXPIRED'].includes(code);
      const text = refused && errors?.[0]?.message ? errors[0].message : i18n.visibilityFailed();
      return fail(500, { visibility: { type: 'error' as const, id, text } });
    }
  },
  /**
   * Mint a new user-scoped API key. Surfaces the raw key EXACTLY ONCE
   * via the action return value; the +page.svelte form handler reads
   * `form?.rawKey` and renders the one-shot reveal banner.
   */
  create: async ({ request, locals }) => {
    const form = await superValidate(await request.formData(), createUserApiKeyFormAdapter);
    if (!locals.token) {
      return message(form, { type: 'error', text: i18n.notSignedIn() }, { status: 401 });
    }
    if (!form.valid) return fail(400, { form });

    const label = form.data.label.length > 0 ? form.data.label : null;
    try {
      const data = await gqlClient(locals.token).request<{
        createUserApiKey: UserApiKeyCreateResult;
      }>(CREATE_USER_API_KEY_MUTATION, { label });
      // SvelteKit serializes the return value into `form` on the
      // client. The raw key flows through here EXACTLY ONCE; the page
      // renders it in a copy-now banner and then nothing recovers it.
      return {
        success: 'mint' as const,
        rawKey: data.createUserApiKey.rawKey,
        userApiKey: data.createUserApiKey.userApiKey,
        ...message(form, { type: 'success', text: i18n.mintSuccess() }),
      };
    } catch (e) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Could not mint API key.') }, { status: 500 });
    }
  },

  /**
   * Revoke a key the caller owns. Cross-user revocations surface as
   * NOT_FOUND from the server (id-enumeration mitigation); we render
   * that as a generic "not found" rather than a permissions error so
   * the portal doesn't leak the same channel.
   */
  revoke: async ({ request, locals }) => {
    const form = await superValidate(await request.formData(), revokeUserApiKeyFormAdapter);
    if (!locals.token) {
      return message(form, { type: 'error', text: i18n.notSignedIn() }, { status: 401 });
    }
    if (!form.valid) return fail(400, { form });
    try {
      await gqlClient(locals.token).request<{ revokeUserApiKey: UserApiKey }>(
        REVOKE_USER_API_KEY_MUTATION,
        { id: form.data.id },
      );
      return {
        success: 'revoke' as const,
        ...message(form, { type: 'success', text: i18n.revokeSuccess() }),
      };
    } catch (e) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Could not revoke API key.') },
        { status: 500 },
      );
    }
  },
};
