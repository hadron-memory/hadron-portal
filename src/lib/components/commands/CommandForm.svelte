<script lang="ts">
  // #375/#395 — generic command-page form. Renders a declarative list of
  // {@link CommandField}s as a POST form with a submit button, progressively
  // enhanced so the page's `form` action-data updates in place (the per-command
  // result renders alongside, owned by the page). The field VALUES are bindable
  // so a page can prefill from a deep link and disable submit until required
  // fields are filled. Inputs are rendered one-way (value/checked + change
  // handlers) rather than `bind:`, because the value type is a union
  // (string | string[] | boolean) that a single `bind:` can't satisfy.
  import type { Action } from 'svelte/action';
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { t } from '$lib/i18n/t';
  import { missingRequired, defaultValue, type CommandField, type CommandFieldValue } from './command-field';

  let {
    fields,
    values = $bindable({}),
    action = '?/run',
    submitLabel = t('commands.form.run', 'Run'),
    busy = $bindable(false),
    enhanceAction = null,
    errors = {},
    onValueChange = () => {},
  }: {
    fields: CommandField[];
    values?: Record<string, CommandFieldValue>;
    action?: string;
    submitLabel?: string;
    busy?: boolean;
    enhanceAction?: Action<HTMLFormElement> | null;
    errors?: Record<string, unknown>;
    onValueChange?: (values: Record<string, CommandFieldValue>) => void;
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

  function setValue(name: string, value: CommandFieldValue) {
    values[name] = value;
    onValueChange(values);
  }

  function toggleMulti(name: string, option: string, checked: boolean) {
    const current = asSet(values[name]);
    setValue(name, checked ? [...current, option] : current.filter((o) => o !== option));
  }

  function fallbackEnhance(node: HTMLFormElement) {
    return enhance(node, () => {
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
    });
  }

  const formEnhance = $derived(enhanceAction ?? fallbackEnhance);
  const errorFor = (name: string): string | null => {
    const fieldErrors = errors[name];
    if (Array.isArray(fieldErrors)) return fieldErrors[0] ?? null;
    if (fieldErrors && typeof fieldErrors === 'object') {
      const nested = fieldErrors as { _errors?: unknown };
      if (Array.isArray(nested._errors)) return nested._errors[0]?.toString() ?? null;
    }
    return null;
  };
  const helpId = (name: string) => `cmd-${name}-help`;
  const errorId = (name: string) => `cmd-${name}-error`;
  const describedBy = (field: CommandField): string | undefined => {
    const ids = [];
    if (field.help) ids.push(helpId(field.name));
    if (errorFor(field.name)) ids.push(errorId(field.name));
    return ids.length > 0 ? ids.join(' ') : undefined;
  };

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';
</script>

{#snippet labelText(f: CommandField)}{f.label}{#if !f.required}<span class="text-zinc-500"> {t('commands.form.optional', '(optional)')}</span>{/if}{/snippet}

<form
  method="POST"
  {action}
  use:formEnhance
  class="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
  novalidate
>
  {#if values._kind !== undefined}
    <input type="hidden" name="_kind" value={asText(values._kind)} />
  {/if}
  {#each fields as field (field.name)}
    <div>
      {#if field.kind === 'checkbox'}
        <label class="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            name={field.name}
            value="true"
            checked={values[field.name] === true}
            onchange={(e) => setValue(field.name, e.currentTarget.checked)}
            aria-invalid={!!errorFor(field.name)}
            aria-describedby={describedBy(field)}
            class="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-900"
          />
          {field.label}
        </label>
        {#if field.help}<p id={helpId(field.name)} class="mt-1 ml-6 text-xs text-zinc-500">{field.help}</p>{/if}
        {#if errorFor(field.name)}
          <p id={errorId(field.name)} role="alert" class="mt-1 ml-6 text-xs text-red-600 dark:text-red-400">{errorFor(field.name)}</p>
        {/if}
      {:else}
        <!-- multiselect has no single input to point at → a group <span>;
             every other kind gets a real <label for> for a11y association. -->
        {#if field.kind === 'multiselect'}
          <span class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{@render labelText(field)}</span>
        {:else}
          <label for={`cmd-${field.name}`} class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{@render labelText(field)}</label>
        {/if}

        {#if field.kind === 'select'}
          <select
            id={`cmd-${field.name}`}
            name={field.name}
            value={asText(values[field.name])}
            onchange={(e) => setValue(field.name, e.currentTarget.value)}
            aria-invalid={!!errorFor(field.name)}
            aria-describedby={describedBy(field)}
            class="{inputClass} {errorFor(field.name) ? 'border-red-500 focus:border-red-500' : ''}"
          >
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
                  aria-invalid={!!errorFor(field.name)}
                  aria-describedby={describedBy(field)}
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
            oninput={(e) => setValue(field.name, e.currentTarget.value)}
            placeholder={field.placeholder}
            aria-invalid={!!errorFor(field.name)}
            aria-describedby={describedBy(field)}
            class="{inputClass}{field.kind === 'urn' ? ' font-mono' : ''} {errorFor(field.name) ? 'border-red-500 focus:border-red-500' : ''}"
          />
        {/if}

        {#if field.help}
          <p id={helpId(field.name)} class="mt-1 text-xs text-zinc-500">{field.help}</p>
        {/if}
        {#if errorFor(field.name)}
          <p id={errorId(field.name)} role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{errorFor(field.name)}</p>
        {/if}
      {/if}
    </div>
  {/each}

  <button
    type="submit"
    disabled={!canSubmit}
    class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
  >
    {busy ? t('commands.form.running', 'Running…') : submitLabel}
  </button>
</form>
