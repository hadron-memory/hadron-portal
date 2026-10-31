import { json } from '@sveltejs/kit';
import JSZip from 'jszip';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { pluginVersion } from '$lib/server/plugin-version';
import { orgTaskMemoryIds } from '$lib/server/org-task-memories';
import {
  CREATE_SCOPE_MUTATION,
  DELETE_SCOPE_MUTATION,
  ORG_SKILL_BUNDLE_QUERY,
  SKILL_PLAN_EXPORT_QUERY,
  SKILL_PLAN_STATUS_QUERY,
} from '$lib/server/queries';
import {
  isBundleHost,
  otherBundleHost,
  otherHostOnly,
  planBundle,
  unrecognizedReport,
  type PlanEntry,
  type PlanUnrecognized,
} from '$lib/skill-bundle';
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

  // #1689: the same scope the list shows, system-class memories included.
  const { ids: memories, org, systemFailed } = await orgTaskMemoryIds(locals.token, params.id, ORG_SKILL_BUNDLE_QUERY);
  // NEVER call skillPlan with an empty list: the server reads an omitted or
  // empty `memories` as "every memory the caller can read", so an org with no
  // memories would download the caller's skills from every other org.
  if (memories.length === 0) return json({ code: 'no-memories' }, { status: 409 });

  // The EXPORT plan for the chosen host, and a body-less STATUS plan for the
  // other one — the only uncapped way to name a task declared for the other
  // host alone, which this host's plan scans but never lists (@codex on #890).
  const client = gqlClient(locals.token);
  const otherHost = otherBundleHost(host);

  // #1075: EXPORT takes its memories as a persisted scope, not a list. Make one
  // for this download and delete it when the plans are back.
  // #1077 item 2 (ruling C): a crash between createScope and deleteScope leaves
  // an inert, empty, org-owned task-export-<uuid> scope — scopes only narrow
  // reads (hrn:node:hadronmemory.com:specs:cor:acl:120), so the orphan is
  // accepted; revisit only if a read-only count of task-export-% scopes shows
  // accumulation.
  let scopeId: string;
  try {
    const created = await client.request<{ createScope: { id: string } }>(CREATE_SCOPE_MUTATION, {
      input: {
        name: `task-export-${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`,
        description: 'Task Nodes download (temporary)',
        organizationRef: org?.id ?? params.id,
        memoryRefs: memories,
      },
    });
    scopeId = created.createScope.id;
  } catch (err) {
    // The provider's role gate decides; never infer access from org data.
    if (extractGqlErrorCode(err) === 'FORBIDDEN') {
      return json({ code: 'scope-forbidden' }, { status: 403 });
    }
    console.error('[org tasks] createScope failed');
    return json(
      { code: 'plan-failed', detail: extractGqlError(err, 'The export scope could not be created') },
      { status: 502 },
    );
  }

  let exportPlan: PromiseSettledResult<{ skillPlan: { entries: PlanEntry[]; unrecognized: PlanUnrecognized[] } }>;
  let otherPlan: PromiseSettledResult<{ skillPlan: { entries: PlanEntry[] } }>;
  try {
    // The other host's STATUS plan is LINT/STATUS-shaped, so it keeps `memories`.
    [exportPlan, otherPlan] = await Promise.allSettled([
      client.request<{ skillPlan: { entries: PlanEntry[]; unrecognized: PlanUnrecognized[] } }>(SKILL_PLAN_EXPORT_QUERY, {
        host,
        scopeRef: scopeId,
      }),
      client.request<{ skillPlan: { entries: PlanEntry[] } }>(SKILL_PLAN_STATUS_QUERY, { host: otherHost, memories }),
    ]);
  } finally {
    // Best-effort: a leaked scope is housekeeping, not the user's download.
    try {
      const result = await client.request<{ deleteScope: boolean }>(DELETE_SCOPE_MUTATION, { ref: scopeId });
      if (!result.deleteScope) console.error('[org tasks] deleteScope failed');
    } catch {
      // A ClientError can include tokens, variables and scope contents.
      console.error('[org tasks] deleteScope failed');
    }
  }
  if (exportPlan.status === 'rejected') {
    console.error('[org tasks] skillPlan EXPORT failed:', exportPlan.reason);
    return json(
      { code: 'plan-failed', detail: extractGqlError(exportPlan.reason, 'The export plan failed') },
      { status: 502 },
    );
  }
  const entries = exportPlan.value.skillPlan.entries;
  // server#1296: host-identical, so this plan's copy is the whole list.
  const unrecognizedFromPlan = exportPlan.value.skillPlan.unrecognized;

  // An export RUNS TO THE END and names every failure in its report
  // (hrn:node:hadronmemory.com:specs:cor:agt:030:00, D-2026-09-23-D): the
  // other-host read failing costs the report one section, said so, and does
  // not cost the user the download.
  let notForHost: Array<{ name: string; urn: string }> = [];
  let notForHostUnknown: string | null = null;
  if (otherPlan.status === 'fulfilled') {
    notForHost = otherHostOnly(entries, otherPlan.value.skillPlan.entries);
  } else {
    console.error('[org tasks] skillPlan STATUS (other host) failed:', otherPlan.reason);
    notForHostUnknown = extractGqlError(otherPlan.reason, 'The other host could not be checked');
  }

  const bundle = planBundle(entries, host, org?.name ?? '', pluginVersion);
  let zipBase64: string | null = null;
  if (bundle.included.length > 0) {
    const zip = new JSZip();
    for (const [path, contents] of Object.entries(bundle.files)) zip.file(path, contents);
    zipBase64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  }

  return json({
    host,
    filename: bundle.filename,
    version: bundle.version,
    zipBase64,
    included: bundle.included,
    skipped: bundle.skipped,
    otherHost,
    notForHost,
    notForHostUnknown,
    // The system-memory lookup failed: skills from role agents' memories may be
    // absent from this download and from every list in this report.
    scopeIncomplete: systemFailed,
    unrecognized: unrecognizedReport(unrecognizedFromPlan, bundle.includedNodeIds),
  });
};
