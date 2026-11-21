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
    loadPending(client, cookies, (tr) => tr.secretId === params.secretId),
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

/** A write's result as the page renders it: staged is neither saved nor a generic error. */
function outcome<D>(action: Action, r: SecretWrite<D>, secretId: string, cookies: import('@sveltejs/kit').Cookies) {
  if (r.kind === 'ok') return { action, ok: true as const };
  if (r.kind === 'staged') {
    trackRequest(cookies, { secretId, requestId: r.requestId, ceremonyUrl: r.ceremonyUrl });
    return { action, staged: true as const };
  }
  return fail(r.kind === 'plain-protected' ? 403 : 400, { action, message: r.kind === 'plain-protected' ? PLAIN_PROTECTED_TEXT() : r.message });
}

export const actions: Actions = {
  update: async ({ request, params, locals, cookies }) => {
    if (locals.impersonation) return readOnly('update');
    const value = parseSecretValue(String((await request.formData()).get('value') ?? ''));
    if (value === undefined) return fail(400, { action: 'update' as const, message: t('secrets.value.required', 'Enter a value.') });
    const r = await secretWrite<{ updateSecret: AppSecret }>(gqlClient(locals.token), UPDATE_SECRET_VALUE_MUTATION, { ref: params.secretId, value });
    return outcome('update', r, params.secretId, cookies);
  },

  protect: async ({ request, params, locals, cookies }) => {
    if (locals.impersonation) return readOnly('protect');
    const on = (await request.formData()).get('protected') === 'true';
    const r = await secretWrite<{ setSecretProtected: AppSecret }>(gqlClient(locals.token), SET_SECRET_PROTECTED_MUTATION, { ref: params.secretId, protected: on });
    return outcome('protect', r, params.secretId, cookies);
  },

  delete: async ({ params, locals, cookies }) => {
    if (locals.impersonation) return readOnly('delete');
    const r = await secretWrite<{ deleteSecret: boolean }>(gqlClient(locals.token), DELETE_SECRET_MUTATION, { ref: params.secretId });
    if (r.kind === 'ok') throw redirect(303, `/app/apps/${params.appId}/secrets`);
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
