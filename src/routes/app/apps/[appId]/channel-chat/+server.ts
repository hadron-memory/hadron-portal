import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { readChannelPage } from '$lib/server/channel-chat';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ params, url, locals }) => {
  const channelRef = url.searchParams.get('channelRef');
  const before = url.searchParams.get('beforeSeq');
  const since = url.searchParams.get('sinceSeq');
  const valid = (v: string | null) => v === null || (Number.isSafeInteger(Number(v)) && Number(v) > 0 && Number(v) <= 2147483647);
  if (!channelRef || !valid(before) || !valid(since) || (before !== null && since !== null))
    return json({ items: [], total: 0, loadFailed: true }, { status: 400 });
  try {
    const result = await readChannelPage(gqlClient(locals.token), params.appId, channelRef,
      before !== null ? { beforeSeq: Number(before) } : since !== null ? { sinceSeq: Number(since) } : {});
    return json({ ...result, loadFailed: false });
  } catch {
    return json({ items: [], total: 0, loadFailed: true });
  }
};
