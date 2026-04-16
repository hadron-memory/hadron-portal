<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const agent = $derived(data.agent);

  let newConversationName = $state('');
  let newStageNames = $state<Record<string, string>>({});
  let editingPrompt = $state<string | null>(null);
  let editingSpec = $state<string | null>(null);
  let promptContents = $state<Record<string, string>>({});
  let specContents = $state<Record<string, string>>({});

  function startEditPrompt(stageLoc: string) {
    const promptRef = getPromptRef(stageLoc);
    if (!promptRef) return;
    const prompt = data.prompts.find((p) => p.loc === promptRef);
    promptContents[promptRef] = prompt?.content ?? '';
    editingPrompt = promptRef;
  }

  function startEditSpec(stageLoc: string) {
    const stage = data.systemNodes.find((n) => n.loc === stageLoc);
    const stageData = (stage?.data as Record<string, unknown>) ?? {};
    specContents[stageLoc] = JSON.stringify(stageData.extractionSpec ?? [], null, 2);
    editingSpec = stageLoc;
  }

  function getPromptRef(stageLoc: string): string | null {
    const stage = data.systemNodes.find((n) => n.loc === stageLoc);
    return ((stage?.data as Record<string, unknown>)?.promptRef as string) ?? null;
  }

  function getExtractionSpec(stageLoc: string): unknown[] {
    const stage = data.systemNodes.find((n) => n.loc === stageLoc);
    return ((stage?.data as Record<string, unknown>)?.extractionSpec as unknown[]) ?? [];
  }

  function getPromptContent(stageLoc: string): string {
    const ref = getPromptRef(stageLoc);
    if (!ref) return '';
    return data.prompts.find((p) => p.loc === ref)?.content ?? '';
  }

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";
</script>

<svelte:head><title>Conversations · {agent.name} · Hadron</title></svelte:head>

