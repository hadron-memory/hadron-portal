import { fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { MERGE_NODES_MUTATION } from '$lib/server/queries';
import { extractGqlError, extractGqlErrorCode, extractGqlErrorExtensions } from '$lib/server/gqlError';
import { includeRefusalOf, includeRefusalText } from '$lib/server/include-refusal';
import { commentMergeRefusal } from '$lib/comments';
import { t } from '$lib/i18n/t';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { mergeNodeFields, mergeNodeSchema } from './schema';

const mergeNodeFormAdapter = zod4(mergeNodeSchema);
type MergeNodeForm = Infer<typeof mergeNodeSchema, 'zod4'>;

// #395 — "Merge node" command page. Web equivalent of the CLI `hadron node
// merge`: folds a source node into a target, backed by the mergeNodes mutation.
// The second consumer of the command-page framework — and the first MUTATION
// (vs. the read-only access check), exercising the checkbox + multiselect kinds.

// Getters (not eager `t()` values): re-evaluate per request when `command` is
// serialized in load(), so a future locale-aware t() isn't frozen to the
// module's startup locale.
const COMMAND = {
  id: 'merge-node',
  get title() {
    return t('commands.merge-node.title', 'Merge node');
  },
  get description() {
    return t(
      'commands.merge-node.description',
      'Fold a source node into a target node. The target survives; selected fields are merged in (text concatenated, tags unioned, data/properties shallow-merged, edges re-pointed).',
    );
  },
};

// NodeMergeField enum (hadron-server) — the foldable fields. Local (not
// exported): a SvelteKit +page.server.ts may only export load/actions/etc.
const MERGE_FIELDS = mergeNodeFields;

export const load: PageServerLoad = async ({ url }) => {
  const prefill = {
    source: (url.searchParams.get('source') ?? '').trim(),
    target: (url.searchParams.get('target') ?? '').trim(),
    include: [...MERGE_FIELDS],
    deleteSource: false,
  };
  return {
    command: COMMAND,
    // Deep-link prefill (e.g. ?source=…&target=…).
    prefill,
    form: await superValidate<MergeNodeForm>(prefill, mergeNodeFormAdapter, { errors: false }),
  };
};

export const actions: Actions = {
  run: async ({ request, locals }) => {
    const form = await superValidate<MergeNodeForm>(
      await request.formData(),
      mergeNodeFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const { source, target, deleteSource } = form.data;
    const include = [...new Set(form.data.include)];
    // Fast-path the obvious identical-ref case — saves a round-trip. The server
    // still catches two *different* refs that resolve to the same node
    // (MERGE_SOURCE_EQUALS_TARGET), which this string check can't see.
    if (source === target) {
      return message(
        form,
        {
          type: 'error',
          text: t('commands.merge-node.error.same', 'Source and target are the same node — pick two different nodes.'),
        },
        { status: 400 },
      );
    }

    // Only omit `include` when EVERY field is selected (server's "omitted =
    // all"). Otherwise pass the explicit selection — including an empty array,
    // so unchecking everything merges nothing rather than surprisingly all.
    const includeArg = include.length === MERGE_FIELDS.length ? undefined : include;

    try {
      const { mergeNodes } = await gqlClient(locals.token).request<{
        mergeNodes: Pick<MemoryNode, 'id' | 'memoryId' | 'loc' | 'name'>;
      }>(
        MERGE_NODES_MUTATION,
        { input: { source, target, include: includeArg, deleteSource } },
      );
      return {
        result: mergeNodes,
        ...message(form, { type: 'success', text: t('commands.merge-node.success', 'Node merged.') }),
      };
    } catch (e) {
      // portal#1142 S2b: an include refusal merged nothing; say so, without
      // offering the kept selections as a draft.
      const include = includeRefusalOf(e);
      if (include) return message(form, { type: 'error', text: includeRefusalText(include, 'merge') }, { status: 400 });
      const code = extractGqlErrorCode(e);
      // hadron-server#1682: threads that can't follow the merge get fixed copy.
      const commentRefusal = commentMergeRefusal(code, extractGqlErrorExtensions(e), 'node');
      if (commentRefusal) {
        return message(form, { type: 'error', text: commentRefusal.text }, { status: commentRefusal.status });
      }
      if (code === 'FORBIDDEN') {
        return message(form, {
          type: 'error',
          text: t('commands.merge-node.error.forbidden', 'You need write access to the target node (and the source, when deleting it or moving edges) to merge.'),
        }, { status: 403 });
      }
      if (code === 'MERGE_SOURCE_EQUALS_TARGET') {
        return message(form, {
          type: 'error',
          text: t('commands.merge-node.error.same', 'Source and target are the same node — pick two different nodes.'),
        }, { status: 400 });
      }
      if (code === 'URN_NOT_QUALIFIED') {
        return message(form, {
          type: 'error',
          text: t('commands.merge-node.error.unqualified', 'That doesn’t look like a fully-qualified node reference. Use a node id or a hrn:node:… URN (copy it from the node’s page).'),
        }, { status: 400 });
      }
      if (code === 'NODE_NOT_FOUND') {
        // The server says which one ("Source node not found" / "Target node not found").
        return message(
          form,
          {
            type: 'error',
            text: `${extractGqlError(e, t('commands.merge-node.error.not-found', 'Node not found'))}.`,
          },
          { status: 404 },
        );
      }
      return message(
        form,
        { type: 'error', text: extractGqlError(e, t('commands.merge-node.error.failed', 'Merge failed.')) },
        { status: 500 },
      );
    }
  },
};
