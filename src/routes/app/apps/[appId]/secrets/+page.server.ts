import { error, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { CREATE_SECRET_MUTATION, loadAppSecrets, probeSigning, type AppSecret } from '$lib/server/secrets';
import { PLAIN_PROTECTED_TEXT, parseSecretValue, secretWrite, validSecretName } from '$lib/server/secret-writes';
import { loadPending, trackRequest, withdrawRequest } from '$lib/server/secret-pending';
import { t } from '$lib/i18n/t';
import type { Actions, PageServerLoad } from './$types';

/**
 * portal#2380 — an App's secrets. Protection exists on App secrets only (hrn:node:hadronmemory.com:specs:cor:sec:070), and a
 * value is write-only: no read here returns one.
 */

export const load: PageServerLoad = async ({ params, locals, cookies }) => {
  const client = gqlClient(locals.token);
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');
  const [secrets, signing, pending] = await Promise.all([
    loadAppSecrets(client, app.id),
    probeSigning(client),
    // A staged create is tracked under the App's id (the create action resolves the URL's ref first), so one match.
    loadPending(client, cookies, (tr) => tr.create?.appId === app.id, !!locals.impersonation),
  ]);
  return {
    app,
    secrets,
    signing,
    pending,
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };
};

export const actions: Actions = {
  create: async ({ request, params, locals, cookies }) => {
    if (locals.impersonation) return fail(403, { action: 'create' as const, message: t('secrets.impersonating', 'Impersonation sessions are read-only.') });
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim();
    const value = parseSecretValue(String(fd.get('value') ?? ''));
    const protect = fd.get('protected') === 'on';
    if (!validSecretName(name)) return fail(400, { action: 'create' as const, name, message: t('secrets.name.invalid', 'Use lowercase letters, digits and hyphens, up to 64 characters.') });
    if (value === undefined) return fail(400, { action: 'create' as const, name, message: t('secrets.value.required', 'Enter a value.') });
    const client = gqlClient(locals.token);
    // The URL's app ref is an id or a handle; a staged create is remembered under the id.
    const app = await loadTasksApp(client, params.appId);
    if (!app) throw error(404, 'App not found');
    const r = await secretWrite<{ createSecret: AppSecret }>(client, CREATE_SECRET_MUTATION, {
      ownerRef: app.id, name, kind: 'generic', value, ...(protect ? { protected: true } : {}),
    });
    if (r.kind === 'ok') return { action: 'create' as const, ok: true as const, name };
    if (r.kind === 'staged') {
      trackRequest(cookies, { create: { appId: app.id, name }, requestId: r.requestId, ceremonyUrl: r.ceremonyUrl });
      return { action: 'create' as const, staged: true as const, name };
    }
    return fail(r.kind === 'plain-protected' ? 403 : 400, { action: 'create' as const, name, message: r.kind === 'plain-protected' ? PLAIN_PROTECTED_TEXT() : r.message });
  },

  withdraw: async ({ request, locals, cookies }) => {
    if (locals.impersonation) return fail(403, { action: 'withdraw' as const, message: t('secrets.impersonating', 'Impersonation sessions are read-only.') });
    const requestId = String((await request.formData()).get('requestId') ?? '');
    if (!requestId) return fail(400, { action: 'withdraw' as const, message: t('secrets.write.failed', "That didn't go through. Try again.") });
    const r = await withdrawRequest(gqlClient(locals.token), cookies, requestId);
    if (r.kind === 'ok') return { action: 'withdraw' as const, ok: true as const };
    return fail(400, { action: 'withdraw' as const, message: r.kind === 'refused' ? r.message : PLAIN_PROTECTED_TEXT() });
  },
};
