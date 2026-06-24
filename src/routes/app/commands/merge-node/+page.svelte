<script lang="ts">
  // #395 — "Merge node": folds a source node into a target. Second consumer of
  // the command-page framework, exercising the multiselect (include) + checkbox
  // (deleteSource) field kinds. Renders a link to the surviving target node.
  import { untrack } from 'svelte';
  import CommandForm from '$lib/components/commands/CommandForm.svelte';
  import type { CommandField, CommandFieldValue } from '$lib/components/commands/command-field';
  import type { ActionData, PageData } from './$types';

  let { form, data }: { form: ActionData; data: PageData } = $props();

  // The foldable fields (hadron-server NodeMergeField), with friendly labels.
  const MERGE_FIELD_OPTIONS = [
    { value: 'CONTENT', label: 'Content' },
    { value: 'ABSTRACT', label: 'Abstract' },
    { value: 'DESCRIPTION', label: 'Description' },
    { value: 'TAGS', label: 'Tags' },
    { value: 'DATA', label: 'Data' },
    { value: 'PROPERTIES', label: 'Properties' },
    { value: 'EDGES', label: 'Edges' },
  ];

  // Seed once at mount (see access-check for the untrack rationale). `include`
  // defaults to every field selected (the common "merge everything"); after a
  // submit it reflects the echoed selection.
  let values = $state<Record<string, CommandFieldValue>>(
    untrack(() => ({
      source: form?.source ?? data.prefill.source,
      target: form?.target ?? data.prefill.target,
      include: form?.include ?? MERGE_FIELD_OPTIONS.map((o) => o.value),
      deleteSource: form?.deleteSource ?? false,
    })),
  );

  const fields: CommandField[] = [
    {
      name: 'source',
      label: 'Source node',
      kind: 'urn',
      required: true,
      placeholder: 'hrn:node:org::memory::loc  or a node id',
      help: 'The node to fold in. Its selected fields are merged into the target.',
    },
    {
      name: 'target',
      label: 'Target node',
      kind: 'urn',
      required: true,
      placeholder: 'hrn:node:org::memory::loc  or a node id',
      help: 'The surviving node. Text is concatenated target-first; data/properties keep the target on key collisions.',
    },
    {
      name: 'include',
      label: 'Fields to merge',
      kind: 'multiselect',
      options: MERGE_FIELD_OPTIONS,
      help: 'Leave all selected to merge everything.',
    },
    {
      name: 'deleteSource',
      label: 'Delete the source node after merging',
      kind: 'checkbox',
      help: 'Hard-deletes the source once its fields are folded into the target.',
    },
  ];

  const result = $derived(form && 'result' in form ? form.result : null);
  const error = $derived(form && 'error' in form ? form.error : null);
</script>

<CommandForm {fields} bind:values action="?/run" submitLabel="Merge node" />

{#if error}
  <div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
    {error}
  </div>
{/if}

{#if result}
  <section class="space-y-2 rounded-xl border border-green-300 bg-green-50 p-5 dark:border-green-800 dark:bg-green-950">
    <p class="text-sm text-green-800 dark:text-green-300">
      Merged into <span class="font-medium">{result.name || result.loc}</span>.
    </p>
    <p class="font-mono text-xs text-green-700 dark:text-green-400">{result.loc}</p>
    <a
      href={`/app/memories/${result.memoryId}/nodes/${result.id}`}
      class="inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
    >
      View the merged node →
    </a>
  </section>
{/if}
