<script lang="ts">
  import { testResultView, type AiConfigTestResult, type AiConfigTestView } from '$lib/ai-config-test';
  import { lookupOwn } from '$lib/lookup';
  import { invalidateAll } from '$app/navigation';
  import { AI_CONFIG_PROVIDERS, DEFAULT_MODELS } from '$lib/ai-config';
  import type { AiConfigOwnerType, AiConfigProvider, AiServiceConfig } from '$lib/types';
  import { aiConfigStrings as s } from '$lib/i18n/ai-config-strings';
  import { t } from '$lib/i18n/t';
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import DataTable from './table/DataTable.svelte';
  import NodeActionsMenu from './NodeActionsMenu.svelte';
  import {
    isValidConfigName,
    resolveKeyInput,
    resolveApiKeyAction,
    testOverrideKey,
    parseParamsText,
    apiStyleApplies,
    endpointRequired,
    keyRequired,
    fieldChange,
    endpointShapeError,
    inlineTestable,
    type AiApiStyle,
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
  let providerInput = $state<AiConfigProvider>('anthropic');
  let modelInput = $state('');
  let apiKeyInput = $state('');
  let bedrockAccessKeyId = $state('');
  let bedrockSecretAccessKey = $state('');
  let bedrockRegion = $state('us-east-1');
  let enabledInput = $state(true);
  let removeKey = $state(false);
  let paramsText = $state('');
  // server#1373: '' = the provider default, for both.
  let endpointInput = $state('');
  let apiStyleInput = $state<AiApiStyle | ''>('');
  // server#1389: params.toolCalling, owned by this toggle for openai-compatible.
  let toolCalling = $state(false);
  type KnownEndpoint = { url: string; label: string; isDefault: boolean; note: string | null };
  let knownEndpoints = $state<KnownEndpoint[]>([]);
  let busy = $state(false);
  let error = $state<string | null>(null);
  // #937: one shape for both paths, so the result always reads the same way.
  let testResult = $state<AiConfigTestView | null>(null);
  let confirmDeleteId = $state<string | null>(null);

  const editing = $derived(editId ? (configs.find((c) => c.id === editId) ?? null) : null);
  const hasExistingKey = $derived(editing?.hasApiKey ?? false);
  const renamingWellKnown = $derived(
    !!editing && WELL_KNOWN.includes(editing.name) && nameInput.trim() !== editing.name,
  );

  function providerLabel(p: string): string {
    return AI_CONFIG_PROVIDERS.find((x) => x.value === p)?.label ?? p;
  }

  const DEFAULT_API_STYLE: Record<string, AiApiStyle> = {
    openai: 'RESPONSES',
    glm: 'CHAT_COMPLETIONS',
    'openai-compatible': 'CHAT_COMPLETIONS',
  };
  function apiStyleLabel(style: AiApiStyle): string {
    return style === 'RESPONSES' ? s.apiStyleResponses() : s.apiStyleChat();
  }
  const needsKey = $derived(keyRequired({ ownerType, provider: providerInput, endpoint: endpointInput }));
  const defaultEndpoint = $derived(knownEndpoints.find((e) => e.isDefault) ?? null);
  const chosenEndpoint = $derived(knownEndpoints.find((e) => e.url === endpointInput.trim()) ?? null);

  // The server's suggestion list for the chosen provider. A stale reply (the
  // provider changed while it was in flight) is dropped, and a failed read is
  // just no suggestions: the field still takes any URL.
  //
  // EVERY transition, Bedrock and a closed form included, clears the list and
  // invalidates the request in flight first. Otherwise the previous provider's
  // URLs stay offered until the new reply lands, and a late reply could refill
  // the list after a switch to Bedrock (#951 Codex P2).
  let endpointsSeq = 0;
  $effect(() => {
    const provider = providerInput;
    const seq = ++endpointsSeq;
    knownEndpoints = [];
    if (!formOpen || provider === 'bedrock') return;
    post({ action: 'endpoints', provider })
      .then((r) => {
        if (seq === endpointsSeq) knownEndpoints = (r.endpoints as KnownEndpoint[]) ?? [];
      })
      .catch(() => {
        if (seq === endpointsSeq) knownEndpoints = [];
      });
  });

  function onProviderChange() {
    // A style is refused for a single-protocol provider rather than ignored.
    if (!apiStyleApplies(providerInput)) apiStyleInput = '';
    // Bedrock's host follows its region, and its endpoint field is hidden: a
    // leftover value would still be sent and would still demand a key.
    if (providerInput === 'bedrock') endpointInput = '';
    if (providerInput !== 'openai-compatible') toolCalling = false;
  }

  // #719 — the config list as the shared TanStack grid, replacing a stack of
  // bespoke cards. This component is used by THREE surfaces (an agent, an org's
  // integrations, an App's settings), so converting it here is what makes the
  // AI-provider list one thing rather than three that drift.
  //
  // ONE `listKey` across all three deliberately. The check on that
  // (hrn:node:hadronmemory.com:hadron-portal:review:saved-view-arrangement-not-position) warns about UNINTENDED
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
    // Where a run actually goes (server#1373), so a Coding Plan config and a
    // pay-as-you-go one are told apart. Null only for bedrock (region-derived).
    { accessorFn: (row) => row.effectiveEndpoint ?? '—', id: 'endpoint', header: s.endpointColumn(), size: 240 },
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
    // Numeric accessor per hrn:node:hadronmemory.com:hadron-portal:review:date-column-sorts-by-instant — a raw date
    // string reaches TanStack's alphanumeric comparator, which reads the digit
    // groups and ignores the offset, ordering by wall clock rather than instant.
    { accessorFn: (row) => configDateMs(row.createdAt), id: 'createdAt', header: t('ai-config.column.created', 'Created'), size: 170 },
    { id: 'actions', header: t('ai-config.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 120 },
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
    // #820 — NOT 'includesString': that stringifies the ACCESSOR, and
    // `createdAt` accessors epoch millis so the column sorts by instant. A
    // reader typing the date in front of them matched nothing. `configFmt` is
    // the SAME map the cell falls back to, so search and screen cannot drift.
    // The extras carry the wire ISO the accessor discarded, for a reader
    // pasting a timestamp from an API response.
    globalFilterFn: makeGlobalFilterFn<AiServiceConfig>(configFmt, {
      createdAt: (row) => row.createdAt,
    }),
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
    endpointInput = '';
    apiStyleInput = '';
    toolCalling = false;
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
    endpointInput = c.endpoint ?? '';
    apiStyleInput = c.apiStyle ?? '';
    // The toggle owns toolCalling, so it's lifted out of the JSON shown.
    const { toolCalling: tc, ...rest } = c.params ?? {};
    toolCalling = tc === true;
    const shown = c.provider === 'openai-compatible' ? rest : (c.params ?? {});
    paramsText = c.params && Object.keys(shown).length > 0 ? JSON.stringify(shown, null, 2) : '';
    formOpen = true;
  }

  function closeForm() {
    formOpen = false;
    editId = null;
    error = null;
    testResult = null;
  }

  /** Stable JSON for comparing params: keys sorted at every level. */
  function canonicalJson(v: unknown): string {
    return JSON.stringify(v, (_k, val) =>
      val && typeof val === 'object' && !Array.isArray(val)
        ? Object.fromEntries(Object.keys(val as Record<string, unknown>).sort().map((k) => [k, (val as Record<string, unknown>)[k]]))
        : val,
    );
  }
  /**
   * The params Save writes: the JSON field, plus Bedrock's region (so the region
   * dropdown round-trips; the masked list never returns the key it's encoded
   * in) and openai-compatible's tool-calling toggle. Save, Test and
   * paramsEdited all use this, so they can't disagree.
   */
  function formParams(): { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string } {
    const parsed = parseParamsText(paramsText);
    if (!parsed.ok) return parsed;
    return {
      ok: true,
      value:
        providerInput === 'bedrock'
          ? { ...parsed.value, bedrockRegion }
          : providerInput === 'openai-compatible'
            ? { ...parsed.value, toolCalling }
            : parsed.value,
    };
  }
  /** Whether the params Save would write differ from the saved config's. Unparseable JSON counts as edited. */
  function paramsEdited(c: AiServiceConfig): boolean {
    const next = formParams();
    if (!next.ok) return true;
    return canonicalJson(next.value ?? null) !== canonicalJson(c.params ?? null);
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
    const params = formParams();
    if (!params.ok) {
      error = params.error;
      return;
    }
    const endpointErr = endpointShapeError(endpointInput);
    if (endpointErr) {
      error = endpointErr;
      return;
    }
    if (endpointRequired(providerInput) && !endpointInput.trim()) {
      error = s.endpointRequired();
      return;
    }
    const paramsValue = params.value;
    const enteredKey = resolveKeyInput({
      provider: providerInput,
      apiKey: apiKeyInput,
      bedrockAccessKeyId,
      bedrockSecretAccessKey,
      bedrockRegion,
    });

    // The server refuses these too (server#1390); saying so here names the field.
    // "Remove the stored key" is hidden where a key is required, so a box
    // ticked before the provider changed must not still clear it.
    const clearKey = removeKey && !needsKey;
    const willHaveKey = clearKey ? !!enteredKey : !!enteredKey || hasExistingKey;
    if (needsKey && !willHaveKey) {
      error = s.keyRequired();
      return;
    }

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
          endpoint: endpointInput.trim() || undefined,
          apiStyle: apiStyleInput || undefined,
        });
      } else {
        const keyArg = resolveApiKeyAction({ removeKey: clearKey, enteredKey });
        // Absent = unchanged, null = back to the provider default.
        const endpoint = fieldChange(editing?.endpoint, endpointInput);
        const apiStyle = fieldChange<AiApiStyle>(editing?.apiStyle, apiStyleInput);
        await post({
          action: 'update',
          id: editId,
          name,
          provider: providerInput,
          model: modelInput.trim(),
          params: paramsValue,
          enabled: enabledInput,
          ...keyArg,
          ...(endpoint !== undefined ? { endpoint } : {}),
          ...(apiStyle !== undefined ? { apiStyle } : {}),
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
    // Save refuses a blank model, so Test does too: otherwise an edited-away
    // model would silently test the saved one and could report success.
    if (!modelInput.trim()) {
      error = s.modelRequired();
      testResult = null;
      return;
    }
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
      if (editing) {
        // #937: a SAVED config, of ANY owner kind, tests BY ID through the
        // server's own run path (server#1378). The stored key stays there.
        // Only what the user changed or typed rides along as an override,
        // which is tested and never saved.
        const override: Record<string, unknown> = {};
        if (providerInput !== editing.provider) override.provider = providerInput;
        if (modelInput.trim() && modelInput.trim() !== editing.model) override.model = modelInput.trim();
        // The credential Save would leave, by Save's own rule: "Remove the
        // stored key" wins over a typed key, so a pass can't hide a config that
        // won't run once saved.
        // Guarded like Save's clearKey: the box is hidden where a key is
        // required, so a tick left over from another provider clears nothing.
        const key = testOverrideKey({ removeKey: removeKey && !needsKey, enteredKey });
        if (key !== undefined) override.apiKey = key;
        const endpoint = fieldChange(editing.endpoint, endpointInput);
        if (endpoint !== undefined) override.endpoint = endpoint;
        const apiStyle = fieldChange<AiApiStyle>(editing.apiStyle, apiStyleInput);
        if (apiStyle !== undefined) override.apiStyle = apiStyle;
        // Edited params ride along exactly as Save would write them
        // (hadron-server#1413: override.params; null = cleared), so Test checks
        // the config shown, tool-calling toggle included (#951 Codex P2).
        // Unparseable JSON is refused like Save refuses it, before any request.
        if (paramsEdited(editing)) {
          const params = formParams();
          if (!params.ok) {
            error = params.error;
            return;
          }
          override.params = params.value;
        }
        const res = (await post({ action: 'testSaved', id: editing.id, override })) as { result: AiConfigTestResult };
        testResult = testResultView(res.result);
      } else if (!inlineTestable({ provider: providerInput, endpoint: endpointInput, apiStyle: apiStyleInput })) {
        // The portal's own client would test a different host than a run uses.
        error = s.testSaveFirst();
      } else if (enteredKey) {
        // A NEW, unsaved config: nothing is stored yet, so it's tested inline.
        const r = (await post({
          action: 'test',
          provider: providerInput,
          model: modelInput.trim(),
          apiKey: enteredKey,
        })) as { ok: boolean; provider?: string; model?: string; reply?: string; error?: string };
        testResult = r.ok
          ? { ok: true, headline: t('ai-config.test.ok.inline', '✓ Works: {provider} / {model}.', { provider: r.provider ?? '', model: r.model ?? '' }), details: r.reply ? [t('ai-config.test.reply', 'Reply: “{reply}”', { reply: r.reply })] : [] }
          : { ok: false, headline: r.error ?? t('ai-config.test.error.unknown', 'The test failed.'), details: [] };
      } else {
        error = s.testNeedsKey();
      }
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
          onchange={onProviderChange}
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        >
          {#each AI_CONFIG_PROVIDERS as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
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
          placeholder={lookupOwn(DEFAULT_MODELS, providerInput) ?? ''}
          class={inputClass}
        />
      </div>

      {#if providerInput !== 'bedrock'}
        <!-- server#1373. Bedrock has no endpoint: its host follows the region. -->
        <div>
          <label for="ac-endpoint" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {s.endpointLabel()}
          </label>
          <input
            id="ac-endpoint"
            type="url"
            list="ac-endpoint-options"
            bind:value={endpointInput}
            placeholder={defaultEndpoint?.url ?? 'https://'}
            aria-describedby="ac-endpoint-hint"
            class={inputClass}
          />
          <datalist id="ac-endpoint-options">
            {#each knownEndpoints as e (e.url)}<option value={e.url}>{e.label}</option>{/each}
          </datalist>
          <div id="ac-endpoint-hint" class="mt-1 space-y-0.5 text-xs text-zinc-400">
            {#if endpointRequired(providerInput)}
              <p>{s.endpointRequiredHint()}</p>
            {:else if !endpointInput.trim() && defaultEndpoint}
              <p>{s.endpointDefaultHint(defaultEndpoint.url)}</p>
            {/if}
            {#if chosenEndpoint}
              <p>{chosenEndpoint.label}{chosenEndpoint.note ? ` · ${chosenEndpoint.note}` : ''}</p>
            {:else if !endpointInput.trim() && defaultEndpoint?.note}
              <p>{defaultEndpoint.label} · {defaultEndpoint.note}</p>
            {/if}
            {#if endpointInput.trim() && !endpointRequired(providerInput)}
              <p>{s.endpointCustomHint()}</p>
            {/if}
          </div>
        </div>
      {/if}

      {#if apiStyleApplies(providerInput)}
        <div>
          <label for="ac-api-style" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {s.apiStyleLabel()}
          </label>
          <select
            id="ac-api-style"
            bind:value={apiStyleInput}
            class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="">{s.apiStyleDefault(apiStyleLabel(DEFAULT_API_STYLE[providerInput]))}</option>
            <option value="CHAT_COMPLETIONS">{s.apiStyleChat()}</option>
            <option value="RESPONSES">{s.apiStyleResponses()}</option>
          </select>
        </div>
      {/if}

      {#if providerInput === 'openai-compatible'}
        <div>
          <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" bind:checked={toolCalling} aria-describedby="ac-tool-calling-hint" />
            {s.toolCallingLabel()}
          </label>
          <p id="ac-tool-calling-hint" class="mt-1 text-xs text-zinc-400">{s.toolCallingHint()}</p>
        </div>
      {/if}

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
          {#if needsKey && !hasExistingKey}
            <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">{s.keyRequiredNote()}</p>
          {/if}
        </div>
      {/if}

      <!-- Clearing the key is refused where one is required (server#1390). -->
      {#if editId !== null && hasExistingKey && !needsKey}
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
          <p>{testResult.ok ? '' : '× '}{testResult.headline}</p>
          {#each testResult.details as d (d)}
            <p class="mt-0.5 opacity-80">{d}</p>
          {/each}
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
            {#if confirmDeleteId === c.id}
              <!-- #1020: the menu's Delete expands this inline confirm in
                   place (the assets-table idiom), not a modal. -->
              <div class="flex items-center gap-1.5 whitespace-nowrap">
                <button
                  type="button"
                  onclick={() => doDelete(c.id)}
                  disabled={busy}
                  class="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {s.deleteButton()}
                </button>
                <button
                  type="button"
                  onclick={() => (confirmDeleteId = null)}
                  class="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  {s.cancelButton()}
                </button>
              </div>
            {:else}
              <!-- #1020: Edit and Delete live in the row's ⋯ menu, like every
                   other portal grid. The question the old inline confirm asked
                   is the Delete item's title. -->
              <NodeActionsMenu
                actions={[
                  { id: 'edit', label: s.editButton() },
                  { id: 'delete', label: s.deleteButton(), danger: true, title: s.confirmDelete(c.name) },
                ]}
                onselect={(id) => {
                  if (id === 'edit') openEdit(c);
                  else confirmDeleteId = c.id;
                }}
                label={s.actionsLabel(c.name)}
                fixed
                compact
              />
            {/if}
          {/if}
        {:else}
          {@const f = configFmt[cell.column.id]}
          <div class="truncate">{f ? f(cell.getValue()) : (cell.getValue() ?? '—')}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</section>
