import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { MERGE_NODES_MUTATION } from '$lib/server/queries';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// #395 — "Merge node" command page. Web equivalent of the CLI `hadron node
// merge`: folds a source node into a target, backed by the mergeNodes mutation.
// The second consumer of the command-page framework — and the first MUTATION
// (vs. the read-only access check), exercising the checkbox + multiselect kinds.

const COMMAND = {
  id: 'merge-node',
  title: 'Merge node',
  description:
    'Fold a source node into a target node. The target survives; selected fields are merged in (text concatenated, tags unioned, data/properties shallow-merged, edges re-pointed).',
};

// NodeMergeField enum (hadron-server) — the foldable fields. Local (not
// exported): a SvelteKit +page.server.ts may only export load/actions/etc.
const MERGE_FIELDS = ['CONTENT', 'ABSTRACT', 'DESCRIPTION', 'TAGS', 'DATA', 'PROPERTIES', 'EDGES'] as const;

export const load: PageServerLoad = ({ url }) => ({
  command: COMMAND,
  // Deep-link prefill (e.g. ?source=…&target=…).
  prefill: {
    source: (url.searchParams.get('source') ?? '').trim(),
    target: (url.searchParams.get('target') ?? '').trim(),
  },
});

export const actions: Actions = {
  run: async ({ request, locals }) => {
    const fd = await request.formData();
    const source = String(fd.get('source') ?? '').trim();
    const target = String(fd.get('target') ?? '').trim();
    const include = fd.getAll('include').map(String).filter((f) => MERGE_FIELDS.includes(f as never));
    const deleteSource = fd.get('deleteSource') === 'true';

    // Echo the inputs back so the form stays populated on re-render.
    const submitted = { source, target, include, deleteSource };

    if (!source || !target) {
      return fail(400, { ...submitted, error: 'Enter both a source and a target node.' });
    }

    // Partial selection → send that subset; full or empty selection → omit so
    // the server merges every field (its documented "include omitted = all").
    const includeArg =
      include.length > 0 && include.length < MERGE_FIELDS.length ? include : undefined;

    try {
      const { mergeNodes } = await gqlClient(locals.token).request<{ mergeNodes: MemoryNode }>(
        MERGE_NODES_MUTATION,
        { input: { source, target, include: includeArg, deleteSource } },
      );
      return { ...submitted, result: mergeNodes };
    } catch (e) {
      const code = extractGqlErrorCode(e);
      if (code === 'FORBIDDEN') {
        return fail(403, {
          ...submitted,
          error: 'You need write access to the target node (and the source, when deleting it or moving edges) to merge.',
        });
      }
      if (code === 'MERGE_SOURCE_EQUALS_TARGET') {
        return fail(400, { ...submitted, error: 'Source and target are the same node — pick two different nodes.' });
      }
      if (code === 'URN_NOT_QUALIFIED') {
        return fail(400, {
          ...submitted,
          error: 'That doesn’t look like a fully-qualified node reference. Use a node id or a hrn:node:… URN (copy it from the node’s page).',
        });
      }
      if (code === 'NODE_NOT_FOUND') {
        // The server says which one ("Source node not found" / "Target node not found").
        return fail(404, { ...submitted, error: `${extractGqlError(e, 'Node not found')}.` });
      }
      return fail(500, { ...submitted, error: extractGqlError(e, 'Merge failed.') });
    }
  },
};
