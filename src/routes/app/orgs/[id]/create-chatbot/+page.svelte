<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { toSlug } from '$lib/slug';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData, ActionData } from './$types';
  import { createChatbotSchema } from './schema';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);
  const initialForm = untrack(() => form?.form ?? data.form);

  const {
    form: formData,
    errors,
    constraints,
    message,
    allErrors,
    submitting,
    enhance,
  } = superForm(initialForm, {
    validators: zod4Client(createChatbotSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  // Wizard state
  let step = $state(untrack(() => form?.form ? 4 : 1));
  const totalSteps = 4;

  let slugEdited = $state(false);
  let knowledgeSlugEdited = $state(false);
  let knowledgeNameEdited = $state(false);
  let systemSlugEdited = $state(false);
  let submitAttempted = $state(untrack(() => !!form?.form));
  const agentNameError = $derived($errors.agentName?.[0] ?? null);
  const agentSlugError = $derived($errors.agentSlug?.[0] ?? null);
  const knowledgeNameError = $derived($errors.knowledgeMemoryName?.[0] ?? null);
  const knowledgeSlugError = $derived($errors.knowledgeMemorySlug?.[0] ?? null);
  const systemSlugError = $derived($errors.systemMemorySlug?.[0] ?? null);
  const actionError = $derived(
    $message?.type === 'error'
      ? $message.text
      : (submitAttempted ? ($allErrors[0]?.messages[0] ?? null) : null),
  );

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  function canProceed(): boolean {
    if (step === 1) return $formData.agentName.trim().length > 0 && $formData.agentSlug.trim().length > 0 && !agentNameError && !agentSlugError;
    if (step === 2) return true; // system prompt is optional
    if (step === 3) return $formData.systemMemorySlug.trim().length > 0 && (!$formData.includeKnowledge || ($formData.knowledgeMemoryName.trim().length > 0 && $formData.knowledgeMemorySlug.trim().length > 0));
    return true;
  }

  const stepLabels = ['Agent', 'System Prompt', 'Memories', 'Review'];

  function updateForm(updates: Partial<typeof $formData>) {
    formData.update((current) => ({ ...current, ...updates }), { taint: false });
  }

  function onAgentNameInput(event: Event) {
    const agentName = (event.currentTarget as HTMLInputElement).value;
    const updates: Partial<typeof $formData> = {};
    if (!slugEdited) updates.agentSlug = toSlug(agentName);
    if (!knowledgeNameEdited && agentName) updates.knowledgeMemoryName = `${agentName} Knowledge`;
    const nextKnowledgeName = updates.knowledgeMemoryName ?? $formData.knowledgeMemoryName;
    if (!knowledgeSlugEdited) updates.knowledgeMemorySlug = toSlug(nextKnowledgeName);
    if (!systemSlugEdited && agentName) updates.systemMemorySlug = toSlug(`${agentName}-system`);
    updateForm(updates);
  }

  function onKnowledgeNameInput(event: Event) {
    knowledgeNameEdited = true;
    if (!knowledgeSlugEdited) {
      updateForm({ knowledgeMemorySlug: toSlug((event.currentTarget as HTMLInputElement).value) });
    }
  }

  function markSubmitAttempted() {
    submitAttempted = true;
  }
</script>

<svelte:head><title>Create Chatbot Agent · {org.name} · Hadron</title></svelte:head>

<div class="max-w-2xl mx-auto">
  <div class="mb-6">
    <Breadcrumb items={[
      { label: 'Create Chatbot Agent' },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">Create Chatbot Agent</h1>
    <p class="mt-1 text-sm text-zinc-500">Set up an agent with memories and conversation scaffolding.</p>
  </div>

  <!-- Step indicator -->
  <div class="mb-8 flex items-center gap-2">
    {#each stepLabels as label, i}
      {@const stepNum = i + 1}
      <div class="flex items-center gap-2">
        <div class="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold
          {step > stepNum ? 'bg-green-500 text-white' : step === stepNum ? 'text-white' : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400'}"
          style={step === stepNum ? 'background: #ffb703;' : ''}
        >
          {#if step > stepNum}✓{:else}{stepNum}{/if}
        </div>
        <span class="text-xs {step === stepNum ? 'font-medium text-zinc-900 dark:text-white' : 'text-zinc-400'}">{label}</span>
      </div>
      {#if i < stepLabels.length - 1}
        <div class="flex-1 h-px {step > stepNum ? 'bg-green-400' : 'bg-zinc-200 dark:bg-zinc-700'}"></div>
      {/if}
    {/each}
  </div>

  {#if actionError}
    <div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{actionError}</div>
  {/if}

  <form method="POST" onsubmit={markSubmitAttempted} use:enhance novalidate>
    <!-- Hidden fields for all steps -->
    <input type="hidden" name="agentName" value={$formData.agentName} />
    <input type="hidden" name="agentSlug" value={$formData.agentSlug} />
    <input type="hidden" name="agentDescription" value={$formData.agentDescription} />
    <input type="hidden" name="systemPrompt" value={$formData.systemPrompt} />
    <input type="hidden" name="visibility" value={$formData.visibility} />
    <input type="hidden" name="includeKnowledge" value={$formData.includeKnowledge ? 'true' : 'false'} />
    <input type="hidden" name="knowledgeMemoryName" value={$formData.knowledgeMemoryName} />
    <input type="hidden" name="knowledgeMemorySlug" value={$formData.knowledgeMemorySlug} />
    <input type="hidden" name="systemMemorySlug" value={$formData.systemMemorySlug} />

    <div class="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">

      <!-- Step 1: Agent basics -->
      {#if step === 1}
        <h2 class="mb-4 text-lg font-semibold text-zinc-900 dark:text-white">Name your agent</h2>
        <div class="space-y-4">
          <div>
            <label for="agentName" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Agent Name</label>
            <input id="agentName" type="text" required placeholder="e.g. Juno, Tax Helper, Research Assistant"
              bind:value={$formData.agentName}
              oninput={onAgentNameInput}
              aria-invalid={!!agentNameError}
              aria-describedby={agentNameError ? 'agentNameError' : undefined}
              {...$constraints.agentName}
              class="{inputClass} {agentNameError ? 'border-red-500 focus:border-red-500' : ''}" />
            {#if agentNameError}
              <p id="agentNameError" class="mt-1 text-xs text-red-600 dark:text-red-400">{agentNameError}</p>
            {/if}
          </div>
          <div>
            <label for="agentSlug" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
            <div class="flex items-stretch">
              <span class="inline-flex shrink-0 items-center whitespace-nowrap rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{org.urn}:</span>
              <input id="agentSlug" type="text" required placeholder="juno"
                bind:value={$formData.agentSlug}
                oninput={() => { slugEdited = true; }}
                aria-invalid={!!agentSlugError}
                aria-describedby={agentSlugError ? 'agentSlugError' : undefined}
                {...$constraints.agentSlug}
                class="min-w-0 w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {agentSlugError ? 'border-red-500 focus:border-red-500' : ''}" />
            </div>
            {#if agentSlugError}
              <p id="agentSlugError" class="mt-1 text-xs text-red-600 dark:text-red-400">{agentSlugError}</p>
            {/if}
          </div>
          <div>
            <label for="agentDescription" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description <span class="text-zinc-500">(optional)</span></label>
            <textarea id="agentDescription" rows="2" placeholder="What does this chatbot do?"
              bind:value={$formData.agentDescription} class={inputClass}></textarea>
          </div>
          <div>
            <label for="visibility" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Visibility</label>
            <select id="visibility" bind:value={$formData.visibility} class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              <option value="PERSONAL">Personal</option>
              <option value="ORGANIZATION">Organization</option>
              <option value="PUBLIC">Public</option>
            </select>
          </div>
        </div>
      {/if}

      <!-- Step 2: System prompt -->
      {#if step === 2}
        <h2 class="mb-4 text-lg font-semibold text-zinc-900 dark:text-white">System prompt</h2>
        <p class="mb-4 text-sm text-zinc-500">Define your agent's personality and behavior. This is sent to the LLM at the start of every conversation.</p>
        <div>
          <textarea id="systemPrompt" rows="8"
            placeholder="You are {$formData.agentName || 'an AI assistant'}, a helpful mentor for entrepreneurs. Be warm, encouraging, and practical. Ask clarifying questions before giving advice."
            bind:value={$formData.systemPrompt} class={inputClass}></textarea>
          <p class="mt-2 text-xs text-zinc-400">Tip: describe the agent's role, tone, and any rules it should follow. Stage-specific instructions go in the conversation prompts (created after this wizard).</p>
        </div>
      {/if}

      <!-- Step 3: Memories -->
      {#if step === 3}
        <h2 class="mb-4 text-lg font-semibold text-zinc-900 dark:text-white">Set up memories</h2>
        <p class="mb-4 text-sm text-zinc-500">Memories store your agent's configuration and data. You can customize their names and URNs.</p>
        <div class="space-y-5">
          <!-- System memory (always created) -->
          <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div class="mb-2 flex items-center gap-2">
              <span class="rounded px-1.5 py-0.5 text-xs font-medium" style="background: #219ebc; color: white;">System</span>
              <span class="text-xs text-zinc-500">Auto-created</span>
            </div>
            <div class="space-y-3">
              <div>
                <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{$formData.agentName || 'Agent'} System</p>
              </div>
              <div>
                <label for="systemMemorySlug" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
                <div class="flex items-stretch">
                  <span class="inline-flex shrink-0 items-center whitespace-nowrap rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{org.urn}:</span>
                  <input id="systemMemorySlug" type="text" required
                    bind:value={$formData.systemMemorySlug}
                    oninput={() => { systemSlugEdited = true; }}
                    aria-invalid={!!systemSlugError}
                    aria-describedby={systemSlugError ? 'systemSlugError' : undefined}
                    {...$constraints.systemMemorySlug}
                    class="min-w-0 w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {systemSlugError ? 'border-red-500 focus:border-red-500' : ''}" />
                </div>
                {#if systemSlugError}
                  <p id="systemSlugError" class="mt-1 text-xs text-red-600 dark:text-red-400">{systemSlugError}</p>
                {/if}
              </div>
              <p class="text-xs text-zinc-400">Conversation designs, stages, and prompt templates. A setup conversation scaffold is created automatically.</p>
            </div>
          </div>

          <!-- Knowledge memory (optional) -->
          <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950 {$formData.includeKnowledge ? '' : 'opacity-60'}">
            <div class="mb-2 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="rounded px-1.5 py-0.5 text-xs font-medium" style="background: #8ecae6; color: #023047;">Knowledge</span>
                <span class="text-xs text-zinc-500">Read-only</span>
              </div>
              <label class="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
                <input type="checkbox" bind:checked={$formData.includeKnowledge} class="rounded border-zinc-300" />
                Include
              </label>
            </div>
            {#if $formData.includeKnowledge}
              <div class="space-y-3">
                <div>
                  <label for="knowledgeMemoryName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
                  <input id="knowledgeMemoryName" type="text"
                    bind:value={$formData.knowledgeMemoryName}
                    oninput={onKnowledgeNameInput}
                    aria-invalid={!!knowledgeNameError}
                    aria-describedby={knowledgeNameError ? 'knowledgeNameError' : undefined}
                    class="{inputClass} {knowledgeNameError ? 'border-red-500 focus:border-red-500' : ''}" />
                  {#if knowledgeNameError}
                    <p id="knowledgeNameError" class="mt-1 text-xs text-red-600 dark:text-red-400">{knowledgeNameError}</p>
                  {/if}
                </div>
                <div>
                  <label for="knowledgeMemorySlug" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
                  <div class="flex items-stretch">
                    <span class="inline-flex shrink-0 items-center whitespace-nowrap rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{org.urn}:</span>
                    <input id="knowledgeMemorySlug" type="text"
                      bind:value={$formData.knowledgeMemorySlug}
                      oninput={() => { knowledgeSlugEdited = true; }}
                      aria-invalid={!!knowledgeSlugError}
                      aria-describedby={knowledgeSlugError ? 'knowledgeSlugError' : undefined}
                      class="min-w-0 w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {knowledgeSlugError ? 'border-red-500 focus:border-red-500' : ''}" />
                  </div>
                  {#if knowledgeSlugError}
                    <p id="knowledgeSlugError" class="mt-1 text-xs text-red-600 dark:text-red-400">{knowledgeSlugError}</p>
                  {/if}
                </div>
                <p class="text-xs text-zinc-400">Separate domain knowledge your chatbot references (industry guides, FAQs, resources). Skip this if all knowledge lives in the system memory.</p>
              </div>
            {:else}
              <p class="text-xs text-zinc-400 mt-1">No separate knowledge memory. All knowledge will live in the system memory.</p>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Step 4: Review -->
      {#if step === 4}
        <h2 class="mb-4 text-lg font-semibold text-zinc-900 dark:text-white">Review & create</h2>
        <div class="space-y-3 text-sm">
          <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <h3 class="font-medium text-zinc-900 dark:text-white">Agent</h3>
            <p class="mt-1 text-zinc-600 dark:text-zinc-400">{$formData.agentName} <span class="font-mono text-xs text-zinc-400">({org.urn}:{$formData.agentSlug})</span></p>
            {#if $formData.agentDescription}<p class="mt-1 text-zinc-500">{$formData.agentDescription}</p>{/if}
            <p class="mt-1 text-xs text-zinc-400">Visibility: {$formData.visibility}</p>
          </div>

          {#if $formData.systemPrompt}
            <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <h3 class="font-medium text-zinc-900 dark:text-white">System Prompt</h3>
              <p class="mt-1 whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{$formData.systemPrompt}</p>
            </div>
          {/if}

          <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <h3 class="font-medium text-zinc-900 dark:text-white">Memories</h3>
            <ul class="mt-2 space-y-1.5 text-zinc-600 dark:text-zinc-400">
              <li><span style="color: #219ebc;">●</span> {$formData.agentName} System <span class="font-mono text-xs text-zinc-400">({org.urn}:{$formData.systemMemorySlug})</span> <span class="text-xs text-zinc-400">system</span></li>
              {#if $formData.includeKnowledge}
                <li><span style="color: #8ecae6;">●</span> {$formData.knowledgeMemoryName} <span class="font-mono text-xs text-zinc-400">({org.urn}:{$formData.knowledgeMemorySlug})</span> <span class="text-xs text-zinc-400">read-only</span></li>
              {/if}
            </ul>
          </div>

          <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <h3 class="font-medium text-zinc-900 dark:text-white">Scaffold</h3>
            <p class="mt-1 text-zinc-600 dark:text-zinc-400">A setup conversation with an onboard stage will be created in the system memory, along with prompt templates and a shared metadata partial.</p>
          </div>
        </div>
      {/if}
    </div>

    <!-- Navigation -->
    <div class="mt-6 flex items-center justify-between">
      <div>
        {#if step > 1}
          <button type="button" onclick={() => step--}
            class="rounded-lg border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Back
          </button>
        {:else}
          <a href="/app/orgs/{org.id}/agents"
            class="rounded-lg border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Cancel
          </a>
        {/if}
      </div>

      <div>
        {#if step < totalSteps}
          <button type="button" onclick={() => step++} disabled={!canProceed()}
            class="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style="background: #ffb703;">
            Next
          </button>
        {:else}
          <button type="submit" disabled={$submitting}
            class="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style="background: #fb8500;">
            {$submitting ? 'Creating...' : 'Create Chatbot Agent'}
          </button>
        {/if}
      </div>
    </div>
  </form>
</div>
