<script lang="ts">
  // #588 (server #725): editor for a node's typed `properties` record.
  //
  // Two modes, chosen by the caller via `declared`:
  // - A declared collection (the node's objectType names an entry in the
  //   memory schema): one typed input per declared field — text / number /
  //   datetime / boolean / enum — with required markers. Undeclared keys
  //   already present on the node are preserved through the round-trip,
  //   shown read-only, and individually REMOVABLE (they're legal when the
  //   collection isn't strict; a strict collection rejects them server-side,
  //   so removal is the migration path onto a strict type — PR #613 review).
  // - No declared collection (free-form objectType, or no schema): a raw
  //   JSON-object textarea, mirroring the node-detail Data tab's editor.
  //
  // The component reads/writes ONE serialized JSON string (`value`, '' = no
  // properties) so the parent form can round-trip it through a hidden input —
  // the same pattern as the edit page's edges payload. Client-side validation
  // here is advisory (it drives `invalid` so the parent can disable submit);
  // the server's schema enforcement is the source of truth.
  //
  // Callers should re-mount the component when the declared collection
  // changes ({#key objectType}) so field state re-seeds from `value`.
  import { untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  import type { MemorySchemaObjectType } from '$lib/schema/memory-schema';

  let {
    declared = null,
    value = $bindable(''),
    invalid = $bindable(false),
    idPrefix = 'properties',
  }: {
    declared?: MemorySchemaObjectType | null;
    value?: string;
    invalid?: boolean;
    idPrefix?: string;
  } = $props();

  function parseObject(raw: string): Record<string, unknown> {
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  const declaredFields = $derived(declared ? Object.entries(declared.fields) : []);

  // ── Typed mode state ─────────────────────────────────────────────────
  // Seeded once from `value`; the caller re-mounts on objectType change.
  const initial = untrack(() => parseObject(value));
  const declaredNames = untrack(() => new Set(Object.keys(declared?.fields ?? {})));

  function seedText(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  }

  let fieldText = $state<Record<string, string>>(
    untrack(() => Object.fromEntries(
      Object.keys(declared?.fields ?? {}).map((name) => [name, seedText(initial[name])]),
    )),
  );

  // Undeclared keys present on the node — preserved verbatim on save unless
  // the user removes them (removal unblocks migrating onto a strict
  // collection, whose server validation rejects unknown keys).
  let extras = $state<Record<string, unknown>>(untrack(() => Object.fromEntries(
    Object.entries(initial).filter(([k]) => !declaredNames.has(k)),
  )));
  const extraEntries = $derived(Object.entries(extras));

  function removeExtra(name: string) {
    const next = { ...extras };
    delete next[name];
    extras = next;
    syncTyped();
  }

  function fieldError(name: string): string | null {
    if (!declared) return null;
    const field = declared.fields[name];
    const raw = (fieldText[name] ?? '').trim();
    if (!raw) return field.required ? t('properties-editor.error.required', 'Required.') : null;
    switch (field.type) {
      case 'number':
        // Number.isFinite (not just !NaN): '1e309' coerces to Infinity, which
        // JSON.stringify would serialize as null — silent payload corruption
        // (PR #613 review).
        return Number.isFinite(Number(raw)) ? null : t('properties-editor.error.not-a-number', 'Not a number.');
      case 'datetime':
        return Number.isNaN(Date.parse(raw))
          ? t('properties-editor.error.not-a-datetime', 'Not a valid date/time (use ISO-8601, e.g. 2026-07-20T12:00:00Z).')
          : null;
      default:
        return null;
    }
  }

  function typedValue(name: string): unknown {
    const field = declared!.fields[name];
    const raw = (fieldText[name] ?? '').trim();
    switch (field.type) {
      case 'number': return Number(raw);
      case 'boolean': return raw === 'true';
      default: return raw;
    }
  }

  function syncTyped() {
    const out: Record<string, unknown> = { ...extras };
    for (const name of Object.keys(declared?.fields ?? {})) {
      const raw = (fieldText[name] ?? '').trim();
      if (!raw) continue; // unset optional field → omit the key
      if (fieldError(name)) continue; // don't serialize an unparseable value
      out[name] = typedValue(name);
    }
    value = Object.keys(out).length > 0 ? JSON.stringify(out) : '';
  }

  const typedErrors = $derived(
    declared ? declaredFields.map(([name]) => fieldError(name)).filter((e): e is string => e !== null) : [],
  );

  // ── Free-form mode validation ────────────────────────────────────────
  const freeformError = $derived.by(() => {
    if (declared) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return t('properties-editor.error.not-an-object', 'Properties must be a JSON object.');
      }
      return null;
    } catch {
      return t('properties-editor.error.not-json', 'Not valid JSON.');
    }
  });

  $effect(() => {
    invalid = declared ? typedErrors.length > 0 : freeformError !== null;
  });

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';
</script>

