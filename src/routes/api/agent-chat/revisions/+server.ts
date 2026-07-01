import { gqlClient } from '$lib/server/api';
import {
  CREATE_REVISION_MUTATION,
  PUBLISH_REVISION_MUTATION,
  RESTORE_REVISION_MUTATION,
  ACQUIRE_EDITOR_LOCK_MUTATION,
  RELEASE_EDITOR_LOCK_MUTATION,
} from '$lib/server/queries';
import type { RequestHandler } from './$types';

/**
 * POST /api/agent-chat/revisions
 *
 * Actions:
 *   save:    { agentId, description? }
 *   publish: { agentId, revisionLoc, versionLabel? }
 *   restore: { agentId, revisionLoc }
 *   lock:    { agentId }
 *   unlock:  { agentId }
 *   list:    { agentId, systemMemoryId }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const action = body.action as string;
  const agentId = body.agentId as string;
  if (!agentId) {
    return new Response(JSON.stringify({ error: 'agentId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const client = gqlClient(locals.token);

  try {
    if (action === 'save') {
      const result = await client.request<{ createRevision: unknown }>(
        CREATE_REVISION_MUTATION,
        { agentId, description: (body.description as string) ?? null },
      );
      return new Response(JSON.stringify(result.createRevision), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'publish') {
      if (!body.revisionLoc) {
        return new Response(JSON.stringify({ error: 'revisionLoc is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const result = await client.request<{ publishRevision: unknown }>(
        PUBLISH_REVISION_MUTATION,
        { agentId, revisionLoc: body.revisionLoc, versionLabel: (body.versionLabel as string) ?? null },
      );
      return new Response(JSON.stringify(result.publishRevision), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'restore') {
      if (!body.revisionLoc) {
        return new Response(JSON.stringify({ error: 'revisionLoc is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const result = await client.request<{ restoreRevision: unknown }>(
        RESTORE_REVISION_MUTATION,
        { agentId, revisionLoc: body.revisionLoc },
      );
      return new Response(JSON.stringify(result.restoreRevision), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'lock') {
      const result = await client.request<{ acquireEditorLock: unknown }>(
        ACQUIRE_EDITOR_LOCK_MUTATION,
        { agentId },
      );
      return new Response(JSON.stringify(result.acquireEditorLock), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'unlock') {
      await client.request(RELEASE_EDITOR_LOCK_MUTATION, { agentId });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'list') {
      const systemMemoryId = body.systemMemoryId as string | undefined;
      if (!systemMemoryId) {
        return new Response(JSON.stringify({ error: 'systemMemoryId is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Fetch revision nodes from the agent's system memory. cor:api:090 —
      // findNodes hides class:'system' memories on a broad call, so we scope to
      // the system memory (which also overrides the exclusion) and use
      // filter.locPrefix for the `revisions:` prefix. Results are hits[].node.
      const REVISIONS_QUERY = `
        query Revisions($limit: Int, $memoryIds: [ID!]) {
          findNodes(filter: { memoryIds: $memoryIds, locPrefix: "revisions:" }, limit: $limit) {
            hits { node { id loc name description data } }
          }
        }
      `;
      const result = await client.request<{ findNodes: { hits: Array<{ node: { id: string; loc: string; name: string; description: string | null; data: unknown } }> } }>(
        REVISIONS_QUERY,
        { limit: 100, memoryIds: [systemMemoryId] },
      );
      const revisions = result.findNodes.hits
        .map((h) => h.node)
        .filter((n) => n.loc.startsWith('revisions:') && n.loc !== 'revisions')
        .map((n) => {
          const d = (n.data as Record<string, unknown>) ?? {};
          return {
            loc: n.loc,
            label: (d.versionLabel as string) ?? (d.label as string) ?? n.name,
            description: n.description,
            published: d.published === true,
            publishedAt: d.publishedAt ?? null,
            revision: d.revision,
            createdAt: d.createdAt ?? null,
            createdBy: d.createdBy ?? null,
          };
        })
        .sort((a, b) => ((b.revision as number) ?? 0) - ((a.revision as number) ?? 0));
      return new Response(JSON.stringify({ revisions }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Request failed';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
