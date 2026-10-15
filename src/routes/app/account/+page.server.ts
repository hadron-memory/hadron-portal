import { fail, redirect } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { DELETE_CONFIRMATION_TOKEN, deleteAccountStrings } from '$lib/i18n/delete-account-strings';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { DELETE_USER_MUTATION, ME_QUERY, UPDATE_MY_PROFILE_MUTATION } from '$lib/server/queries';
import type { UserSummary } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { accountProfileSchema } from './schema';

/** An org blocking self-deletion: the caller is its sole owner while other
 *  members remain (deleteUser SOLE_ORG_OWNER failure, #662). */
export interface BlockingOrg {
  id: string;
  name: string;
}

/**
 * Pull the blocking-org list out of a SOLE_ORG_OWNER GraphQL error's
 * extensions. The server contract guarantees a list of `{ id, name }` orgs in
 * extensions but doesn't pin the key name, so scan the known candidates first
 * and fall back to the first array of org-shaped entries.
 */
function extractBlockingOrgs(e: unknown): BlockingOrg[] {
  if (!e || typeof e !== 'object' || !('response' in e)) return [];
  const resp = (e as { response?: { errors?: { extensions?: Record<string, unknown> }[] } }).response;
  const extensions = resp?.errors?.[0]?.extensions;
  if (!extensions) return [];
  const isOrgList = (v: unknown): v is BlockingOrg[] =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (o) => !!o && typeof o === 'object'
        && typeof (o as BlockingOrg).id === 'string'
        && typeof (o as BlockingOrg).name === 'string',
    );
  for (const key of ['orgs', 'blockingOrgs', 'organizations']) {
    if (isOrgList(extensions[key])) return (extensions[key] as BlockingOrg[]).map(({ id, name }) => ({ id, name }));
  }
  const fallback = Object.values(extensions).find(isOrgList);
  return fallback ? fallback.map(({ id, name }) => ({ id, name })) : [];
}

const accountProfileFormAdapter = zod4(accountProfileSchema);

function profileFormDefaults(user: UserSummary) {
  return {
    name: user.name ?? '',
    handle: user.handle ?? user.githubUsername ?? '',
    email: user.email ?? '',
  };
}

export const load: PageServerLoad = async ({ locals }) => {
  // #1117: snapshot before the await. The root layout, loading in parallel,
  // used to null `locals.user` when its own `me` failed (it no longer does),
  // and reading it after the await built a fallback user with no id.
  const sessionUser = locals.user;
  const data = await gqlClient(locals.token)
    .request<{ me: UserSummary | null }>(ME_QUERY)
    // Surface a failed `me` instead of silently blanking the profile. The
    // fallback below merges the JWT's locals.user (name/email), but `handle`
    // isn't in the JWT — so a failed `me` blanks the handle specifically
    // (hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch).
    .catch((e) => {
      console.error('[account] `me` query failed — handle will be blank (name/email fall back to the JWT):', e);
      return { me: null as UserSummary | null };
    });
  const user: UserSummary = data.me ?? { ...sessionUser!, handle: null };
  const form = await superValidate(profileFormDefaults(user), accountProfileFormAdapter, { errors: false });
  return { user, form };
};

export const actions: Actions = {
  update: async ({ request, locals }) => {
    const form = await superValidate(await request.formData(), accountProfileFormAdapter);
    if (!form.valid) return fail(400, { form });

    const name = form.data.name || null;
    const handle = form.data.handle || null;
    const email = form.data.email || null;
    try {
      await gqlClient(locals.token).request(UPDATE_MY_PROFILE_MUTATION, { name, handle, email });
      return message(form, { type: 'success', text: 'Profile updated.' });
    } catch (e: unknown) {
      const text = extractGqlError(e, 'Failed to update profile');
      // hadron-server#1801: a changed address is refused (BAD_USER_INPUT, nothing
      // written). The page keeps the field read-only, so this only arrives from a
      // stale or hand-built form; say so on the field rather than in a banner.
      if (extractGqlErrorCode(e) === 'BAD_USER_INPUT' && /email/i.test(text)) {
        return setError(form, 'email', 'Changing your email address is not supported here.', { status: 400 });
      }
      return message(form, { type: 'error', text }, { status: 500 });
    }
  },

  /**
   * Self-serve account deletion (#662). Plain (non-Superforms) action per the
   * simple-delete-confirmation convention: the only field is the typed
   * `DELETE` confirmation, re-checked server-side. On success the account —
   * and with it the JWT — is gone, so clear the session cookie (same `/` path
   * it was set with in /auth/callback) and land on the public /goodbye page.
   */
  deleteAccount: async ({ request, locals, cookies }) => {
    if (!locals.user || !locals.token) {
      redirect(303, '/signin?redirect=/app/account');
    }
    const confirm = String((await request.formData()).get('confirm') ?? '').trim();
    // Every failure return carries the same { deleteError, blockingOrgs }
    // shape so the generated ActionData exposes both keys uniformly.
    if (confirm !== DELETE_CONFIRMATION_TOKEN) {
      return fail(400, {
        deleteError: deleteAccountStrings.errorConfirmMismatch(),
        blockingOrgs: [] as BlockingOrg[],
      });
    }
    try {
      await gqlClient(locals.token).request(DELETE_USER_MUTATION);
    } catch (e: unknown) {
      if (extractGqlErrorCode(e) === 'SOLE_ORG_OWNER') {
        return fail(409, {
          deleteError: deleteAccountStrings.errorSoleOrgOwner(),
          blockingOrgs: extractBlockingOrgs(e),
        });
      }
      return fail(500, {
        deleteError: extractGqlError(e, deleteAccountStrings.errorGeneric()),
        blockingOrgs: [] as BlockingOrg[],
      });
    }
    cookies.delete('hadron_token', { path: '/' });
    redirect(303, '/goodbye');
  },
};
