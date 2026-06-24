<script lang="ts">
  // #396 — "Merge memory": empties a source memory into a target. Sibling of
  // merge-node (#395) at the memory level. Reuses the command-page framework's
  // multiselect (include strategy) + checkbox (deleteSourceMem) kinds.
  import { untrack } from 'svelte';
  import CommandForm from '$lib/components/commands/CommandForm.svelte';
  import type { CommandField, CommandFieldValue } from '$lib/components/commands/command-field';
  import Urn from '$lib/components/Urn.svelte';
  import type { ActionData, PageData } from './$types';

  let { form, data }: { form: ActionData; data: PageData } = $props();

  // Per-field fold strategy for colliding-loc nodes (hadron-server NodeMergeField).
  const MERGE_FIELD_OPTIONS = [
    { value: 'CONTENT', label: 'Content' },
    { value: 'ABSTRACT', label: 'Abstract' },
    { value: 'DESCRIPTION', label: 'Description' },
    { value: 'TAGS', label: 'Tags' },
    { value: 'DATA', label: 'Data' },
    { value: 'PROPERTIES', label: 'Properties' },
    { value: 'EDGES', label: 'Edges' },
  ];

  // Seed once at mount (see access-check for the untrack rationale).
  let values = $state<Record<string, CommandFieldValue>>(
    untrack(() => ({
      source: form?.source ?? data.prefill.source,
      target: form?.target ?? data.prefill.target,
      include: form?.include ?? MERGE_FIELD_OPTIONS.map((o) => o.value),
      deleteSourceMem: form?.deleteSourceMem ?? false,
    })),
  );

  const fields: CommandField[] = [
    {
      name: 'source',
      label: 'Source memory',
      kind: 'urn',
      required: true,
      placeholder: 'hrn:memory:org::slug  or a memory id',
      help: 'The memory to empty. Its nodes move into the target.',
    },
    {
      name: 'target',
      label: 'Target memory',
      kind: 'urn',
      required: true,
      placeholder: 'hrn:memory:org::slug  or a memory id',
      help: 'The surviving memory. Nodes with no loc collision move over unchanged.',
    },
    {
      name: 'include',
      label: 'Collision fold strategy',
      kind: 'multiselect',
      options: MERGE_FIELD_OPTIONS,
      help: 'For source nodes whose loc already exists in the target — which fields to fold in. Leave all selected to fold everything.',
    },
    {
      name: 'deleteSourceMem',
      label: 'Delete the source memory after merging',
      kind: 'checkbox',
      help: 'Removes the (now-empty) source memory once its nodes have moved.',
    },
  ];

  const result = $derived(form && 'result' in form ? form.result : null);
  const error = $derived(form && 'error' in form ? form.error : null);
</script>

<CommandForm {fields} bind:values action="?/run" submitLabel="Merge memory" />

{#if error}
  <div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
    {error}
  </div>
{/if}

{#if result}
  <section class="space-y-2 rounded-xl border border-green-300 bg-green-50 p-5 dark:border-green-800 dark:bg-green-950">
    <p class="text-sm text-green-800 dark:text-green-300">
      Merged into <span class="font-medium">{result.name}</span>.
    </p>
    {#if result.urn}<Urn value={result.urn} type="memory" />{/if}
    <a
      href={`/app/memories/${result.id}`}
      class="block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
    >
      View the merged memory →
    </a>
  </section>
{/if}
