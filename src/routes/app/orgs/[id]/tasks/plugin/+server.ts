import { json } from '@sveltejs/kit';
import JSZip from 'jszip';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { loadOrgDetail } from '$lib/server/org-detail';
import { ORG_SKILL_BUNDLE_QUERY, SKILL_PLAN_EXPORT_QUERY } from '$lib/server/queries';
import { isBundleHost, planBundle, type PlanEntry } from '$lib/skill-bundle';
import type { RequestHandler } from './$types';

/**
 * #879 — the Task Nodes download: every checked task in this org, as ONE
 * archive for the host the user picked.
 *
 * Returns JSON, not the zip itself, so the page can say what it left out. A
 * download that silently drops three skills is the failure #879 is written
 * against: the user installs it, and three skills never fire, with nothing
 * anywhere saying why. The archive travels base64-encoded beside that report;
 * it is bounded by the server's own `skillPlan` body ceiling.
 *
 * Nothing is rendered here. The server's EXPORT plan renders each SKILL.md
 * (frontmatter, provenance header, body) and withholds a body from anything it
 * judged broken; this endpoint only arranges those files into the host's
 * layout (`planBundle`).
 */
export const POST: RequestHandler = async ({ request, params, locals }) => {
  // A +server.ts does not run the /app layout's sign-in redirect; refuse an
  // anonymous request here rather than let it reach the API tokenless.
  if (!locals.token) return json({ code: 'UNAUTHENTICATED', message: 'sign in required' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { host?: unknown } | null;
  const host = body?.host;
  if (!isBundleHost(host)) return json({ code: 'invalid-host' }, { status: 400 });

  const org = await loadOrgDetail<{ id: string; name?: string | null; memories?: Array<{ id: string }> | null }>(
    locals.token,
    params.id,
    ORG_SKILL_BUNDLE_QUERY,
  );
  const memories = (org?.memories ?? []).map((m) => m.id);
  // NEVER call skillPlan with an empty list: the server reads an omitted or
  // empty `memories` as "every memory the caller can read", so an org with no
  // memories would download the caller's skills from every other org.
  if (memories.length === 0) return json({ code: 'no-memories' }, { status: 409 });

  let entries: PlanEntry[];
  try {
    const data = await gqlClient(locals.token).request<{ skillPlan: { entries: PlanEntry[] } }>(
      SKILL_PLAN_EXPORT_QUERY,
      { host, memories },
    );
    entries = data.skillPlan.entries;
  } catch (e: unknown) {
    console.error('[org tasks] skillPlan EXPORT failed:', e);
    return json({ code: 'plan-failed', detail: extractGqlError(e, 'The export plan failed') }, { status: 502 });
  }

  const bundle = planBundle(entries, host, org?.name ?? '');
  let zipBase64: string | null = null;
  if (bundle.included.length > 0) {
    const zip = new JSZip();
    for (const [path, contents] of Object.entries(bundle.files)) zip.file(path, contents);
    zipBase64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  }

  return json({
    host,
    filename: bundle.filename,
    zipBase64,
    included: bundle.included,
    skipped: bundle.skipped,
  });
};
