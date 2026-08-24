<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { AI_PROVIDERS, DEFAULT_MODELS } from '$lib/ai-config';
  import type { AiConfigOwnerType, AiServiceConfig, AIProvider } from '$lib/types';
  import { aiConfigStrings as s } from '$lib/i18n/ai-config-strings';
  import { t } from '$lib/i18n/t';
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from './table/DataTable.svelte';
  import {
    isValidConfigName,
    resolveKeyInput,
    resolveApiKeyAction,
    parseParamsText,
  } from './ai-config-manager';

  let {
    ownerType,
    ownerId,
    configs,
    canManage = false,
    allowTest = false,
  }: {
    ownerType: AiConfigOwnerType;
    ownerId: string;
    configs: AiServiceConfig[];
    canManage?: boolean;
    allowTest?: boolean;
  } = $props();

  const WELL_KNOWN = ['default', 'fast', 'frontier'];
  const REGIONS = [
    { value: 'us-east-1', label: 'us-east-1 (N. Virginia)' },
    { value: 'us-west-2', label: 'us-west-2 (Oregon)' },
    { value: 'eu-west-1', label: 'eu-west-1 (Ireland)' },
    { value: 'ap-northeast-1', label: 'ap-northeast-1 (Tokyo)' },
  ];

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';

  // ── Form state ──
  let formOpen = $state(false);
  let editId = $state<string | null>(null); // null ⇒ create
  let nameInput = $state('');
  let providerInput = $state<AIProvider>('anthropic');
  let modelInput = $state('');
  let apiKeyInput = $state('');
  let bedrockAccessKeyId = $state('');
  let bedrockSecretAccessKey = $state('');
  let bedrockRegion = $state('us-east-1');
  let enabledInput = $state(true);
  let removeKey = $state(false);
  let paramsText = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let testResult = $state<{
    ok: boolean;
    provider?: string;
    model?: string;
    reply?: string;
    error?: string;
  } | null>(null);
  let confirmDeleteId = $state<string | null>(null);

  const editing = $derived(editId ? (configs.find((c) => c.id === editId) ?? null) : null);
  const hasExistingKey = $derived(editing?.hasApiKey ?? false);
  const renamingWellKnown = $derived(
    !!editing && WELL_KNOWN.includes(editing.name) && nameInput.trim() !== editing.name,
  );

  function providerLabel(p: string): string {
    return AI_PROVIDERS.find((x) => x.value === p)?.label ?? p;
  }

  // #719 — the config list as the shared TanStack grid, replacing a stack of
  // bespoke cards. This component is used by THREE surfaces (an agent, an org's
  // integrations, an App's settings), so converting it here is what makes the
  // AI-provider list one thing rather than three that drift.
  //
  // ONE `listKey` across all three deliberately. The check on that
  // (review:saved-view-arrangement-not-position) warns about UNINTENDED
  // sharing between different slices; here the columns and the entity are
  // identical on every surface, so a reader who arranges them once should find
  // that arrangement again on the next — sharing is the feature, not an
  // accident.
  let configFilter = $state('');
  // ONE composer for the masked key text, read by both the accessor and the
  // cell (@copilot on #770). They had diverged: the accessor returned the raw
  // preview while the cell rendered bullets + preview, so sorting and the
  // `includesString` search disagreed with what was on screen — and a config
  // with `hasApiKey` but a null preview sorted as an empty string while
  // rendering eight bullets. Deriving both from one function is what stops
  // them drifting again.
  function maskedKey(c: AiServiceConfig): string {
    return c.hasApiKey ? `${'•'.repeat(8)}${c.apiKeyPreview ?? ''}` : s.noKey();
  }
  function configDateMs(iso: string | null | undefined): number | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    return isNaN(ms) ? null : ms;
  }
  const configColumns: PortalColumnDef<AiServiceConfig>[] = [
    { accessorKey: 'name', header: t('ai-config.column.name', 'Name'), enableHiding: false, size: 160 },
    {
      // The rendered label, not the raw enum: per the table-chrome convention a
      // derived column's accessor returns what is on screen, so sorting and the
      // search box agree with what the reader sees. Dates are the exception,
      // and they are handled below.
      accessorFn: (row) => providerLabel(row.provider),
      id: 'provider',
      header: t('ai-config.column.provider', 'Provider'),
      size: 150,
    },
    { accessorKey: 'model', header: t('ai-config.column.model', 'Model'), size: 200 },
    {
      accessorFn: (row) => (row.enabled ? s.enabledBadge() : s.disabledBadge()),
      id: 'enabled',
      header: t('ai-config.column.status', 'Status'),
      size: 110,
    },
    {
      // The RENDERED text, per the table-chrome convention: a derived column's
      // accessor returns what is on screen so sort and search agree with it.
      accessorFn: (row) => maskedKey(row),
      id: 'key',
      header: t('ai-config.column.key', 'API key'),
      size: 140,
    },
    // Numeric accessor per review:date-column-sorts-by-instant — a raw date
    // string reaches TanStack's alphanumeric comparator, which reads the digit
    // groups and ignores the offset, ordering by wall clock rather than instant.
    { accessorFn: (row) => configDateMs(row.createdAt), id: 'createdAt', header: t('ai-config.column.created', 'Created'), size: 170 },
    { id: 'actions', header: t('ai-config.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 170 },
  ];
  const configFmt: Record<string, (v: unknown) => string> = {
    createdAt: (v) => (v == null ? '—' : new Date(v as number).toLocaleString()),
  };
  const configTable = createSvelteTable<AiServiceConfig>({
    get data() {
      return configs;
    },
    columns: configColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return configFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      configFilter = typeof u === 'function' ? u(configFilter) : u;
    },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });

  function resetForm() {
    nameInput = '';
    providerInput = 'anthropic';
    modelInput = '';
    apiKeyInput = '';
    bedrockAccessKeyId = '';
    bedrockSecretAccessKey = '';
    bedrockRegion = 'us-east-1';
    enabledInput = true;
    removeKey = false;
    paramsText = '';
    error = null;
    testResult = null;
  }

  function openCreate() {
    resetForm();
    editId = null;
    formOpen = true;
  }

  function openEdit(c: AiServiceConfig) {
    resetForm();
    editId = c.id;
    nameInput = c.name;
    providerInput = c.provider;
    modelInput = c.model;
    enabledInput = c.enabled;
    bedrockRegion =
      (c.params && typeof c.params.bedrockRegion === 'string' && c.params.bedrockRegion) ||
      'us-east-1';
    paramsText = c.params ? JSON.stringify(c.params, null, 2) : '';
    formOpen = true;
  }

  function closeForm() {
    formOpen = false;
    editId = null;
    error = null;
    testResult = null;
  }

  async function post(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch('/api/ai-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok || body.error) throw new Error(body.error ?? 'Request failed');
    return body;
  }

  async function save() {
    const name = nameInput.trim();
    if (!isValidConfigName(name)) {
      error = s.invalidName();
      return;
    }
    if (!modelInput.trim()) {
      error = s.modelRequired();
      return;
    }
    const params = parseParamsText(paramsText);
    if (!params.ok) {
      error = params.error;
      return;
    }
    // Persist the bedrock region in params so the region dropdown round-trips
    // on a later edit — the masked list never returns the key, so the region
    // (also encoded into the key) can't be recovered from there. Server params
    // validation is passthrough, so the extra key is preserved untouched.
    const paramsValue =
      providerInput === 'bedrock' ? { ...params.value, bedrockRegion } : params.value;
    const enteredKey = resolveKeyInput({
      provider: providerInput,
      apiKey: apiKeyInput,
      bedrockAccessKeyId,
      bedrockSecretAccessKey,
      bedrockRegion,
    });

    busy = true;
    error = null;
    testResult = null;
    try {
      if (editId === null) {
        await post({
          action: 'create',
          ownerType,
          ownerId,
          name,
          provider: providerInput,
          model: modelInput.trim(),
          apiKey: enteredKey || undefined,
          params: paramsValue,
          enabled: enabledInput,
        });
      } else {
        const keyArg = resolveApiKeyAction({ removeKey, enteredKey });
        await post({
          action: 'update',
          id: editId,
          name,
          provider: providerInput,
          model: modelInput.trim(),
          params: paramsValue,
          enabled: enabledInput,
          ...keyArg,
        });
      }
      closeForm();
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to save configuration';
    } finally {
      busy = false;
    }
  }

  async function test() {
    const enteredKey = resolveKeyInput({
      provider: providerInput,
      apiKey: apiKeyInput,
      bedrockAccessKeyId,
      bedrockSecretAccessKey,
      bedrockRegion,
    });
    busy = true;
    error = null;
    testResult = null;
    try {
      let payload: Record<string, unknown>;
      if (enteredKey) {
        // Test the in-form values before saving.
        payload = {
          action: 'test',
          provider: providerInput,
          model: modelInput.trim(),
          apiKey: enteredKey,
        };
      } else if (editing && (ownerType === 'AGENT' || ownerType === 'APP')) {
        // Test a saved config — the server resolves the decrypted key.
        payload = {
          action: 'test',
          name: editing.name,
          provider: providerInput,
          model: modelInput.trim(),
          ...(ownerType === 'AGENT' ? { agentId: ownerId } : { appId: ownerId }),
        };
      } else {
        error = s.testNeedsKey();
        busy = false;
        return;
      }
      testResult = (await post(payload)) as {
        ok: boolean;
        provider?: string;
        model?: string;
        reply?: string;
        error?: string;
      };
    } catch (e) {
      error = e instanceof Error ? e.message : 'Test failed';
    } finally {
      busy = false;
    }
  }

  async function doDelete(id: string) {
    busy = true;
    error = null;
    try {
      await post({ action: 'delete', id });
      confirmDeleteId = null;
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to delete configuration';
    } finally {
      busy = false;
    }
  }
</script>

<section>
  <div class="mb-3 flex items-start justify-between gap-4">
    <div>
      <h2 class="font-semibold text-zinc-900 dark:text-white">{s.heading()}</h2>
      <p class="mt-0.5 text-sm text-zinc-500">{s.subheading()}</p>
      {#if ownerType === 'AGENT'}
        <p class="mt-1 text-xs text-zinc-400">{s.agentDefaultHint()}</p>
      {/if}
    </div>
    {#if canManage && !formOpen}
      <button
        type="button"
        onclick={openCreate}
        class="shrink-0 rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-600"
      >
        {s.addButton()}
      </button>
    {/if}
  </div>

  {#if error && !formOpen}
    <div
      class="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
    >
      {error}
    </div>
  {/if}

  <!-- Add / edit form -->
  {#if formOpen}
    <div
      class="mb-4 space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div>
        <label for="ac-name" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {s.nameLabel()}
        </label>
        <input
          id="ac-name"
          type="text"
          list="ac-name-options"
          bind:value={nameInput}
          placeholder="default"
          class={inputClass}
        />
        <datalist id="ac-name-options">
          {#each WELL_KNOWN as wk (wk)}<option value={wk}></option>{/each}
        </datalist>
        <p class="mt-1 text-xs text-zinc-400">{s.nameHint()}</p>
        {#if renamingWellKnown && editing}
          <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {s.renameWellKnownWarning(editing.name)}
          </p>
        {/if}
      </div>

      <div>
        <label for="ac-provider" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {s.providerLabel()}
        </label>
        <select
          id="ac-provider"
          bind:value={providerInput}
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        >
          {#each AI_PROVIDERS as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
        </select>
      </div>

      <div>
        <label for="ac-model" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {s.modelLabel()}
        </label>
        <input
          id="ac-model"
          type="text"
          bind:value={modelInput}
          placeholder={DEFAULT_MODELS[providerInput]}
          class={inputClass}
        />
      </div>

      {#if providerInput === 'bedrock'}
        <div>
          <label for="ac-bedrock-id" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            AWS Access Key ID
          </label>
          <input
            id="ac-bedrock-id"
            type="password"
            bind:value={bedrockAccessKeyId}
            placeholder={hasExistingKey ? s.keptKeyPlaceholder() : 'AKIA…'}
            class={inputClass}
          />
        </div>
        <div>
          <label for="ac-bedrock-secret" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            AWS Secret Access Key
          </label>
          <input
            id="ac-bedrock-secret"
            type="password"
            bind:value={bedrockSecretAccessKey}
            placeholder={hasExistingKey ? s.keptKeyPlaceholder() : ''}
            class={inputClass}
          />
        </div>
        <div>
          <label for="ac-bedrock-region" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            AWS Region
          </label>
          <select
            id="ac-bedrock-region"
            bind:value={bedrockRegion}
            class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            {#each REGIONS as r (r.value)}<option value={r.value}>{r.label}</option>{/each}
          </select>
        </div>
      {:else}
        <div>
          <label for="ac-key" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {s.apiKeyLabel()}
          </label>
          <input
            id="ac-key"
            type="password"
            bind:value={apiKeyInput}
            placeholder={hasExistingKey ? s.keptKeyPlaceholder() : 'sk-…'}
            class={inputClass}
          />
          <p class="mt-1 text-xs text-zinc-400">{s.encryptedNote()}</p>
        </div>
      {/if}

      {#if editId !== null && hasExistingKey}
        <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" bind:checked={removeKey} />
          {s.removeKeyLabel()}
        </label>
      {/if}

      <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input type="checkbox" bind:checked={enabledInput} />
        {s.enabledLabel()}
      </label>

      <div>
        <label for="ac-params" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {s.paramsLabel()}
        </label>
        <textarea
          id="ac-params"
          rows="3"
          bind:value={paramsText}
          placeholder={'{"maxTokens": 1024}'}
          class="{inputClass} font-mono"
        ></textarea>
        <p class="mt-1 text-xs text-zinc-400">{s.paramsHint()}</p>
      </div>

      {#if error}
        <div
          class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </div>
      {/if}
      {#if testResult}
        <div
          class="rounded-md border px-3 py-2 text-xs {testResult.ok
            ? 'border-green-300 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300'
            : 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'}"
        >
          {#if testResult.ok}
            ✓ Works — {testResult.provider} / {testResult.model}. Reply: "{testResult.reply}"
          {:else}
            × {testResult.error}
          {/if}
        </div>
      {/if}

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          onclick={save}
          disabled={busy}
          class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {busy ? s.savingButton() : s.saveButton()}
        </button>
        {#if allowTest}
          <button
            type="button"
            onclick={test}
            disabled={busy}
            class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            {s.testButton()}
          </button>
        {/if}
        <button
          type="button"
          onclick={closeForm}
          class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          {s.cancelButton()}
        </button>
      </div>
    </div>
  {/if}

  <!-- Config list — #719: the shared TanStack grid, replacing a stack of
       bespoke cards. Same chrome as every other portal list. -->
  {#if configs.length === 0}
    {#if !formOpen}
      <p class="text-sm text-zinc-500">{s.empty()}</p>
    {/if}
  {:else}
    <DataTable
      table={configTable}
      listKey="ai-configs"
      searchPlaceholder={t('ai-config.search.placeholder', 'Search configs...')}
      searchAriaLabel={t('ai-config.search.aria-label', 'Search AI provider configs')}
      bind:globalFilter={configFilter}
      maxHeight="max(200px, calc(100vh - 30rem))"
      rowClass={(c) => (c.enabled ? '' : 'opacity-60')}
    >
      {#snippet cell(cell, c)}
        {#if cell.column.id === 'name'}
          <span class="truncate font-mono text-sm font-medium text-zinc-900 dark:text-white">{c.name}</span>
        {:else if cell.column.id === 'enabled'}
          {#if c.enabled}
            <span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">
              {s.enabledBadge()}
            </span>
          {:else}
            <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {s.disabledBadge()}
            </span>
          {/if}
        {:else if cell.column.id === 'key'}
          <!-- The stored key is never rendered — only its preview, masked. -->
          <span class="font-mono text-xs text-zinc-400">{maskedKey(c)}</span>
        {:else if cell.column.id === 'actions'}
          {#if canManage}
            <div class="flex items-center gap-2">
              {#if confirmDeleteId === c.id}
                <span class="text-xs text-zinc-500">{s.confirmDelete(c.name)}</span>
                <button
                  type="button"
                  onclick={() => doDelete(c.id)}
                  disabled={busy}
                  class="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950 disabled:opacity-50"
                >
                  {s.confirmYes()}
                </button>
                <button
                  type="button"
                  onclick={() => (confirmDeleteId = null)}
                  class="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  {s.cancelButton()}
                </button>
              {:else}
                <button
                  type="button"
                  onclick={() => openEdit(c)}
                  class="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  {s.editButton()}
                </button>
                <button
                  type="button"
                  onclick={() => (confirmDeleteId = c.id)}
                  class="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
                >
                  {s.deleteButton()}
                </button>
              {/if}
            </div>
          {/if}
        {:else}
          {@const f = configFmt[cell.column.id]}
          <div class="truncate">{f ? f(cell.getValue()) : (cell.getValue() ?? '—')}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</section>
