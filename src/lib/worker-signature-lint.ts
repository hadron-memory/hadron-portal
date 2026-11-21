import { t } from '$lib/i18n/t';
export type SignatureLintItem = { kind: string; workerField: string | null };
export type SignatureLintPage = { items: SignatureLintItem[]; total: number; nextCursor: string | null };
/** A missing/old-schema/malformed read never means zero warnings. */
export function signatureLintPage(value: unknown): SignatureLintPage | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as SignatureLintPage;
  if (!Array.isArray(p.items) || !Number.isInteger(p.total) || p.total < p.items.length || !(p.nextCursor === null || typeof p.nextCursor === 'string')) return null;
  if (!p.items.every(i => i && typeof i.kind === 'string' && (i.workerField === null || typeof i.workerField === 'string'))) return null;
  return { items: p.items.map(i => ({ kind: i.kind, workerField: i.workerField })), total: p.total, nextCursor: p.nextCursor };
}
export function workerLinkAdvice(field: 'signature' | 'trailer') {
  return field === 'signature'
    ? t('worker.signature.lint.signature', 'The saved signature doesn’t include this worker’s link, so posts and messages it signs won’t link back to the worker. You can add {example} or the worker’s portal URL.', { example: '{{worker.url}}' })
    : t('worker.signature.lint.trailer', 'The saved trailer doesn’t include this worker’s link, so commits it marks won’t link back to the worker. You can add {example} or the worker’s portal URL.', { example: '{{worker.url}}' });
}
