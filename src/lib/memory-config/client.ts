import { t } from '$lib/i18n/t';
export type ConfigFailure = { error: string; code?: string | null; field?: string | null };
export async function configCall<T>(body: Record<string, unknown>): Promise<T> {
  try {
    const response = await fetch('/api/memory-config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || result.error) throw result;
    return result as T;
  } catch (e) {
    if (e && typeof e === 'object' && 'error' in e && typeof e.error === 'string') throw e;
    throw { error: t('config.connection-failed', 'Could not connect. Your input is kept; try again when the connection returns.') } satisfies ConfigFailure;
  }
}
