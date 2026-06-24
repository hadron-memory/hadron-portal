<script lang="ts">
  // #375/#395 — generic command-page form. Renders a declarative list of
  // {@link CommandField}s as a POST form with a submit button, progressively
  // enhanced so the page's `form` action-data updates in place (the per-command
  // result renders alongside, owned by the page). The field VALUES are bindable
  // so a page can prefill from a deep link (?user=…&resource=…) and so the
  // submit button can disable until required fields are filled.
  import { enhance } from '$app/forms';
  import { missingRequired, type CommandField } from './command-field';

  let {
    fields,
    values = $bindable({}),
    action = '?/run',
    submitLabel = 'Run',
    busy = $bindable(false),
  }: {
    fields: CommandField[];
    values?: Record<string, string>;
    action?: string;
    submitLabel?: string;
    busy?: boolean;
  } = $props();

  // Seed any field not present in `values` so the bound inputs are controlled
  // from first render (avoids undefined → '' warnings on the first keystroke).
  $effect(() => {
    for (const f of fields) if (values[f.name] === undefined) values[f.name] = '';
  });

  const canSubmit = $derived(!busy && missingRequired(fields, values).length === 0);

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';
</script>

<form
  method="POST"
  {action}
  use:enhance={() => {
    busy = true;
    // Keep the typed values on screen while the result renders (don't reset).
    return async ({ update }) => {
      await update({ reset: false });
      busy = false;
    };
  }}
  class="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
>
  {#each fields as field (field.name)}
    <div>
      <label
        for={`cmd-${field.name}`}
        class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        {field.label}
        {#if !field.required}<span class="text-zinc-500">(optional)</span>{/if}
      </label>

      {#if field.kind === 'select'}
        <select id={`cmd-${field.name}`} name={field.name} bind:value={values[field.name]} class={inputClass}>
          {#each field.options ?? [] as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      {:else}
        <input
          id={`cmd-${field.name}`}
          name={field.name}
          type="text"
          autocomplete="off"
          spellcheck="false"
          bind:value={values[field.name]}
          placeholder={field.placeholder}
          class="{inputClass}{field.kind === 'urn' ? ' font-mono' : ''}"
        />
      {/if}

      {#if field.help}
        <p class="mt-1 text-xs text-zinc-500">{field.help}</p>
      {/if}
    </div>
  {/each}

  <button
    type="submit"
    disabled={!canSubmit}
    class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
  >
    {busy ? 'Running…' : submitLabel}
  </button>
</form>
