import { t } from '$lib/i18n/t';
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { readInstallPrompt, readProvenance, writeInstallPrompt } from '$lib/server/boot-install';
import type { CompileOwner } from '$lib/boot-install';
import type { RequestHandler } from './$types';
function ownerOf(value: unknown): CompileOwner | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.app !== 'string' || !v.app || typeof v.agent !== 'string' || !v.agent) return null;
  if (v.level === 'app') return { level: 'app', app: v.app, agent: v.agent };
  if (v.level === 'worker' && typeof v.worker === 'string' && v.worker) return { level: 'worker', app: v.app, agent: v.agent, worker: v.worker };
  return null;
}
export const GET: RequestHandler = async ({ url, locals, setHeaders }) => {
  setHeaders?.({ 'Cache-Control': 'private, no-store' });
  const client = gqlClient(locals.token);
  try {
    if (url.searchParams.has('node')) {
      // portal#1754: a node ref is a primary key or a URN and the server's resolver sets no length bound,
      // so only a blank value is malformed here. The trimmed value is what is checked AND what is forwarded.
      const node = url.searchParams.get('node')!.trim();
      if (!node) return json({ failed: true }, { status: 400 });
      const rev = Number(url.searchParams.get('revision'));
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (!Number.isInteger(rev) || rev < 1 || !Number.isInteger(offset) || offset < 0 || offset > 2147483647) return json({ failed: true }, { status: 400 });
      return json({ page: await readProvenance(client, node, rev, offset) });
    }
    const owner = ownerOf(Object.fromEntries(url.searchParams));
    if (!owner) return json({ failed: true }, { status: 400 });
    return json(await readInstallPrompt(client, owner));
  } catch { return json({ failed: true }, { status: 502 }); }
};
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user || locals.impersonation) return json({ ok: false, text: t('boot.install.person-required', 'This prompt can’t be updated here. Sign in as yourself.') }, { status: 403 });
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return json({ ok: false }, { status: 415 });
  let body;
  try { body = await request.json(); } catch { return json({ ok: false }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false }, { status: 400 });
  const owner = ownerOf(body.owner);
  if (!owner || !['compile', 'start', 'approve'].includes(body.intent)) return json({ ok: false }, { status: 400 });
  if (body.intent === 'approve' && (typeof body.nodeId !== 'string' || !Number.isInteger(body.revision) || body.revision < 1)) return json({ ok: false }, { status: 400 });
  const result = await writeInstallPrompt(gqlClient(locals.token), owner, body, false);
  return json(result, { status: 'status' in result ? result.status : 200 });
};
