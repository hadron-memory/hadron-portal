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
    defaults,
  }: {
    value: SkillExport | null;
    runnable: boolean;
    /** The stored host entries disagree; the raw properties editor owns them. */
    divergent?: boolean;
    /**
     * Whether the page offers a raw JSON editor for the rest of the bag. A node
     * of a DECLARED collection gets typed fields instead, where `exports` is
     * shown read-only — so pointing there would send the user to a dead end.
     */
    rawPropertiesEditable?: boolean;
    /** What a freshly checked export starts with — derived from the node's own fields. */
    defaults: { name: string; description: string };
  } = $props();

  const HOST_LABELS: Record<string, string> = {
    [CLAUDE_SKILL_HOST]: 'Claude',
    [CODEX_HOST]: 'Codex',
  };

  let detailsOpen = $state(false);

  const enabled = $derived(value?.declaration.enable ?? false);
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
      value = enableSkillExport(value, defaults);
      // The server refuses a skill on a node that is not runnable
      // (`skill-not-runnable`), so the intent "export this" includes it.
      runnable = true;
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

  const hostList = (hosts: readonly string[]) =>
    hosts.map((h) => HOST_LABELS[h] ?? h).join(' and ');
</script>

<div class="space-y-3">
  {#if divergent}
    <!--
      The stored Claude and Codex entries cannot be shown as ONE declaration.
      Writing one back would overwrite the other with values the user never
      saw, so the raw properties editor keeps them, verbatim.
    -->
    <p class="text-sm text-zinc-600 dark:text-zinc-400">
      {t(
        'skill-export.divergent',
        'This node’s Claude and Codex export settings differ, so they can’t be edited as one here.',
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
        onchange={(e) => toggle(e.currentTarget.checked)}
        class="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-900"
      />
      {t('skill-export.enable', 'Export this node as a skill')}
    </label>

    {#if value}
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
