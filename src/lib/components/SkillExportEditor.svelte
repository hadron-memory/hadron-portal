<script lang="ts">
  // portal#878 — skill export as ONE checkbox.
  //
  // #864 Part A exposed the declaration model faithfully and asked the user to
  // understand it: declare, then enable, then name, then describe. @Holger:
  // "The export part should have been a single checkbox. The user checks it,
  // all defaults are set to enable the export. Then a link that the user can
  // click to change the defaults, but that's optional."
  //
  // So checking the box does everything: it switches the export on for every
  // host (`claudeSkill` and `codex` — a declaration is per-host, D12), fills an
  // empty name and description with defaults, and marks the node Runnable,
  // which the server requires of any skill. The fields are behind a link.
  //
  // ## This component owns the skill hosts under `exports`, nothing else
  //
  // The page splits the properties bag: this editor gets the `claudeSkill` and
  // `codex` entries (as one `SkillExport`), the PropertiesEditor gets the rest,
  // and the page recombines before submit. Two editors bound to one serialized
  // string would clobber each other. The write path is read-modify-write of the
  // WHOLE bag — see `skill-export.ts` and hadron-server#1227.
  import { t } from '$lib/i18n/t';
  import {
    CLAUDE_SKILL_HOST,
    CODEX_HOST,
    DESCRIPTION_MAX,
    SKILL_HOSTS,
    codePoints,
    declarationProblems,
    enableSkillExport,
    type SkillExport,
  } from '$lib/skill-export';

  let {
    value = $bindable(null),
    runnable = $bindable(false),
    divergent = false,
    rawPropertiesEditable = true,
    runnableBlockedBy = null,
    strictCollection = null,
    defaults,
  }: {
    value: SkillExport | null;
    runnable: boolean;
    /**
     * The stored host entries cannot be shown as ONE declaration — they
     * disagree, or one carries a field this form does not edit. The raw
     * properties editor owns them.
     */
    divergent?: boolean;
    /**
     * Whether the page offers a raw JSON editor for the rest of the bag. A node
     * of a DECLARED collection gets typed fields instead, where `exports` is
     * shown read-only — so pointing there would send the user to a dead end.
     */
    rawPropertiesEditable?: boolean;
    /**
     * The governed kind(s) that stop this node becoming runnable here (a
     * `review` or `spec` role), or null. Decided by the server-side door
     * chooser the save uses, so no action is offered that the save rejects.
     */
    runnableBlockedBy?: string | null;
    /**
     * The node's collection when its schema cannot hold an `exports` object —
     * it is strict, or it declares `exports` as a (scalar) field — or null.
     * Either way the server's `validateNodeAgainstSchema` rejects the save
     * (@copilot, @codex on #887).
     */
    strictCollection?: string | null;
    /** What a freshly checked export starts with — derived from the node's own fields. */
    defaults: { name: string; description: string };
  } = $props();

  const HOST_LABELS: Record<string, string> = {
    [CLAUDE_SKILL_HOST]: 'Claude',
    [CODEX_HOST]: 'Codex',
  };

  let detailsOpen = $state(false);

  const enabled = $derived(value?.declaration.enable ?? false);
  // Switching the export ON needs a runnable node, and on a node the save can
  // not make runnable (a `review` or `spec` role) that would persist an
  // enabled declaration the exporter rejects as `skill-not-runnable`
  // (@codex on #887). Switching it OFF stays possible.
  // On a collection that cannot hold `exports`, the box is disabled in BOTH
  // directions: switching off only sets `enable: false`, and the key itself is
  // what the server rejects — so only removing it saves (@copilot on #887).
  // That removal is the Clear button rendered beside the reason.
  const cannotEnable = $derived(
    !!strictCollection || (!enabled && !runnable && !!runnableBlockedBy),
  );
  const missingHosts = $derived(
    value ? SKILL_HOSTS.filter((h) => !value!.hosts.includes(h)) : [],
  );
  const problems = $derived(
    value ? declarationProblems(value.declaration, { runnable }) : [],
  );
  const used = $derived(value ? codePoints(value.declaration.description) : 0);
  const over = $derived(used > DESCRIPTION_MAX);

  function toggle(checked: boolean) {
    if (checked) {
      if (cannotEnable) return;
      value = enableSkillExport(value, defaults);
      // The server refuses a skill on a node that is not runnable
      // (`skill-not-runnable`), so the intent "export this" includes it —
      // unless the save could not carry it (see `runnableBlockedBy`).
      if (!runnableBlockedBy) runnable = true;
    } else if (value) {
      // Unchecking keeps the name and description, so re-checking restores them.
      value = { ...value, declaration: { ...value.declaration, enable: false } };
    }
  }

  function addMissingHosts() {
    if (value) value = { ...value, hosts: [...SKILL_HOSTS] };
  }

  function clear() {
    value = null;
    detailsOpen = false;
  }

  // The list's grammar is copy too, so it goes through `t()` rather than a
  // literal ' and ' (@codex on #887). Folded pairwise, which covers any count
  // of hosts with one translatable template.
  const hostList = (hosts: readonly string[]) =>
    hosts
      .map((h) => HOST_LABELS[h] ?? h)
      .reduce((acc, label) =>
        t('skill-export.host-list.and', '{first} and {second}', { first: acc, second: label }),
      );
</script>

