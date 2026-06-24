<script lang="ts">
  // #375/#395 — generic command-page form. Renders a declarative list of
  // {@link CommandField}s as a POST form with a submit button, progressively
  // enhanced so the page's `form` action-data updates in place (the per-command
  // result renders alongside, owned by the page). The field VALUES are bindable
  // so a page can prefill from a deep link and disable submit until required
  // fields are filled. Inputs are rendered one-way (value/checked + change
  // handlers) rather than `bind:`, because the value type is a union
  // (string | string[] | boolean) that a single `bind:` can't satisfy.
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { missingRequired, defaultValue, type CommandField, type CommandFieldValue } from './command-field';

  let {
    fields,
    values = $bindable({}),
    action = '?/run',
    submitLabel = 'Run',
    busy = $bindable(false),
  }: {
    fields: CommandField[];
    values?: Record<string, CommandFieldValue>;
    action?: string;
    submitLabel?: string;
    busy?: boolean;
  } = $props();

  // Seed any field not present in `values` at init (NOT in an $effect, which
  // runs after the first render — that would flash an uncontrolled input).
  // Runs once on mount; `fields` is a static schema per command page. untrack
  // marks the intentional read-initial-value-only (silences state_referenced_locally).
  untrack(() => {
    for (const f of fields) if (values[f.name] === undefined) values[f.name] = defaultValue(f);
  });

  const canSubmit = $derived(!busy && missingRequired(fields, values).length === 0);

  // Typed accessors — `values[name]` is a union, so narrow per render site.
  const asText = (v: CommandFieldValue | undefined): string =>
    typeof v === 'string' ? v : '';
  const asSet = (v: CommandFieldValue | undefined): string[] =>
    Array.isArray(v) ? v : [];

  function toggleMulti(name: string, option: string, checked: boolean) {
    const current = asSet(values[name]);
    values[name] = checked ? [...current, option] : current.filter((o) => o !== option);
  }

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';
</script>

<form
  method="POST"
  {action}
  use:enhance={() => {
    busy = true;
    // Keep the typed values on screen while the result renders (don't reset).
    // try/finally so a thrown update() (network error, abort) still clears busy
    // — otherwise the submit button would stay disabled forever.
    return async ({ update }) => {
      try {
        await update({ reset: false });
      } finally {
        busy = false;
      }
    };
  }}
  class="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
>
  {#each fields as field (field.name)}
    <div>
      {#if field.kind === 'checkbox'}
        <label class="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            name={field.name}
            value="true"
            checked={values[field.name] === true}
            onchange={(e) => (values[field.name] = e.currentTarget.checked)}
            class="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-900"
          />
          {field.label}
        </label>
        {#if field.help}<p class="mt-1 ml-6 text-xs text-zinc-500">{field.help}</p>{/if}
      {:else}
        <span class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {field.label}
          {#if !field.required}<span class="text-zinc-500">(optional)</span>{/if}
        </span>

        {#if field.kind === 'select'}
          <select id={`cmd-${field.name}`} name={field.name} value={asText(values[field.name])} onchange={(e) => (values[field.name] = e.currentTarget.value)} class={inputClass}>
            {#each field.options ?? [] as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        {:else if field.kind === 'multiselect'}
          <div class="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            {#each field.options ?? [] as opt (opt.value)}
              <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  name={field.name}
                  value={opt.value}
                  checked={asSet(values[field.name]).includes(opt.value)}
                  onchange={(e) => toggleMulti(field.name, opt.value, e.currentTarget.checked)}
                  class="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-900"
                />
                {opt.label}
              </label>
            {/each}
          </div>
        {:else}
          <input
            id={`cmd-${field.name}`}
            name={field.name}
            type="text"
            autocomplete="off"
            spellcheck="false"
            value={asText(values[field.name])}
            oninput={(e) => (values[field.name] = e.currentTarget.value)}
            placeholder={field.placeholder}
            class="{inputClass}{field.kind === 'urn' ? ' font-mono' : ''}"
          />
        {/if}

        {#if field.help}
          <p class="mt-1 text-xs text-zinc-500">{field.help}</p>
        {/if}
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
