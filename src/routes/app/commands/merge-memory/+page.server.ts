import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { MERGE_MEMORIES_MUTATION } from '$lib/server/queries';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { t } from '$lib/i18n/t';
import type { Memory } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// #396 — "Merge memory" command page. Web equivalent of the CLI `hadron memory
// merge`: empties a source memory into a target, backed by mergeMemories. Sibling
// of merge-node (#395) — same framework, the memory-level merge.

const COMMAND = {
  id: 'merge-memory',
  title: t('commands.merge-memory.title', 'Merge memory'),
  description: t(
    'commands.merge-memory.description',
    'Empty a source memory into a target. Source nodes whose loc collides with a target node are folded in (per the field strategy below); the rest move over unchanged. The source ends up empty.',
  ),
};

// NodeMergeField enum (hadron-server) — the per-field fold strategy for nodes
// whose loc collides in the target. Local (not exported — SvelteKit only allows
// load/actions/etc. from a +page.server.ts).
const MERGE_FIELDS = ['CONTENT', 'ABSTRACT', 'DESCRIPTION', 'TAGS', 'DATA', 'PROPERTIES', 'EDGES'] as const;

export const load: PageServerLoad = ({ url }) => ({
  command: COMMAND,
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
    // Dedupe before the length check so duplicate/tampered entries can't inflate
    // the count past MERGE_FIELDS.length and flip the "all selected" test.
    const include = [...new Set(fd.getAll('include').map(String))].filter(
      (f): f is (typeof MERGE_FIELDS)[number] => (MERGE_FIELDS as readonly string[]).includes(f),
    );
    const deleteSourceMem = fd.get('deleteSourceMem') === 'true';

    const submitted = { source, target, include, deleteSourceMem };

    if (!source || !target) {
      return fail(400, {
        ...submitted,
        error: t('commands.merge-memory.error.missing', 'Enter both a source and a target memory.'),
      });
    }
    // Fast-path the obvious identical-ref case — saves a round-trip. The server
    // still catches two *different* refs that resolve to the same memory
    // (MERGE_SOURCE_EQUALS_TARGET), which this string check can't see.
    if (source === target) {
      return fail(400, {
        ...submitted,
        error: t('commands.merge-memory.error.same', 'Source and target are the same memory — pick two different memories.'),
      });
    }

    // Only omit `include` when EVERY field is selected (server's "omitted = all").
    // Otherwise send the explicit selection, empty array included.
    const includeArg = include.length === MERGE_FIELDS.length ? undefined : include;

    try {
      const { mergeMemories } = await gqlClient(locals.token).request<{
        mergeMemories: Pick<Memory, 'id' | 'urn' | 'name'>;
      }>(
        MERGE_MEMORIES_MUTATION,
        { input: { source, target, include: includeArg, deleteSourceMem } },
      );
      return { ...submitted, result: mergeMemories };
    } catch (e) {
      const code = extractGqlErrorCode(e);
      const message = extractGqlError(e, t('commands.merge-memory.error.failed', 'Merge failed.'));
      if (code === 'FORBIDDEN') {
        return fail(403, {
          ...submitted,
          error: t('commands.merge-memory.error.forbidden', 'You need write access to both memories (and, to delete the source, you must be its owner or an org admin).'),
        });
      }
      if (code === 'MERGE_SOURCE_EQUALS_TARGET') {
        return fail(400, {
          ...submitted,
          error: t('commands.merge-memory.error.same', 'Source and target are the same memory — pick two different memories.'),
        });
      }
      if (code === 'UNSUPPORTED_MEMORY_CLASS') {
        return fail(400, { ...submitted, error: `${message} ${t('commands.merge-memory.error.unsupported-class', '(system and app memories can’t be merged.)')}` });
      }
      if (code === 'ENCRYPTED_MEMORY_MERGE_UNSUPPORTED') {
        return fail(400, {
          ...submitted,
          error: t('commands.merge-memory.error.encrypted', 'Encrypted memories can’t be merged yet.'),
        });
      }
      if (code === 'URN_NOT_QUALIFIED') {
        return fail(400, {
          ...submitted,
          error: t('commands.merge-memory.error.unqualified', 'That doesn’t look like a fully-qualified memory reference. Use a memory id or a hrn:memory:… URN (copy it from the memory’s page).'),
        });
      }
      // mergeMemories doesn't map a missing memory to a clean code (unlike
      // mergeNodes); resolveMemoryRef throws a bare "MEMORY_NOT_FOUND: <id>".
      if (/MEMORY_NOT_FOUND/.test(message)) {
        return fail(404, {
          ...submitted,
          error: t('commands.merge-memory.error.not-found', 'Source or target memory not found — check the URN.'),
        });
      }
      return fail(500, { ...submitted, error: message });
    }
  },
};
