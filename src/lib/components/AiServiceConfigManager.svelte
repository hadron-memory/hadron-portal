<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { AI_PROVIDERS, DEFAULT_MODELS } from '$lib/ai-config';
  import type { AiConfigOwnerType, AiServiceConfig, AIProvider } from '$lib/types';
  import { aiConfigStrings as s } from '$lib/i18n/ai-config-strings';
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
          params: params.value,
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
          params: params.value,
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

  <!-- Config list -->
  {#if configs.length === 0}
    {#if !formOpen}
      <p class="text-sm text-zinc-500">{s.empty()}</p>
    {/if}
  {:else}
    <div class="space-y-2">
      {#each configs as c (c.id)}
        <div
          class="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-mono text-sm font-medium text-zinc-900 dark:text-white">{c.name}</span>
                {#if c.enabled}
                  <span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">
                    {s.enabledBadge()}
                  </span>
                {:else}
                  <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {s.disabledBadge()}
                  </span>
                {/if}
              </div>
              <p class="mt-1 text-sm text-zinc-500">
                {providerLabel(c.provider)} · <span class="text-zinc-700 dark:text-zinc-300">{c.model}</span>
              </p>
              <p class="mt-0.5 font-mono text-xs text-zinc-400">
                {c.hasApiKey ? `${'•'.repeat(8)}${c.apiKeyPreview ?? ''}` : s.noKey()}
              </p>
            </div>
            {#if canManage}
              <div class="flex shrink-0 items-center gap-2">
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
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>
