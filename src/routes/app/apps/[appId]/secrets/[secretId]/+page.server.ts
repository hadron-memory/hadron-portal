import { error, fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import {
  DELETE_SECRET_MUTATION, SET_SECRET_PROTECTED_MUTATION, UPDATE_SECRET_VALUE_MUTATION,
  loadAppSecret, probeSigning, type AppSecret,
} from '$lib/server/secrets';
import { PLAIN_PROTECTED_TEXT, parseSecretValue, secretWrite, type SecretWrite } from '$lib/server/secret-writes';
import { loadPending, trackRequest, withdrawRequest } from '$lib/server/secret-pending';
import { t } from '$lib/i18n/t';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, cookies }) => {
  const client = gqlClient(locals.token);
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');
  const read = await loadAppSecret(client, app.id, params.secretId);
  if (read.kind === 'missing') throw error(404, 'Secret not found');
  const [signing, pending] = await Promise.all([
    probeSigning(client),
    loadPending(client, cookies, (tr) => tr.secretId === params.secretId, !!locals.impersonation),
  ]);
  return {
    app,
    secret: read.kind === 'ok' ? read.secret : null,
    signing,
    pending,
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };
};

type Action = 'update' | 'protect' | 'delete' | 'withdraw';
const readOnly = (action: Action) => fail(403, { action, message: t('secrets.impersonating', 'Impersonation sessions are read-only.') });

/**
 * The same ownership read the page's load makes, before an action writes: a secret that is not this
 * App's (or not the viewer's to see) is a 404 here too, whatever ref the form was posted to.
 */
async function ownedSecret(client: ReturnType<typeof gqlClient>, params: { appId: string; secretId: string }, action: Action) {
  const app = await loadTasksApp(client, params.appId);
  if (!app) return fail(404, { action, message: t('secrets.app.missing', 'This App was not found.') });
  const read = await loadAppSecret(client, app.id, params.secretId);
  if (read.kind === 'missing') return fail(404, { action, message: t('secrets.secret.missing', 'This secret was not found. Reload to check.') });
  if (read.kind === 'failed') return fail(400, { action, message: t('secrets.write.failed', "That didn't go through. Try again.") });
  return null;
}

/** A write's result as the page renders it: staged is neither saved nor a generic error. */
function outcome<D>(action: Action, r: SecretWrite<D>, secretId: string, cookies: import('@sveltejs/kit').Cookies) {
  if (r.kind === 'ok') return { action, ok: true as const };
  if (r.kind === 'staged') {
    trackRequest(cookies, { secretId, requestId: r.requestId });
    return { action, staged: true as const };
  }
  return fail(r.kind === 'plain-protected' ? 403 : 400, { action, message: r.kind === 'plain-protected' ? PLAIN_PROTECTED_TEXT() : r.message });
}

export const actions: Actions = {
  update: async ({ request, params, locals, cookies }) => {
    if (locals.impersonation) return readOnly('update');
    const value = parseSecretValue(String((await request.formData()).get('value') ?? ''));
    if (value === undefined) return fail(400, { action: 'update' as const, message: t('secrets.value.required', 'Enter a value.') });
    const client = gqlClient(locals.token);
    const refused = await ownedSecret(client, params, 'update');
    if (refused) return refused;
    const r = await secretWrite<{ updateSecret: AppSecret }>(client, UPDATE_SECRET_VALUE_MUTATION, { ref: params.secretId, value });
    return outcome('update', r, params.secretId, cookies);
  },

  protect: async ({ request, params, locals, cookies }) => {
    if (locals.impersonation) return readOnly('protect');
    const on = (await request.formData()).get('protected') === 'true';
    const client = gqlClient(locals.token);
    const refused = await ownedSecret(client, params, 'protect');
    if (refused) return refused;
    const r = await secretWrite<{ setSecretProtected: AppSecret }>(client, SET_SECRET_PROTECTED_MUTATION, { ref: params.secretId, protected: on });
    return outcome('protect', r, params.secretId, cookies);
  },

  delete: async ({ request, params, locals, cookies }) => {
    if (locals.impersonation) return readOnly('delete');
    // The confirmation is the server's, so it holds with and without JavaScript: the first post only
    // asks; the delete runs on the post that carries confirm=yes.
    if ((await request.formData()).get('confirm') !== 'yes') return { action: 'delete' as const, confirm: true as const };
    const client = gqlClient(locals.token);
    const refused = await ownedSecret(client, params, 'delete');
    if (refused) return refused;
    const r = await secretWrite<{ deleteSecret: boolean }>(client, DELETE_SECRET_MUTATION, { ref: params.secretId });
    if (r.kind === 'ok') {
      // false means nothing was deleted (it is already gone, or not this caller's to delete): not a success.
      if (r.data.deleteSecret !== true) return fail(400, { action: 'delete' as const, message: t('secrets.delete.nothing', 'Nothing was deleted: the secret may already be gone. Reload to check.') });
      throw redirect(303, `/app/apps/${params.appId}/secrets`);
    }
    return outcome('delete', r, params.secretId, cookies);
  },

  withdraw: async ({ request, locals, cookies }) => {
    if (locals.impersonation) return readOnly('withdraw');
    const requestId = String((await request.formData()).get('requestId') ?? '');
    if (!requestId) return fail(400, { action: 'withdraw' as const, message: t('secrets.write.failed', "That didn't go through. Try again.") });
    const r = await withdrawRequest(gqlClient(locals.token), cookies, requestId);
    if (r.kind === 'ok') return { action: 'withdraw' as const, ok: true as const };
    return fail(400, { action: 'withdraw' as const, message: r.kind === 'refused' ? r.message : PLAIN_PROTECTED_TEXT() });
  },
};