<div class="space-y-3">
  {#if divergent}
    <!--
      The stored entries cannot be shown as ONE declaration: Claude and Codex
      disagree, or one carries a field this form does not edit. Writing one
      back would overwrite or drop something the user never saw, so the raw
      properties editor keeps them, verbatim.
    -->
    <p class="text-sm text-zinc-600 dark:text-zinc-400">
      {t(
        'skill-export.divergent',
        'This node’s export settings can’t be edited with the checkbox here: the Claude and Codex entries differ, or carry fields this form doesn’t edit.',
      )}
      {#if rawPropertiesEditable}
        {t('skill-export.divergent-where', 'Change them under Structured storage → Properties.')}
      {/if}
    </p>
  {:else}
    <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
      <input
        type="checkbox"
        checked={enabled}
        disabled={cannotEnable}
        aria-describedby={strictCollection
          ? 'skill-export-strict'
          : runnableBlockedBy && !runnable
            ? 'skill-export-runnable-blocked'
            : undefined}
        onchange={(e) => toggle(e.currentTarget.checked)}
        class="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-900"
      />
      {t('skill-export.enable', 'Export this node as a skill')}
    </label>

    {#if strictCollection}
      <!-- The collection's schema cannot hold an `exports` object, so the save
           would refuse the export. Shown in both states: it is why the box
           cannot be switched on, and why an export already present will not
           save (@copilot, @codex on #887). -->
      <p id="skill-export-strict" class="text-xs text-zinc-600 dark:text-zinc-400">
        {t(
          'skill-export.strict-collection',
          'This node’s object type, {collection}, doesn’t allow an exports object in its properties, so it can’t carry a skill export.',
          { collection: strictCollection },
        )}
      </p>
      {#if value}
        <button
          type="button"
          onclick={clear}
          class="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {t('skill-export.clear', 'Clear skill export')}
        </button>
      {/if}
    {:else if runnableBlockedBy && !runnable}
      <!-- Shown whether the export is on or off: it is the reason the box
           cannot be switched on, and the reason an enabled one will not export. -->
      <p id="skill-export-runnable-blocked" class="text-xs text-zinc-600 dark:text-zinc-400">
        {t(
          'skill-export.runnable-blocked',
          'The portal can’t make a {kind} node runnable, so it can’t export this one as a skill.',
          { kind: runnableBlockedBy },
        )}
      </p>
    {/if}

    {#if value && !strictCollection}
      <p class="text-xs text-zinc-500">
        {#if enabled}
          {t('skill-export.summary-on', 'Exported as')}
          <code class="font-mono text-zinc-700 dark:text-zinc-300">{value.declaration.name || '—'}</code>
          · {t('skill-export.summary-hosts', 'for {hosts}.', { hosts: hostList(value.hosts) })}
        {:else}
          {t('skill-export.summary-off', 'Export is off. The name and description are kept for when you turn it back on.')}
        {/if}
      </p>

      {#if enabled && missingHosts.length > 0}
        <!--
          A declaration written before #878 names Claude only. Saving the node
          must not silently widen it, so adding the missing host is an explicit
          click rather than a side effect of opening the page.
        -->
        <button
          type="button"
          onclick={addMissingHosts}
          class="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          {t('skill-export.add-hosts', 'Also export for {hosts}', { hosts: hostList(missingHosts) })}
        </button>
      {/if}

      {#if problems.length > 0}
        <ul class="space-y-1">
          {#each problems as problem (problem)}
            <li class="text-xs text-red-600 dark:text-red-400">{problem}</li>
          {/each}
        </ul>
      {/if}

      {#if enabled && !runnable && !runnableBlockedBy}
        <!--
          The Runnable control is on the node's Settings tab, not this page, so
          the fix is offered here rather than described (@copilot on #887).
        -->
        <button
          type="button"
          onclick={() => (runnable = true)}
          class="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {t('skill-export.make-runnable', 'Mark this node runnable')}
        </button>
      {/if}

      <details bind:open={detailsOpen}>
        <summary class="cursor-pointer text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          {t('skill-export.change-defaults', 'Change the skill’s name and description')}
        </summary>
        <div class="mt-3 space-y-3">
          <div>
            <label for="skill-export-name" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">
              {t('skill-export.name', 'Skill name')}
            </label>
            <input
              id="skill-export-name"
              type="text"
              bind:value={value.declaration.name}
              spellcheck="false"
              class="w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            />
          </div>

          <div>
            <label for="skill-export-description" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">
              {t('skill-export.description', 'Description')}
            </label>
            <textarea
              id="skill-export-description"
              rows="4"
              bind:value={value.declaration.description}
              spellcheck="false"
              style="resize: vertical;"
              class="w-full rounded-lg border px-3 py-2 text-sm {over
                ? 'border-red-400 dark:border-red-700'
                : 'border-zinc-300 dark:border-zinc-700'} dark:bg-zinc-900 dark:text-white"
            ></textarea>
            <p class="mt-1 text-xs {over ? 'text-red-600 dark:text-red-400' : 'text-zinc-500'}">
              {used} / {DESCRIPTION_MAX}
            </p>
          </div>

          <button
            type="button"
            onclick={clear}
            class="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t('skill-export.clear', 'Clear skill export')}
          </button>
        </div>
      </details>
    {/if}
  {/if}

  <!--
    #878 item 6: the old footnote named `hadron skill export`, and few users
    will ever install the CLI. Say only what is true on this page.
  -->
  <p class="border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
    {t(
      'skill-export.saves-settings-only',
      'This saves the export settings on the node. It does not create a skill file.',
    )}
  </p>
</div>