<div class="space-y-6">
  <div>
    <Breadcrumb items={[
      { label: 'Dashboard', href: '/app/dashboard' },
      { label: 'Agents', href: '/app/agents' },
      { label: agent.name, href: `/app/agents/${agent.id}` },
      { label: 'Conversations' },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">Conversation Editor</h1>
    <p class="mt-1 text-sm text-zinc-500">Design conversation flows for {agent.name}</p>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <!-- Conversations -->
  {#each data.conversations as conv}
    <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
      <!-- Conversation header -->
      <div class="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800" style="background: rgba(33, 158, 188, 0.08);">
        <div>
          <h2 class="font-semibold text-zinc-900 dark:text-white">{conv.node.description || conv.node.name}</h2>
          <p class="font-mono text-xs text-zinc-400">{conv.node.loc}</p>
          {#if conv.data.isSetup}
            <span class="mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium" style="background: #ffb703; color: #023047;">Setup</span>
          {/if}
        </div>
        <div class="text-xs text-zinc-500">{conv.stages.length} stage{conv.stages.length !== 1 ? 's' : ''}</div>
      </div>

      <!-- Stages -->
      <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
        {#each conv.stages as stage, idx}
          {@const stageLoc = stage.loc}
          {@const spec = getExtractionSpec(stageLoc)}
          {@const prompt = getPromptContent(stageLoc)}
          <div class="px-5 py-4">
            <div class="flex items-start justify-between">
              <div>
                <div class="flex items-center gap-2">
                  <span class="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style="background: #219ebc;">{idx + 1}</span>
                  <h3 class="text-sm font-medium text-zinc-900 dark:text-white">{stage.description || stage.name}</h3>
                </div>
                <p class="mt-0.5 pl-7 font-mono text-xs text-zinc-400">{stageLoc}</p>
              </div>
              <div class="flex gap-2">
                <button onclick={() => startEditPrompt(stageLoc)} class="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
                  Edit Prompt
                </button>
                <button onclick={() => startEditSpec(stageLoc)} class="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
                  Edit Extraction
                </button>
              </div>
            </div>

            <!-- Prompt preview -->
            {#if prompt}
              <div class="mt-2 pl-7">
                <p class="text-xs font-medium text-zinc-500 mb-1">Prompt:</p>
                <pre class="max-h-24 overflow-y-auto rounded border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">{prompt.slice(0, 300)}{prompt.length > 300 ? '...' : ''}</pre>
              </div>
            {/if}

            <!-- Extraction spec preview -->
            {#if spec.length > 0}
              <div class="mt-2 pl-7">
                <p class="text-xs font-medium text-zinc-500 mb-1">Extracts:</p>
                <div class="flex flex-wrap gap-1">
                  {#each spec as field}
                    <span class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                      {(field as any).field ?? '?'}
                    </span>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Prompt editor (inline) -->
            {#if editingPrompt === getPromptRef(stageLoc)}
              {@const pRef = getPromptRef(stageLoc)!}
              <form method="POST" action="?/updatePrompt" use:enhance={() => { return async ({ update }) => { editingPrompt = null; await update(); }; }} class="mt-3 pl-7">
                <input type="hidden" name="systemMemoryId" value={data.systemMemoryId} />
                <input type="hidden" name="loc" value={pRef} />
                <textarea name="content" bind:value={promptContents[pRef]} rows="10" class="{inputClass} font-mono text-xs"></textarea>
                <p class="mt-1 text-[10px] text-zinc-400">Supports Mustache: {'{{var}}'}, {'{{node.field}}'}, {'{{> partial}}'}, {'{{#flag}}...{{/flag}}'}</p>
                <div class="mt-2 flex gap-2">
                  <button type="submit" class="rounded px-3 py-1.5 text-xs font-medium text-white" style="background: #fb8500;">Save Prompt</button>
                  <button type="button" onclick={() => editingPrompt = null} class="text-xs text-zinc-500">Cancel</button>
                </div>
              </form>
            {/if}

            <!-- Extraction spec editor (inline) -->
            {#if editingSpec === stageLoc}
              <form method="POST" action="?/updateExtractionSpec" use:enhance={() => { return async ({ update }) => { editingSpec = null; await update(); }; }} class="mt-3 pl-7">
                <input type="hidden" name="systemMemoryId" value={data.systemMemoryId} />
                <input type="hidden" name="stageLoc" value={stageLoc} />
                <textarea name="extractionSpec" bind:value={specContents[stageLoc]} rows="8" class="{inputClass} font-mono text-xs"></textarea>
                <p class="mt-1 text-[10px] text-zinc-400">JSON array: [{'{ "field": "memory.name", "description": "User name", "shape": "string" }'}]</p>
                <div class="mt-2 flex gap-2">
                  <button type="submit" class="rounded px-3 py-1.5 text-xs font-medium text-white" style="background: #fb8500;">Save Extraction</button>
                  <button type="button" onclick={() => editingSpec = null} class="text-xs text-zinc-500">Cancel</button>
                </div>
              </form>
            {/if}
          </div>
        {/each}

        <!-- Add stage -->
        <div class="px-5 py-3">
          <form method="POST" action="?/addStage" use:enhance class="flex items-end gap-2">
            <input type="hidden" name="systemMemoryId" value={data.systemMemoryId} />
            <input type="hidden" name="conversationLoc" value={conv.node.loc} />
            <div class="flex-1">
              <input type="text" name="stageName" placeholder="New stage name..."
                bind:value={newStageNames[conv.node.loc]}
                class="w-full rounded border border-dashed border-zinc-300 bg-transparent px-3 py-1.5 text-sm placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:placeholder-zinc-600" />
            </div>
            <button type="submit" class="rounded px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
              + Add Stage
            </button>
          </form>
        </div>
      </div>
    </div>
  {/each}

  <!-- Add conversation -->
  <div class="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-5 dark:border-zinc-700 dark:bg-zinc-900/50">
    <form method="POST" action="?/addConversation" use:enhance class="flex items-end gap-3">
      <input type="hidden" name="systemMemoryId" value={data.systemMemoryId} />
      <div class="flex-1">
        <label for="newConv" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">New Conversation</label>
        <input id="newConv" type="text" name="name" placeholder="e.g. Find Mentor, Business Review, Write Profile"
          bind:value={newConversationName}
          class={inputClass} />
      </div>
      <button type="submit" disabled={!newConversationName.trim()}
        class="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50" style="background: #219ebc;">
        + Add Conversation
      </button>
    </form>
  </div>

  <!-- Shared partials -->
  {#if data.prompts.filter(p => p.loc.startsWith('prompts:partials:')).length > 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Shared Partials</h2>
      <div class="space-y-2">
        {#each data.prompts.filter(p => p.loc.startsWith('prompts:partials:')) as partial}
          <div class="rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div class="flex items-center justify-between">
              <span class="font-mono text-xs text-zinc-600 dark:text-zinc-400">{partial.loc}</span>
              <button onclick={() => { promptContents[partial.loc] = partial.content ?? ''; editingPrompt = partial.loc; }}
                class="text-xs text-indigo-500 hover:underline">Edit</button>
            </div>
            {#if editingPrompt === partial.loc}
              <form method="POST" action="?/updatePrompt" use:enhance={() => { return async ({ update }) => { editingPrompt = null; await update(); }; }} class="mt-2">
                <input type="hidden" name="systemMemoryId" value={data.systemMemoryId} />
                <input type="hidden" name="loc" value={partial.loc} />
                <textarea name="content" bind:value={promptContents[partial.loc]} rows="5" class="{inputClass} font-mono text-xs"></textarea>
                <div class="mt-2 flex gap-2">
                  <button type="submit" class="rounded px-3 py-1.5 text-xs font-medium text-white" style="background: #fb8500;">Save</button>
                  <button type="button" onclick={() => editingPrompt = null} class="text-xs text-zinc-500">Cancel</button>
                </div>
              </form>
            {:else if partial.content}
              <pre class="mt-1 max-h-16 overflow-y-auto text-xs text-zinc-500">{partial.content.slice(0, 200)}{(partial.content?.length ?? 0) > 200 ? '...' : ''}</pre>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