{#if declared}
  <div class="space-y-3">
    {#each declaredFields as [name, field] (name)}
      {@const error = fieldError(name)}
      {@const inputId = `${idPrefix}-${name}`}
      <div>
        <label for={inputId} class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
          <span class="font-mono">{name}</span>
          {#if field.required}<span class="text-red-500" aria-hidden="true">*</span>{/if}
          <span class="ml-1 text-zinc-400 dark:text-zinc-500">({field.type})</span>
        </label>
        {#if field.type === 'enum'}
          <select id={inputId} bind:value={fieldText[name]} onchange={syncTyped}
            aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined}
            class="{inputClass} {error ? 'border-red-500 focus:border-red-500' : ''}">
            <option value="">—</option>
            {#each field.values ?? [] as v (v)}
              <option value={v}>{v}</option>
            {/each}
          </select>
        {:else if field.type === 'boolean'}
          <select id={inputId} bind:value={fieldText[name]} onchange={syncTyped}
            aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined}
            class="{inputClass} {error ? 'border-red-500 focus:border-red-500' : ''}">
            <option value="">—</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        {:else}
          <!-- number uses a TEXT input on purpose: Svelte coerces
               type="number" bindings to number|null, which breaks string
               state (review:number-input-bind-coerces); validation runs on
               the string instead. -->
          <input id={inputId} type="text"
            inputmode={field.type === 'number' ? 'decimal' : undefined}
            placeholder={field.type === 'datetime' ? '2026-07-20T12:00:00Z' : undefined}
            bind:value={fieldText[name]} oninput={syncTyped}
            aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined}
            class="{inputClass} {error ? 'border-red-500 focus:border-red-500' : ''}" />
        {/if}
        {#if error}
          <p id="{inputId}-error" class="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
        {:else if field.description}
          <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{field.description}</p>
        {/if}
      </div>
    {/each}

    {#if extraEntries.length > 0}
      <div>
        <p class="mb-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t('properties-editor.extras.label', 'Other properties')}
          <span class="text-zinc-400 dark:text-zinc-500">{t('properties-editor.extras.note', '(not declared for this object type — kept on save unless removed)')}</span>
        </p>
        <div class="space-y-1">
          {#each extraEntries as [name, extraValue] (name)}
            <div class="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 font-mono text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <span class="shrink-0">{name}:</span>
              <span class="min-w-0 truncate">{JSON.stringify(extraValue)}</span>
              <button type="button" onclick={() => removeExtra(name)}
                aria-label={t('properties-editor.extras.remove', 'Remove property') + ` ${name}`}
                title={t('properties-editor.extras.remove', 'Remove property')}
                class="ml-auto shrink-0 text-red-400 hover:text-red-300">&times;</button>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{:else}
  <div>
    <textarea id={idPrefix} rows="6" bind:value spellcheck="false"
      aria-invalid={!!freeformError}
      aria-describedby={freeformError ? `${idPrefix}-error` : `${idPrefix}-hint`}
      placeholder={'{\n  "key": "value"\n}'}
      class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder-zinc-600 {freeformError ? 'border-red-500 focus:border-red-500' : ''}"
      style="resize: vertical;"></textarea>
    {#if freeformError}
      <p id="{idPrefix}-error" class="mt-1 text-xs text-red-600 dark:text-red-400">{freeformError}</p>
    {:else}
      <p id="{idPrefix}-hint" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('properties-editor.hint.freeform', 'Free-form JSON object. Leave empty for none.')}</p>
    {/if}
  </div>
{/if}
