/**
 * Spec 025-oauth-for-mcp US2 / T051 — /app/account/api-keys page server.
 *
 * Uses the user-key GraphQL operations shipped in hadron-server:
 *   - Query `myUserApiKeys` — list every active + revoked key the caller
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
} from '$lib/server/queries';
import type { UserApiKey, UserApiKeyCreateResult } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { createUserApiKeySchema, revokeUserApiKeySchema, keyVisibilitySchema } from './schema';

const createUserApiKeyFormAdapter = zod4(createUserApiKeySchema);
const revokeUserApiKeyFormAdapter = zod4(revokeUserApiKeySchema);

export const load: PageServerLoad = async ({ locals, url }) => {
  const includeHidden = url?.searchParams.get('includeHidden') === 'true';
  const form = await superValidate({}, createUserApiKeyFormAdapter, { errors: false });
  const revokeForm = await superValidate({}, revokeUserApiKeyFormAdapter, { errors: false });
  // Auth gate: locals.token is set by the +layout.server.ts auth flow;
  // a missing token means the user isn't signed in (the layout should
  // already have redirected). If we somehow get here without one, show
  // an empty list rather than blow up — the page renders the "no keys"
  // empty state, and the actions below 401 cleanly.
  if (!locals.token) {
    return { keys: [] as UserApiKey[], includeHidden, form, revokeForm };
  }
  try {
    const data = await gqlClient(locals.token).request<{
      myUserApiKeys: UserApiKey[];
    }>(MY_USER_API_KEYS_QUERY, { includeHidden });
    return { keys: data.myUserApiKeys, includeHidden, form, revokeForm };
  } catch (e) {
    // Same posture as other portal loaders: surface a friendly empty
    // state on transient failure rather than crashing the page. The
    // user can retry; nothing destructive happens.
    return {
      keys: [] as UserApiKey[],
      includeHidden,
      form,
      revokeForm,
      loadError: extractGqlError(e, 'Could not load your API keys.'),
    };
  }
};

export const actions: Actions = {
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
