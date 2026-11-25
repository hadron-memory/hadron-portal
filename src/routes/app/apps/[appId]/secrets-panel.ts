/**
 * portal#2380 — the App's secrets section of Settings, read only when the section is asked for (the URL names it, or
 * the reader unfolds it). The read carries the caller's staged changes (tracked in a cookie), so the response is
 * `private, no-store`, with the header set BEFORE the read so a refusal keeps it too. A value is write-only: no read
 * here returns one (hrn:node:hadronmemory.com:specs:cor:sec:070).
 */
import type { Cookies } from '@sveltejs/kit';
import type { GraphQLClient } from 'graphql-request';
import { loadAppSecrets, probeSigning } from '$lib/server/secrets';
import { loadPending } from '$lib/server/secret-pending';

export async function loadSecretsPanel(
  want: boolean,
  client: GraphQLClient,
  appId: string,
  locals: App.Locals,
  cookies: Cookies,
  setHeaders: (headers: Record<string, string>) => void,
) {
  if (!want) return null;
  setHeaders({ 'cache-control': 'private, no-store' });
  const [secrets, signing, pending] = await Promise.all([
    loadAppSecrets(client, appId),
    probeSigning(client),
    // A staged create is tracked under the App's id (the create action resolves the URL's ref first), so one match.
    loadPending(client, cookies, (tr) => tr.create?.appId === appId, !!locals.impersonation),
  ]);
  return {
    secrets,
    signing,
    pending: pending.rows,
    pendingUnchecked: pending.unchecked,
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };
}
