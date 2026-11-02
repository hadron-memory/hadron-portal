import type { GraphQLClient } from 'graphql-request';
import { extractGqlError, extractGqlErrorCode, extractGqlErrorExtensions } from '$lib/server/gqlError';
import { APP_PROPERTIES_QUERY, SET_APP_PROPERTIES_MUTATION } from '$lib/server/queries';
import { t } from '$lib/i18n/t';
import {
  TASK_INTEGRATION_REFUSALS,
  parseDrafts,
  validateDrafts,
  writeProperties,
  type IntegrationDraft,
  type TaskIntegrationsResult,
} from '$lib/task-integrations';

/**
 * portal#1607 — an App's properties (hrn:node:hadronmemory.com:specs:cor:dmo:050:20), in their own classified
 * request. `hidden` is the server's own answer that this caller may not read
 * them (`propertiesRevision` null); `failed` is anything else. Neither is ever
 * an empty section. Never throws; logs no server text.
 */
export type PropertiesRead =
  | { kind: 'ok'; properties: Record<string, unknown> | null; revision: number }
  | { kind: 'hidden' }
  | { kind: 'failed' };

type AppPropertiesRow = { properties?: unknown; propertiesRevision?: number | null } | null;

export async function loadAppProperties(client: GraphQLClient, appRef: string): Promise<PropertiesRead> {
  try {
    const r = await client.request<{ app: AppPropertiesRow }>(APP_PROPERTIES_QUERY, { ref: appRef });
    if (!r.app) return { kind: 'failed' };
    const revision = r.app.propertiesRevision;
    if (revision === null) return { kind: 'hidden' };
    if (typeof revision !== 'number') return { kind: 'failed' };
    const p = r.app.properties;
    return { kind: 'ok', properties: p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null, revision };
  } catch (e) {
    console.warn(`[app-properties] read for ${appRef} failed (${extractGqlErrorCode(e) ?? 'transport'})`);
    return { kind: 'failed' };
  }
}

const refuse = (message: string, path: string | null = null): TaskIntegrationsResult => ({
  ok: false, code: null, message, path, currentRevision: null,
});

/**
 * Write the whole properties object with only `taskIntegrations` replaced.
 * Reads the current object fresh (to keep every other key) and sends the
 * revision the PERSON read as `expectedRevision`: if the settings moved in
 * between, the server refuses with APP_PROPERTIES_CONFLICT and nothing is
 * retried. A null lead is never sent.
 */
export async function saveTaskIntegrations(client: GraphQLClient, appRef: string, formData: FormData): Promise<TaskIntegrationsResult> {
  let drafts: IntegrationDraft[];
  try {
    const parsed = parseDrafts(JSON.parse(String(formData.get('integrations') ?? '')));
    if (!parsed) throw new Error('not a list of integrations');
    drafts = parsed;
  } catch {
    return refuse(t('app.integrations.error.unreadable', 'The integrations could not be read. Reload the page and try again.'));
  }
  const revisionText = String(formData.get('revision') ?? '');
  const expectedRevision = /^\d+$/.test(revisionText) ? Number(revisionText) : null;
  if (expectedRevision === null) return refuse(t('app.integrations.error.no-revision', 'The settings revision is missing. Reload the page and try again.'));

  const invalid = Object.entries(validateDrafts(drafts))[0];
  if (invalid) return refuse(invalid[1], invalid[0]);

  const current = await loadAppProperties(client, appRef);
  if (current.kind !== 'ok') {
    return refuse(current.kind === 'hidden'
      ? t('app.integrations.error.forbidden', 'You can’t change this App’s settings.')
      : t('app.integrations.error.read-failed', 'The current settings could not be read. Try again.'));
  }

  try {
    const r = await client.request<{ setAppProperties: { propertiesRevision?: number | null } }>(SET_APP_PROPERTIES_MUTATION, {
      appRef,
      expectedRevision,
      properties: writeProperties(current.properties, drafts),
    });
    return { ok: true, revision: r.setAppProperties?.propertiesRevision ?? null };
  } catch (e) {
    const code = extractGqlErrorCode(e);
    const ext = extractGqlErrorExtensions(e);
    if (code === 'APP_PROPERTIES_CONFLICT') {
      return {
        ok: false, code, path: null,
        currentRevision: typeof ext?.currentRevision === 'number' ? ext.currentRevision : null,
        message: t('app.integrations.error.conflict', 'Someone else changed these settings. Reload to see their changes, then make yours again.'),
      };
    }
    return {
      ok: false, code, currentRevision: null,
      path: code === 'TASK_INTEGRATION_INVALID' && typeof ext?.path === 'string' ? ext.path : null,
      message: extractGqlError(e, t('app.integrations.error.save-failed', 'The settings could not be saved.'), TASK_INTEGRATION_REFUSALS),
    };
  }
}
