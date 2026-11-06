import { json } from '@sveltejs/kit';
import { t } from '$lib/i18n/t';
import { configRequest, ruleInput, templateInput } from '$lib/memory-config/input';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode, extractGqlErrorExtensions, extractGqlError } from '$lib/gql-error';
import { loadRulebook, mutateRule, loadTemplates, mutateTemplate, previewTemplate, applyTemplate, previewBulkTemplate, applyBulkTemplate } from '$lib/server/memory-config/service';
import type { RequestHandler } from './$types';
const headers = { 'cache-control': 'private, no-store' };
const known = ['RULE_LOCKED', 'CONFLICT', 'NODE_ROLE_RULE_EXISTS', 'INVALID_NODE_ROLE', 'NODE_NOT_FOUND', 'NOT_A_TASK', 'MEMORY_CONFIG_TEMPLATE_EXISTS', 'MEMORY_CONFIG_TEMPLATE_NOT_FOUND', 'NODE_ROLE_RULE_REF_BROKEN'];
// The only codes that prove a bulk call wrote nothing (hrn:node:hadronmemory.com:specs:cor:api:290:01). Any other failure
// may follow committed targets, so the page must hear that the outcome is unknown.
const bulkWholeCall = ['UNAUTHENTICATED', 'FORBIDDEN', 'BAD_USER_INPUT', 'BULK_TARGETS_TOO_MANY', 'MEMORY_CONFIG_TEMPLATE_NOT_FOUND', 'CONFLICT'];
export const POST: RequestHandler = async ({ request, locals, url }) => {
  if (!locals.token) return json({ error: t('config.sign-in', 'Sign in to continue.') }, { status: 401, headers });
  if (request.headers.get('origin') !== url.origin) return json({ error: t('config.origin', 'Reload this page before trying again.') }, { status: 403, headers });
  const parsed = configRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: t('config.invalid', 'Check the form and try again.') }, { status: 400, headers });
  const a = parsed.data, client = gqlClient(locals.token), impersonating = !!locals.impersonation;
  if (impersonating && a.op !== 'read') return json({ error: t('config.impersonation', 'This page is read-only while impersonating.') }, { status: 403, headers });
  if (a.kind === 'bulk') {
    if (!a.ref || !a.memoryRefs || !(a.op === 'preview' || (a.op === 'apply' && a.revision))) return json({ error: t('config.invalid', 'Check the form and try again.') }, { status: 400, headers });
    try {
      const value = a.op === 'preview' ? await previewBulkTemplate(client, a.ref, a.memoryRefs, impersonating) : await applyBulkTemplate(client, a.ref, a.memoryRefs, a.revision!, impersonating);
      return json({ value }, { headers });
    } catch (e) {
      const code = extractGqlErrorCode(e);
      if (!code || !bulkWholeCall.includes(code)) return json({ error: t('config.bulk.no-answer', 'No answer came back for this request.') }, { status: 502, headers });
      const ext = extractGqlErrorExtensions(e);
      return json({ error: extractGqlError(e, t('config.failed', 'Could not complete this change. Your input is kept.'), bulkWholeCall), code, max: ext?.max, count: ext?.count }, { status: code === 'CONFLICT' ? 409 : 400, headers });
    }
  }
  try {
    if (a.kind === 'rules' && a.memoryRef) {
      if (a.op === 'read') return json({ value: await loadRulebook(client, a.memoryRef) }, { headers });
      const input = a.op === 'create' || a.op === 'update' ? ruleInput.parse(a.input) : {};
      if (a.op !== 'create' && !a.ref) throw new Error('Missing rule reference.');
      await mutateRule(client, { ...a, memoryRef: a.memoryRef, input, impersonating });
      return json({ saved: true }, { headers });
    }
    if (a.kind === 'templates' && a.ownerType && a.ownerRef) {
      if (a.op === 'read') return json({ value: await loadTemplates(client, a.ownerType, a.ownerRef) }, { headers });
      const input = a.op === 'create' || a.op === 'update' ? templateInput.parse(a.input) : {};
      await mutateTemplate(client, { ...a, ownerType: a.ownerType, ownerRef: a.ownerRef, input, impersonating });
      return json({ saved: true }, { headers });
    }
    if (a.kind === 'apply' && a.ref && a.memoryRef) {
      const value = a.op === 'preview' ? await previewTemplate(client, a.ref, a.memoryRef, impersonating)
        : a.op === 'apply' && a.revision ? await applyTemplate(client, a.ref, a.memoryRef, a.revision, impersonating) : null;
      if (value) return json({ value }, { headers });
    }
    return json({ error: t('config.invalid', 'Check the form and try again.') }, { status: 400, headers });
  } catch (e) {
    const code = extractGqlErrorCode(e);
    const ext = extractGqlErrorExtensions(e);
    const input = a.input && typeof a.input === 'object' && !Array.isArray(a.input) ? a.input as Record<string, unknown> : {};
    const field = typeof ext?.field === 'string' ? ext.field
      : code === 'INVALID_NODE_ROLE' || code === 'NODE_ROLE_RULE_EXISTS' ? 'role'
      : code === 'NODE_NOT_FOUND' && typeof ext?.ref === 'string'
        ? ['authorTask', 'validationTask', 'descriptionNode'].find(key => input[`${key}Ref`] === ext.ref) ?? null : null;
    return json({ error: extractGqlError(e, t('config.failed', 'Could not complete this change. Your input is kept.'), known, { transport: 'fallback' }), code,
      field }, { status: code === 'CONFLICT' ? 409 : 400, headers });
  }
};
