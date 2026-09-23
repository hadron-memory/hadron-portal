<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import PropertiesEditor from '$lib/components/PropertiesEditor.svelte';
  import SkillExportEditor from '$lib/components/SkillExportEditor.svelte';
  import {
    declarationProblems,
    defaultSkillName,
    readSkillExport,
    withoutSkillExport,
    writeSkillExport,
    type SkillExport,
  } from '$lib/skill-export';
  import { t } from '$lib/i18n/t';
  import { createNodeStrings } from '$lib/i18n/create-node-strings';
  import { declaredObjectType, objectTypeNames, readMemorySchema } from '$lib/schema/memory-schema';
  import type { PageData, ActionData } from './$types';
  import { editNodeSchema } from './schema';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const node = $derived(data.node);
  const basePath = $derived(`/app/memories/${data.graph.id}`);
  const initialForm = untrack(() => form?.form ?? data.form);
  const {
    form: formData,
    errors,
    constraints,
    message,
    submitting,
    enhance,
  } = superForm(initialForm, {
    validators: zod4Client(editNodeSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const actionError = $derived($message?.type === 'error' ? $message.text : null);

  // #588 (server #725): structured storage. With a memory schema, objectType
  // is a picker over the declared collections; without one it's free text.
  // A pre-schema node may carry an objectType that is no longer declared —
  // keep it selectable (marked) so the bound value isn't orphaned.
  const memorySchema = $derived(readMemorySchema(data.graph.schema));
  const collectionNames = $derived(objectTypeNames(memorySchema));
  const declaredCollection = $derived(declaredObjectType(memorySchema, $formData.objectType || null));
  const undeclaredCurrent = $derived(
    $formData.objectType && !collectionNames.includes($formData.objectType) ? $formData.objectType : null,
  );
  const propertiesError = $derived($errors.propertiesJson?.[0] ?? null);
  let propertiesInvalid = $state(false);

  // portal#864 Part A / #878 — the skill export.
  //
  // THE SPLIT. `propertiesJson` is one serialized string for the whole bag, and
  // two editors bound to it would clobber each other: PropertiesEditor seeds its
  // field state once and re-seeds only on remount, so whichever wrote last would
  // win and the other's edit would silently vanish. So this page owns the split
  // — SkillExportEditor gets the skill hosts under `exports` (`claudeSkill` and
  // `codex`), PropertiesEditor gets everything else, and the two are recombined
  // into the submitted string below. When the stored hosts disagree the split
  // gives SkillExportEditor nothing and leaves them in the raw editor.
  //
  // Recombining the WHOLE bag is also what makes hadron-server#1227 unreachable
  // here: the form already round-trips every property key and writes them back
  // together, so a sibling host declaration is never separated from the object
  // it lives in. Read-modify-write is inherited from the form rather than
  // re-implemented — see `skill-export.ts`.
  /**
   * Split the serialized bag into the part this section owns and the rest.
   *
   * A parse failure keeps the RAW TEXT as the rest rather than discarding it.
   * The page can be initialized from an action response carrying invalid
   * `propertiesJson` — a no-JS POST, or a server-side validation failure — and
   * returning '' there would silently drop the user's text along with their one
   * chance to fix it (@copilot on #867). The raw editor reports the problem and
   * sets `invalid`, which is its job, not this one's.
   */
  function splitProperties(serialized: string): {
    skillExport: SkillExport | null;
    divergent: boolean;
    rest: string;
  } {
    const raw = (serialized ?? '').trim();
    if (!raw) return { skillExport: null, divergent: false, rest: '' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { skillExport: null, divergent: false, rest: raw };
    }
    // `JSON.parse` succeeds for an array, a scalar and null, none of which is a
    // properties object. Treating one as a bag turned it into `{}` and the
    // recombination effect then wrote an empty string, dropping a value the
    // server may well accept (@copilot on #867). Same answer as a parse
    // failure: keep the raw text and let the raw editor own it.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { skillExport: null, divergent: false, rest: raw };
    }
    const rest = withoutSkillExport(parsed);
    const { value, divergent } = readSkillExport(parsed);
    return {
      skillExport: value,
      divergent,
      rest: Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : '',
    };
  }

  const initialSplit = untrack(() => splitProperties($formData.propertiesJson));
  let skillExport = $state<SkillExport | null>(initialSplit.skillExport);
  let exportDivergent = $state(initialSplit.divergent);
  let restJson = $state(initialSplit.rest);

  /**
   * RE-SEED WHEN THE NODE CHANGES.
   *
   * SvelteKit reuses this page across `/nodes/A/edit -> /nodes/B/edit`, so
   * state seeded once with `untrack` survives the navigation. Measured before
   * this: declaring an export on node A and navigating to node B left A's
   * declaration in B's form, ready to be saved onto B (@copilot on #867).
   *
   * That is `hrn:node:hadronmemory.com:hadron-portal:review:a-reused-component-must-reseed-its-form`
   * — the check written after #857, where the same trap wrote one worker's
   * prompt override onto another. Third time in this repo.
   *
   * Seeded from `node.properties`, the loader's value for the node now shown,
   * NOT from the form: an in-flight failed POST belongs to the node it was
   * submitted for, and re-reading the form would carry it across too.
   */
  let seededFor = $state(untrack(() => node.id));
  $effect(() => {
    const id = node.id;
    if (untrack(() => seededFor) === id) return;
    const next = splitProperties(
      node.properties != null ? JSON.stringify(node.properties, null, 2) : '',
    );
    skillExport = next.skillExport;
    exportDivergent = next.divergent;
    restJson = next.rest;
    // Node B starts collapsed like any node; the attention effects below
    // re-open a section for B's OWN errors (@copilot on #887).
    storageOpen = false;
    skillOpen = false;
    // The superForm store is seeded ONCE from node A's loader data too, and
    // its other two fields ride the same POST: A's `objectType` would render
    // on B and be saved onto it, and A's `isRunnable: true` would post through
    // the hidden input and silently make B runnable (@codex on #887). Reseeded
    // here explicitly, as the detail page's metadata form does, rather than
    // relying on superForm to resync on a navigation — the harness cannot
    // show that it does, and this write costs nothing if it does.
    // `propertiesJson` is rebuilt by the recombination effect below.
    formData.update(
      (current) => ({
        ...current,
        objectType: node.objectType ?? '',
        isRunnable: node.isRunnable ?? false,
      }),
      { taint: false },
    );
    seededFor = id;
  });

  // The single submitted value, rebuilt from both halves.
  $effect(() => {
    const rawRest = restJson.trim();
    let rest: Record<string, unknown> | null = null;
    if (rawRest) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawRest);
      } catch {
        // Mid-typing invalid JSON, or an invalid bag carried in from a failed
        // POST: leave the submitted value alone rather than discarding it. The
        // raw editor sets `invalid`, which already disables submit.
        return;
      }
      // Valid JSON that is not an OBJECT is the same situation: an array, a
      // scalar or null is not a properties bag, and folding one through
      // `writeDeclaration` turned it into {} or spread it into numeric keys —
      // so merely opening the node rewrote it (@copilot on #867). Splitting it
      // is not possible, so the form carries it through untouched.
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
      rest = parsed as Record<string, unknown>;
    }
    const merged = writeSkillExport(rest, skillExport);
    $formData.propertiesJson = Object.keys(merged).length > 0 ? JSON.stringify(merged, null, 2) : '';
  });

  // Shown for a task node, and ALSO whenever a declaration already exists — a
  // declaration on a node whose Runnable flag was later cleared must stay
  // reachable, or it becomes unreachable except through the raw JSON this
  // section exists to replace.
  const showSkillExport = $derived(
    $formData.isRunnable || skillExport !== null || exportDivergent,
  );

  // #878: what a freshly checked export starts with, from the node's own loc,
  // name and description (edited on the node page's Settings tab).
  const exportDefaults = $derived({
    name: defaultSkillName(node.loc ?? '', node.name ?? '', node.id),
    description: (node.description ?? '').trim(),
  });

  // #878 item 1: "The page is massively overloaded … At the very least, it
  // needs to show sections that are collapsed when the page is opened." EVERY
  // section starts closed (@Holger: the reader sees what is offered and drills
  // into what they want). A section holding an error opens itself, since a
  // problem inside a closed <details> is a problem nobody sees.
  //
  // Each effect also READS `node.id`. Reseeding closes both sections on a
  // navigation; if node A and node B both have an error, the attention value
  // does not change, so without that read the effect would not re-run and B's
  // error would sit in a closed section.
  let storageOpen = $state(false);
  $effect(() => {
    void node.id;
    if (propertiesInvalid || propertiesError) storageOpen = true;
  });
  // The same rule for Skill export: an existing declaration with an invalid
  // name, a missing or over-long description, or a node no longer runnable
  // renders a diagnostic INSIDE the section, and so do disagreeing host
  // entries — none of which a closed section shows (@codex on #887).
  const skillNeedsAttention = $derived(
    exportDivergent ||
      (skillExport !== null &&
        declarationProblems(skillExport.declaration, { runnable: $formData.isRunnable }).length > 0),
  );
  let skillOpen = $state(false);
  $effect(() => {
    void node.id;
    if (skillNeedsAttention) skillOpen = true;
  });

