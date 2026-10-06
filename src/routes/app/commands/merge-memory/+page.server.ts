import { fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { MERGE_MEMORIES_MUTATION } from '$lib/server/queries';
import { extractGqlError, extractGqlErrorCode, extractGqlErrorExtensions } from '$lib/server/gqlError';
import { commentMergeRefusal } from '$lib/comments';
import { t } from '$lib/i18n/t';
import type { Memory } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { mergeMemoryFields, mergeMemorySchema } from './schema';

const mergeMemoryFormAdapter = zod4(mergeMemorySchema);
type MergeMemoryForm = Infer<typeof mergeMemorySchema, 'zod4'>;

// #396 — "Merge memory" command page. Web equivalent of the CLI `hadron memory
// merge`: empties a source memory into a target, backed by mergeMemories. Sibling
// of merge-node (#395) — same framework, the memory-level merge.

// Getters (not eager `t()` values): re-evaluate per request when `command` is
// serialized in load(), so a future locale-aware t() isn't frozen to the
// module's startup locale.
const COMMAND = {
  id: 'merge-memory',
  get title() {
    return t('commands.merge-memory.title', 'Merge memory');
  },
  get description() {
    return t(
      'commands.merge-memory.description',
      'Empty a source memory into a target. Source nodes whose loc collides with a target node are folded in (per the field strategy below); the rest move over unchanged. The source ends up empty.',
    );
  },
};

// NodeMergeField enum (hadron-server) — the per-field fold strategy for nodes
// whose loc collides in the target. Local (not exported — SvelteKit only allows
// load/actions/etc. from a +page.server.ts).
const MERGE_FIELDS = mergeMemoryFields;

export const load: PageServerLoad = async ({ url }) => {
  const prefill = {
    source: (url.searchParams.get('source') ?? '').trim(),
    target: (url.searchParams.get('target') ?? '').trim(),
    include: [...MERGE_FIELDS],
    deleteSourceMem: false,
  };
  return {
    command: COMMAND,
    prefill,
    form: await superValidate<MergeMemoryForm>(prefill, mergeMemoryFormAdapter, { errors: false }),
  };
};

export const actions: Actions = {
  run: async ({ request, locals }) => {
    const form = await superValidate<MergeMemoryForm>(
      await request.formData(),
      mergeMemoryFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const { source, target, deleteSourceMem } = form.data;
    const include = [...new Set(form.data.include)];
    // Fast-path the obvious identical-ref case — saves a round-trip. The server
    // still catches two *different* refs that resolve to the same memory
    // (MERGE_SOURCE_EQUALS_TARGET), which this string check can't see.
    if (source === target) {
      return message(
        form,
        {
          type: 'error',
          text: t('commands.merge-memory.error.same', 'Source and target are the same memory — pick two different memories.'),
        },
        { status: 400 },
      );
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
      return {
        result: mergeMemories,
        ...message(form, { type: 'success', text: t('commands.merge-memory.success', 'Memory merged.') }),
      };
    } catch (e) {
      const code = extractGqlErrorCode(e);
      const errorText = extractGqlError(e, t('commands.merge-memory.error.failed', 'Merge failed.'));
      // hadron-server#1682: threads that can't follow the merge get fixed copy.
      const commentRefusal = commentMergeRefusal(code, extractGqlErrorExtensions(e));
      if (commentRefusal) {
        return message(form, { type: 'error', text: commentRefusal.text }, { status: commentRefusal.status });
      }
      if (code === 'FORBIDDEN') {
        return message(form, {
          type: 'error',
          text: t('commands.merge-memory.error.forbidden', 'You need write access to both memories (and, to delete the source, you must be its owner or an org admin).'),
        }, { status: 403 });
      }
      if (code === 'MERGE_SOURCE_EQUALS_TARGET') {
        return message(form, {
          type: 'error',
          text: t('commands.merge-memory.error.same', 'Source and target are the same memory — pick two different memories.'),
        }, { status: 400 });
      }
      if (code === 'UNSUPPORTED_MEMORY_CLASS') {
        return message(form, {
          type: 'error',
          text: `${errorText} ${t('commands.merge-memory.error.unsupported-class', '(system and app memories can’t be merged.)')}`,
        }, { status: 400 });
      }
      if (code === 'ENCRYPTED_MEMORY_MERGE_UNSUPPORTED') {
        return message(form, {
          type: 'error',
          text: t('commands.merge-memory.error.encrypted', 'Encrypted memories can’t be merged yet.'),
        }, { status: 400 });
      }
      if (code === 'URN_NOT_QUALIFIED') {
        return message(form, {
          type: 'error',
          text: t('commands.merge-memory.error.unqualified', 'That doesn’t look like a fully-qualified memory reference. Use a memory id or a hrn:memory:… URN (copy it from the memory’s page).'),
        }, { status: 400 });
      }
      // mergeMemories doesn't map a missing memory to a clean code (unlike
      // mergeNodes); resolveMemoryRef throws a bare "MEMORY_NOT_FOUND: <id>".
      if (/MEMORY_NOT_FOUND/.test(errorText)) {
        return message(form, {
          type: 'error',
          text: t('commands.merge-memory.error.not-found', 'Source or target memory not found — check the URN.'),
        }, { status: 404 });
      }
      return message(form, { type: 'error', text: errorText }, { status: 500 });
    }
  },
};
