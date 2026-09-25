import { json } from '@sveltejs/kit';
import JSZip from 'jszip';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { NODE_MEMORY_REF_QUERY, SKILL_PLAN_EXPORT_QUERY } from '$lib/server/queries';
import { isBundleHost, planSkillDownload, type PlanEntry } from '$lib/skill-bundle';
import type { RequestHandler } from './$types';

/**
 * #911 — ONE task as ONE skill: the node page's "Export as skill" menu entry.
 *
 * Like the org download (`/app/orgs/[id]/tasks/plugin`), this renders nothing:
 * the server's EXPORT plan renders the SKILL.md and withholds a body from
 * anything it judged broken, and `planSkillDownload` only arranges it. The
 * archive travels base64-encoded beside the reasons, so a refusal is said on
 * the page instead of arriving as an empty file.
 *
 * `skillPlan` has no node filter, so this plans the node's OWN memory and keeps
 * the entry whose id matches (#911, option a — no server change). The memory
 * comes from the fetched node, never from the URL (#237): a stale URL must not
 * plan a different memory.
 */
export const POST: RequestHandler = async ({ request, params, locals }) => {
  // A +server.ts does not run the /app layout's sign-in redirect.
  if (!locals.token) return json({ code: 'UNAUTHENTICATED', message: 'sign in required' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { host?: unknown } | null;
  const host = body?.host;
  if (!isBundleHost(host)) return json({ code: 'invalid-host' }, { status: 400 });

  const client = gqlClient(locals.token);
  let node: { id: string; memoryId: string } | null;
  try {
    ({ node } = await client.request<{ node: { id: string; memoryId: string } | null }>(NODE_MEMORY_REF_QUERY, {
      ref: params.nodeId,
    }));
  } catch (e) {
    console.error('[node skill] node read failed:', e);
    return json({ code: 'node-failed', detail: extractGqlError(e, 'The task could not be read') }, { status: 502 });
  }
  if (!node) return json({ code: 'not-found' }, { status: 404 });

  let entries: PlanEntry[];
  try {
    const r = await client.request<{ skillPlan: { entries: PlanEntry[] } }>(SKILL_PLAN_EXPORT_QUERY, {
      host,
      memories: [node.memoryId],
    });
    entries = r.skillPlan.entries;
  } catch (e) {
    console.error('[node skill] skillPlan EXPORT failed:', e);
    return json({ code: 'plan-failed', detail: extractGqlError(e, 'The export plan failed') }, { status: 502 });
  }

  const nodeId = node.id;
  const download = planSkillDownload(
    entries.find((e) => e.nodeId === nodeId),
    host,
  );
  let zipBase64: string | null = null;
  if (download.filename) {
    const zip = new JSZip();
    for (const [path, contents] of Object.entries(download.files)) zip.file(path, contents);
    zipBase64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  }
  return json({ host, filename: download.filename, zipBase64, reasons: download.reasons });
};
