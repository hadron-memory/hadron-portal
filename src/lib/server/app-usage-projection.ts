import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { APP_USAGE_ACCOUNTS_QUERY, ACCOUNT_USAGE_PROJECTION_QUERY } from '$lib/server/queries';
import { accountKey } from '$lib/usage-projection/identity';
import type { UsageAccount, UsageProjection, ProjectionRead, UsageView } from '$lib/usage-projection/types';
export { accountKey };
type WhatIf = { addWorkers: number } | { moveWorker: { worker: string; toAccount: string; toHost: string; toFamily: string } };
function failure(e: unknown): { kind: 'hidden' | 'failed' | 'refused' } {
  const code = extractGqlErrorCode(e);
  if (code === 'APP_NOT_FOUND' || code === 'FORBIDDEN') return { kind: 'hidden' };
  if (code === 'BAD_USER_INPUT') return { kind: 'refused' };
  return { kind: 'failed' };
}
export async function loadAccountProjection(client: GraphQLClient, appRef: string, a: UsageAccount, whatIf?: WhatIf): Promise<ProjectionRead> {
  try {
    const r = await client.request<{ accountUsageProjection: UsageProjection }>(ACCOUNT_USAGE_PROJECTION_QUERY, {
      appRef, account: a.account, host: a.host, family: a.family, ...(whatIf ? { whatIf } : {}),
    });
    if (!r.accountUsageProjection || !Array.isArray(r.accountUsageProjection.windows)) return { kind: 'failed' };
    return { kind: 'ok', value: r.accountUsageProjection };
  } catch (e) { return failure(e); }
}
/** R7: at most list + baseline + one what-if. No eager fan-out over the server's bound50. */
export async function loadUsageView(client: GraphQLClient, appRef: string, params: URLSearchParams): Promise<UsageView> {
  let list: { asOf: string; complete: boolean; accounts: UsageAccount[] };
  try {
    const r = await client.request<{ accountUsageAccounts: typeof list }>(APP_USAGE_ACCOUNTS_QUERY, { appRef });
    list = r.accountUsageAccounts;
    if (!list || !Array.isArray(list.accounts)) return { kind: 'failed' };
  } catch (e) {
    return { kind: failure(e).kind === 'hidden' ? 'hidden' : 'failed' };
  }
  const key = params.get('account');
  const selected = key === null ? list.accounts[0] ?? null : list.accounts.find(a => accountKey(a) === key) ?? null;
  const view: Extract<UsageView, { kind: 'ok' }> = { kind: 'ok', ...list, selected, projection: null, whatIf: null, invalid: key !== null && !selected, question: null, target: null };
  if (!selected) return view;
  view.projection = await loadAccountProjection(client, appRef, selected);
  if (view.projection.kind === 'hidden') return { kind: 'hidden' };
  const add = params.get('add'), move = params.get('move');
  if (add === null && move === null) return view;
  // Repeated/contradictory choices are never silently interpreted. Account/worker values come ONLY from the lists.
  if (['account','add','move','to'].some(k => params.getAll(k).length > 1) || (add !== null && move !== null)) { view.invalid = true; return view; }
  let whatIf: WhatIf;
  if (add !== null) {
    if (!/^\d+$/.test(add) || Number(add) < 1 || Number(add) > 50) { view.invalid = true; return view; }
    whatIf = { addWorkers: Number(add) };
    view.question = { kind: 'add', count: Number(add) };
  } else {
    const target = list.accounts.find(a => accountKey(a) === params.get('to'));
    if (view.projection.kind !== 'ok' || !view.projection.value.workers.includes(move!) || !target || accountKey(target) === accountKey(selected)) { view.invalid = true; return view; }
    view.target = target;
    view.question = { kind: 'move', worker: move!, targetKey: accountKey(target) };
    whatIf = { moveWorker: { worker: move!, toAccount: target.account, toHost: target.host, toFamily: target.family } };
  }
  view.whatIf = await loadAccountProjection(client, appRef, selected, whatIf);
  if (view.whatIf.kind === 'hidden') return { kind: 'hidden' };
  return view;
}
