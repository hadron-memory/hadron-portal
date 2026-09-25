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
 * planned is the fetched node's, and the URL's memory must be that one.
 */
export const POST: RequestHandler = async ({ request, params, locals }) => {
  // A +server.ts does not run the /app layout's sign-in redirect.
  if (!locals.token) return json({ code: 'UNAUTHENTICATED', message: 'sign in required' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { host?: unknown } | null;
  const host = body?.host;
  if (!isBundleHost(host)) return json({ code: 'invalid-host' }, { status: 400 });

  const client = gqlClient(locals.token);
  let node: { id: string; memoryId: string; isRunnable?: boolean | null } | null;
  try {
    ({ node } = await client.request<{ node: { id: string; memoryId: string; isRunnable?: boolean | null } | null }>(NODE_MEMORY_REF_QUERY, {
      ref: params.nodeId,
    }));
  } catch (e) {
    console.error('[node skill] node read failed:', e);
    return json({ code: 'node-failed', detail: extractGqlError(e, 'The task could not be read') }, { status: 502 });
  }
  if (!node) return json({ code: 'not-found' }, { status: 404 });
  // The page loader REDIRECTS a node reached through another memory's URL
  // (#237); a POST cannot follow a redirect usefully, so it is refused, and a
  // download is never labelled with a memory the task is not in (@copilot on
  // #912). Access is not the concern: the plan runs under the caller's token.
  if (node.memoryId !== params.id) return json({ code: 'wrong-memory' }, { status: 404 });
  // Holger's rule on #911 — only a TASK is exported as a skill — held here as
  // well as in the menu, so a direct request cannot export a plain node that
  // happens to carry a declaration (@copilot on #912).
  if (!node.isRunnable) return json({ code: 'not-a-task' }, { status: 409 });

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
