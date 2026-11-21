<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  // #1031 — the Properties tab's storage form: object type, typed properties and
  // the skill export. It was the `/nodes/[nodeId]/edit` page (#588, #864, #878)
  // until #1031 put it on the tab, so most of what follows is that page's logic
  // unchanged. What changed is noted where it changed: it posts to the node
  // page's `?/updateStorage`, it shares that page's action data with a dozen
  // other forms, and it re-seeds when the STORED value changes, because the
  // Source view on the same tab can save the same bag.
  import { untrack } from 'svelte';
  import type { SuperValidated } from 'sveltekit-superforms';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import PropertiesEditor from '$lib/components/PropertiesEditor.svelte';
  import SkillExportEditor from '$lib/components/SkillExportEditor.svelte';
  import {
    declarationProblems,
    defaultSkillName,
    exportDeclarations,
    hasLegacyExport,
    readSkillExport,
    withoutSkillExport,
    writeSkillExport,
    type SkillExport,
  } from '$lib/skill-export';
  import { canonicalJson, sameProperties } from '$lib/properties-source';
  import { failedSubmission } from '$lib/forms/submitted-form';
  import { serverRefuses } from '$lib/skill-check';
  import { t } from '$lib/i18n/t';
  import { createNodeStrings } from '$lib/i18n/create-node-strings';
  import { declaredObjectType, objectTypeNames, readMemorySchema } from '$lib/schema/memory-schema';
  import type { SkillCheck } from '$lib/skill-check';
  import type { MemoryNode } from '$lib/types';
  import { nodeStorageSchema } from './storage-schema';
  import type { NodeStorageForm } from './storage-action';

  let {
    node,
    memorySchema,
    seed,
    actionData,
    action,
    skillCheck,
    runnableBlockedBy = null,
    noWriteDoor = null,
  }: {
    node: MemoryNode;
    /** The memory's raw schema, as the memory layout loads it. */
    memorySchema: unknown;
    /** The loader's seed for this form. */
    seed: SuperValidated<NodeStorageForm, App.Superforms.Message, NodeStorageForm>;
    /** The node page's action data, which every form on that page shares. */
    actionData: unknown;
    /** Where the form posts: the node page's `updateStorage` action. */
    action: string;
    /** The server's lint verdict on the stored export; null when it was not asked. */
    skillCheck: SkillCheck | null;
    runnableBlockedBy?: string | null;
    noWriteDoor?: string | null;
  } = $props();

  // A FAILED submission only (#957): a successful one carries the posted
  // values too, and seeding from it on a remount would re-fill the form with
  // what was already sent.
  const initialForm = untrack(
    () => (failedSubmission<NodeStorageForm>(actionData, 'updateStorage') as typeof seed | null) ?? seed,
  );
  const {
    form: formData,
    errors,
    message,
    submitting,
    enhance,
  } = superForm(initialForm, {
    validators: zod4Client(nodeStorageSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    // #1031: a successful save no longer navigates away, so superforms' default
    // reset would put back the seed this form MOUNTED with — the bag as it was
    // before the save — while the split state below still holds the saved one.
    // The hidden `propertiesJson` would then post the old bag on the next Save.
    // The re-seed effect below brings the form to the stored value instead.
    resetForm: false,
  });

  const actionError = $derived($message?.type === 'error' ? $message.text : null);
  const actionSuccess = $derived($message?.type === 'success' ? $message.text : null);
  // "Saved." describes the value that was saved. Once the form is edited again
  // it would sit beside an unsaved (perhaps invalid) value, so an edit clears it
  // (Cody on #1035; the same rule as #971's register default). An error stays:
  // it still describes the last attempt.
  //
  // Watched on the form DATA, not on DOM events: several edits here are buttons
  // ("Remove property", "Clear", "Mark this node runnable") that fire no input
  // or change event, so an event listener left "Saved." beside them (Cody's
  // follow-up on #1035). Compared by CONTENT, because the post-save re-seed
  // rewrites the bag in its own formatting without changing it. The editors'
  // own state is part of it: text that does not parse yet never reaches the
  // submitted field, and it is an edit all the same.
  function parsedOrText(raw: string): unknown {
    try {
      return raw.trim() ? JSON.parse(raw) : null;
    } catch {
      return raw;
    }
  }
  function editedContent(): string {
    return canonicalJson({
      objectType: $formData.objectType,
      isRunnable: $formData.isRunnable,
      bag: parsedOrText($formData.propertiesJson),
      rest: parsedOrText(restJson),
      skillExport,
    });
  }
  let savedContent: string | null = null;
  $effect(() => {
    const current = editedContent();
    if ($message?.type !== 'success') {
      savedContent = null;
      return;
    }
    if (savedContent === null) savedContent = current;
    else if (current !== savedContent) message.set(undefined);
  });

  // #588 (server #725): structured storage. With a memory schema, objectType
  // is a picker over the declared collections; without one it's free text.
  // A pre-schema node may carry an objectType that is no longer declared —
  // keep it selectable (marked) so the bound value isn't orphaned. That is a
  // reason to ADD an option to the picker, never to show a picker: without a
  // schema the field is free text whatever it holds (#1040 — the first
  // character typed made `undeclaredCurrent` truthy and swapped the input for
  // a select mid-keystroke).
  const schema = $derived(readMemorySchema(memorySchema));
  const collectionNames = $derived(objectTypeNames(schema));
  const declaredCollection = $derived(declaredObjectType(schema, $formData.objectType || null));
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
  // `codexSkill`), PropertiesEditor gets everything else, and the two are recombined
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
    legacy?: boolean;
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
    // A retired top-level `skill` / `claudeSkill` declaration: the server reads
    // it as Claude's, and the checkbox edits only `exports`, so offering the
    // checkbox would show "off" beside an export that is on and edit a
    // different key (@codex on #905). The raw editor keeps the WHOLE bag —
    // modern hosts included — so the recombination writes every key back.
    if (hasLegacyExport(parsed)) {
      return { skillExport: null, divergent: true, legacy: true, rest: raw };
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
  // #882: the server's verdict (skillCheck) is on the STORED node, so the
  // editor must know when the form differs from it. Compared on the WHOLE
  // `exports` object of the bag the form will actually submit — the checkbox
  // editor's value, a divergent entry edited as raw JSON, or a cleared export
  // all land there (@copilot on #905) — canonically, since JSONB does not keep
  // key order. Against the loader's node, which follows a node-to-node
  // navigation and stays the stored value after a failed POST.
  function exportsOf(json: string): unknown {
    if (!json.trim()) return {};
    try {
      return exportDeclarations(JSON.parse(json));
    } catch {
      return undefined; // unparseable: certainly not what the server judged
    }
  }
  const exportUnsaved = $derived.by(() => {
    const current = exportsOf($formData.propertiesJson);
    return (
      current === undefined ||
      !sameProperties(current, exportDeclarations(node.properties)) ||
      $formData.isRunnable !== (node.isRunnable ?? false)
    );
  });
  let skillExport = $state<SkillExport | null>(initialSplit.skillExport);
  let exportDivergent = $state(initialSplit.divergent);
  let exportLegacy = $state(initialSplit.legacy ?? false);
  let restJson = $state(initialSplit.rest);

  /**
   * RE-SEED WHEN THE NODE — OR WHAT IS STORED ON IT — CHANGES.
   *
   * SvelteKit reuses the node page across `/nodes/A -> /nodes/B`, so state
   * seeded once with `untrack` survives the navigation. Measured on the old
   * edit page before this: declaring an export on node A and navigating to
   * node B left A's declaration in B's form, ready to be saved onto B
   * (@copilot on #867).
   *
   * That is `hrn:node:hadronmemory.com:hadron-portal:review:a-reused-component-must-reseed-its-form`
   * — the check written after #857, where the same trap wrote one worker's
   * prompt override onto another. Third time in this repo.
   *
   * #1031: on the Properties tab the STORED value can also change under this
   * form without a navigation, because the Source view beside it saves the same
   * bag. Left unseeded, this form would still hold the old bag, and its next
   * Save would silently undo the Source save. So it re-seeds whenever the stored
   * object type, Runnable flag or properties change, which also covers its own
   * successful save (re-seeding to exactly what it just wrote).
   *
   * Seeded from `node`, the loader's value for the node now shown, NOT from the
   * form: an in-flight failed POST belongs to the node it was submitted for, and
   * re-reading the form would carry it across too.
   */
  function storedKey(n: MemoryNode): string {
    return [n.id, n.objectType ?? '', n.isRunnable ? '1' : '0', canonicalJson(n.properties ?? null)].join('|');
  }
  let seededFor = $state(untrack(() => storedKey(node)));
  let seededNodeId = $state(untrack(() => node.id));
  $effect(() => {
    const key = storedKey(node);
    if (untrack(() => seededFor) === key) return;
    const next = splitProperties(
      node.properties != null ? JSON.stringify(node.properties, null, 2) : '',
    );
    skillExport = next.skillExport;
    exportDivergent = next.divergent;
    exportLegacy = next.legacy ?? false;
    restJson = next.rest;
    // Node B starts collapsed like any node; the attention effects below
    // re-open a section for B's OWN errors (@copilot on #887). A re-seed of the
    // SAME node (after a save) leaves the sections as the reader arranged them.
    if (untrack(() => seededNodeId) !== node.id) {
      storageOpen = false;
      skillOpen = false;
      seededNodeId = node.id;
    }
    // The superForm store is seeded ONCE from node A's loader data too, and
    // its other two fields ride the same POST: A's `objectType` would render
    // on B and be saved onto it, and A's `isRunnable: true` would post through
    // the hidden input and silently make B runnable (@codex on #887). Reseeded
    // here explicitly rather than relying on superForm to resync on a
    // navigation — the harness cannot show that it does, and this write costs
    // nothing if it does.
    formData.update(
      (current) => ({
        ...current,
        objectType: node.objectType ?? '',
        isRunnable: node.isRunnable ?? false,
        // Set here as well as by the recombination effect below: that effect
        // re-runs only when the split state CHANGES, and a re-seed to the value
        // it already holds (after this form's own save) changes nothing.
        propertiesJson: node.properties != null ? JSON.stringify(node.properties, null, 2) : '',
      }),
      { taint: false },
    );
    seededFor = key;
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
    // #1041: write only a CHANGED bag. On mount this effect rebuilds the bag it
    // was handed, and after a failed full-page submission that bag is exactly
    // the one the server refused, in the browser's formatting. Re-writing it
    // anyway counted as an edit: superforms validated it client-side, the
    // client schema (valid JSON object) passed, and that result replaced the
    // server's verdict. The error vanished and Save came back on for a bag the
    // server had just rejected. Read untracked: this effect writes the field.
    if (sameBag(untrack(() => $formData.propertiesJson), merged)) return;
    $formData.propertiesJson = Object.keys(merged).length > 0 ? JSON.stringify(merged, null, 2) : '';
  });

  /** Does `serialized` hold exactly `bag`, whatever its formatting? */
  function sameBag(serialized: string, bag: Record<string, unknown>): boolean {
    const raw = (serialized ?? '').trim();
    if (!raw) return Object.keys(bag).length === 0;
    try {
      return sameProperties(JSON.parse(raw), bag);
    } catch {
      return false;
    }
  }

  // Shown for a task node, and ALSO whenever a declaration already exists — a
  // declaration on a node whose Runnable flag was later cleared must stay
  // reachable, or it becomes unreachable except through the raw JSON this
  // section exists to replace.
  const showSkillExport = $derived(
    // #905: a stored export the server judged keeps the section, and so its
    // verdict, on screen after Clear — even on a node that is not runnable.
    $formData.isRunnable || skillExport !== null || exportDivergent || skillCheck?.kind === 'checked',
  );

  // A declared collection that cannot hold an `exports` OBJECT, measured
  // against hadron-server's `validateNodeAgainstSchema`:
  //   - a STRICT collection rejects every undeclared key (@copilot on #887);
  //   - a collection that DECLARES `exports` type-checks it, and no field type
  //     (text/number/datetime/boolean/enum) accepts an object — strict or not
  //     (@codex on #887; the non-strict half found checking that claim).
  // Derived from the live object type, so switching the type above updates it.
  const strictCollection = $derived(
    declaredCollection && (declaredCollection.strict || Object.hasOwn(declaredCollection.fields, 'exports'))
      ? $formData.objectType
      : null,
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
  // #1041: starts OPEN when the form arrives carrying a server error on the
  // properties, i.e. a failed full-page submission. The attention effect below
  // only runs in the browser, so a server render put the error inside a closed
  // section, invisible until the reader thought to expand it.
  let storageOpen = $state(untrack(() => !!initialForm.errors?.propertiesJson?.length));
  $effect(() => {
    void node.id;
    if (propertiesInvalid || propertiesError) storageOpen = true;
  });
  // The same rule for Skill export: an existing declaration with an invalid
  // name, a missing or over-long description, or a node no longer runnable
  // renders a diagnostic INSIDE the section, and so do disagreeing host
  // entries — none of which a closed section shows (@codex on #887).
  //
  // Also opens for an export stored on a collection that cannot hold it — the
  // only action there is Clear, and it is inside this section (@copilot on
  // #887). A node with NO export on such a collection stays collapsed: the note
  // explains a disabled box, which is information, not an error to fix.
  const skillNeedsAttention = $derived(
    serverRefuses(skillCheck) ||
    exportDivergent ||
      (skillExport !== null && strictCollection !== null) ||
      (skillExport !== null &&
        declarationProblems(skillExport.declaration, { runnable: $formData.isRunnable }).length > 0),
  );
  let skillOpen = $state(false);
  $effect(() => {
    void node.id;
    if (skillNeedsAttention) skillOpen = true;
  });

</script>

<div class="space-y-6">
  {#if noWriteDoor}
    <!-- The node has no single write path, so no Save here can succeed. Said
         up front, and Save is disabled, rather than letting the user edit and
         then be refused (@copilot on #887). -->
    <p id="no-write-door" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      {noWriteDoor}
    </p>
  {/if}

  {#if actionError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{actionError}</div>
  {/if}

  <form method="POST" {action} use:enhance class="space-y-6" novalidate>
    <!-- #878: only what the node page has no other control for. Name, loc,
         description, alias, seq, tags and Runnable are on its Settings tab;
         content, abstract and edges on their own tabs. Both sections start
         closed so the reader sees what is offered and opens what they want. -->
    <input type="hidden" name="_kind" value="updateStorage" />
    <input type="hidden" name="isRunnable" value={String($formData.isRunnable)} />

    <!-- #588 (server #725): collection discriminator + typed properties. -->
    <details bind:open={storageOpen} class="space-y-4">
      <summary class="cursor-pointer border-b border-zinc-200 pb-2 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"><h2 class="inline">{t('node-edit.section.storage', 'Structured storage')}</h2></summary>

      <div>
        <label for="objectType" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">{createNodeStrings.fieldObjectType()}</label>
        {#if collectionNames.length > 0}
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
         properties.exports.{claudeSkill,codexSkill} and was hand-typed JSON until
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
          legacy={exportLegacy}
          rawPropertiesEditable={!declaredCollection}
          runnableBlockedBy={runnableBlockedBy ?? null}
          {strictCollection}
          defaults={exportDefaults}
          serverCheck={skillCheck}
          unsaved={exportUnsaved}
        />
        {/key}
      </details>
    {/if}

    <!-- Actions -->
    <!-- A plain wrapper: an idle region as a flex gap item or the last child of a space-y parent shifts layout (Marco's placement ruling, #127408). -->
    <div>
      <div class="flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <button
          type="submit"
          disabled={$submitting || propertiesInvalid || !!propertiesError || !!noWriteDoor}
          aria-describedby={noWriteDoor ? 'no-write-door' : undefined}
          class="rounded-lg bg-amber-500 px-6 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {$submitting ? t('node-storage.saving', 'Saving…') : actionError ? t('node.save.retry', 'Retry') : t('node-storage.save', 'Save')}
        </button>
      </div>
      <!-- After the row, not its last item: an idle region there is a flex gap item (Marco's placement ruling, #127408). -->
      <LiveRegion>
        {#if actionSuccess}
          <p class="mt-2 text-sm text-green-600 dark:text-green-400">{actionSuccess}</p>
        {/if}
      </LiveRegion>
    </div>
  </form>
</div>