</script>

<svelte:head><title>Edit &middot; {node.loc} &middot; Hadron</title></svelte:head>

<div class="max-w-3xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="{basePath}/nodes/{node.id}" class="text-sm text-indigo-500 hover:underline dark:text-indigo-400">&larr; Back to node</a>
    <h1 class="font-mono text-lg font-bold text-zinc-900 dark:text-white">{node.loc}</h1>
  </div>

  {#if data.noWriteDoor}
    <!-- The node has no single write path, so no Save here can succeed. Said
         up front, and Save is disabled, rather than letting the user edit and
         then be refused (@copilot on #887). -->
    <p id="no-write-door" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      {data.noWriteDoor}
    </p>
  {/if}

  {#if actionError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{actionError}</div>
  {/if}

  <form method="POST" use:enhance class="space-y-6" novalidate>
    <!-- #878: only what the node page has no tab for. Name, loc, description,
         alias, seq, tags and Runnable are on its Settings tab; content,
         abstract and edges on their own tabs. Both sections start closed so
         the reader sees what is offered and opens what they want. -->
    <input type="hidden" name="isRunnable" value={String($formData.isRunnable)} />

    <!-- #588 (server #725): collection discriminator + typed properties. -->
    <details bind:open={storageOpen} class="space-y-4">
      <summary class="cursor-pointer border-b border-zinc-200 pb-2 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"><h2 class="inline">{t('node-edit.section.storage', 'Structured storage')}</h2></summary>

      <div>
        <label for="objectType" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">{createNodeStrings.fieldObjectType()}</label>
        {#if collectionNames.length > 0 || undeclaredCurrent}
          <select id="objectType" name="objectType" bind:value={$formData.objectType}
            class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none">
            <option value="">{createNodeStrings.objectTypeNone()}</option>
            {#each collectionNames as name (name)}
              <option value={name}>{name}</option>
            {/each}
            {#if undeclaredCurrent}
              <option value={undeclaredCurrent}>{undeclaredCurrent} (not declared)</option>
            {/if}
          </select>
          <p class="mt-1 text-xs text-zinc-500">{createNodeStrings.objectTypeHintDeclared()}</p>
        {:else}
          <input id="objectType" name="objectType" type="text" bind:value={$formData.objectType}
            placeholder="e.g. competitor"
            class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
          <p class="mt-1 text-xs text-zinc-500">{createNodeStrings.objectTypeHintFreeform()}</p>
        {/if}
      </div>

      <div>
        <span class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">{createNodeStrings.fieldProperties()}</span>
        <input type="hidden" name="propertiesJson" value={$formData.propertiesJson} />
        <!-- Re-mount on objectType change so typed field state re-seeds — and
             on NODE change too. Keyed on objectType alone, two nodes sharing an
             object type kept node A's typed values through a navigation, which
             is the same reuse trap as the export section below (@copilot on
             #867). -->
        {#key `${node.id}:${$formData.objectType}`}
          <PropertiesEditor
            declared={declaredCollection}
            bind:value={restJson}
            bind:invalid={propertiesInvalid}
          />
        {/key}
        {#if propertiesError}
          <p class="mt-1 text-xs text-red-600 dark:text-red-400">{propertiesError}</p>
        {/if}
      </div>
    </details>

    <!-- portal#864 Part A / #878: the skill export, which lives at
         properties.exports.{claudeSkill,codex} and was hand-typed JSON until
         #864. One checkbox since #878. -->
    {#if showSkillExport}
      <details bind:open={skillOpen} class="space-y-4">
        <summary class="cursor-pointer border-b border-zinc-200 pb-2 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"><h2 class="inline">{t('node-edit.section.skill-export', 'Skill export')}</h2></summary>
        <!-- Keyed on the node so the editor's OWN state (its "Change the
             skill's name and description" panel) starts fresh on a
             node-to-node navigation, like the sections around it (@copilot
             on #887). -->
        {#key node.id}
        <SkillExportEditor
          bind:value={skillExport}
          bind:runnable={$formData.isRunnable}
          divergent={exportDivergent}
          rawPropertiesEditable={!declaredCollection}
          runnableBlockedBy={data.runnableBlockedBy ?? null}
          defaults={exportDefaults}
        />
        {/key}
      </details>
    {/if}

    <!-- Actions -->
    <div class="flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <button
        type="submit"
        disabled={$submitting || propertiesInvalid || !!propertiesError || !!data.noWriteDoor}
        aria-describedby={data.noWriteDoor ? 'no-write-door' : undefined}
        class="rounded-lg bg-amber-500 px-6 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {$submitting ? 'Saving...' : 'Save'}
      </button>
      <a href="{basePath}/nodes/{node.id}" class="text-sm text-zinc-500 hover:text-zinc-300">Cancel</a>
    </div>
  </form>
</div>
