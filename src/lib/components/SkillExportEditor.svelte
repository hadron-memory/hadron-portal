<script lang="ts">
  // portal#864 Part A — a real affordance for `properties.exports.claudeSkill`.
  //
  // Until now a user declared a node for export by hand-typing JSON into a raw
  // <textarea>, which is what @Holger objected to: "The `properties` JSON is
  // something the user cannot be asked to build by hand." `enable` defaulting
  // to OFF sharpens it — mistype one key and you get a declaration that
  // silently never publishes, with no error and no file.
  //
  // ## This component owns the `exports` key and nothing else
  //
  // The page splits the properties bag: this editor gets `exports`, the
  // PropertiesEditor gets the rest, and the page recombines before submit. Two
  // editors bound to one serialized string would clobber each other —
  // PropertiesEditor seeds its field state once and re-seeds only on remount,
  // so whichever wrote last would win and the other's edit would vanish.
  //
  // The write path is read-modify-write of the WHOLE bag, inherited from the
  // edit form rather than re-implemented: see `skill-export.ts` and
  // hadron-server#1227 for why a patch-shaped write loses sibling hosts.
  import { t } from '$lib/i18n/t';
  import {
    DESCRIPTION_MAX,
    declarationProblems,
    type SkillDeclaration,
  } from '$lib/skill-export';

  let {
    declaration = $bindable(null),
  }: { declaration: SkillDeclaration | null } = $props();

  const EMPTY: SkillDeclaration = { name: '', description: '', enable: false };

  function declare() {
    declaration = { ...EMPTY };
  }
  function undeclare() {
    declaration = null;
  }

  const problems = $derived(declaration ? declarationProblems(declaration) : []);
  const used = $derived(declaration?.description.length ?? 0);
  const over = $derived(used > DESCRIPTION_MAX);
</script>

<div class="space-y-3">
  {#if declaration === null}
    <!-- ABSENT. Distinct from declared-and-off, which is a state below. -->
    <p class="text-sm text-zinc-600 dark:text-zinc-400">
      {t(
        'skill-export.absent',
        'This node is not declared for export. Declaring it records a skill name and description on the node; it does not create any file.',
      )}
    </p>
    <button
      type="button"
      onclick={declare}
      class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {t('skill-export.declare', 'Declare for export')}
    </button>
  {:else}
    <!--
      DECLARED. `enable` is rendered as a state with a label, not as a bare
      checkbox, because "declared but switched off" is a thing the platform
      keeps on purpose: listDeclaredIDs deliberately does not filter on
      `enable`, so lint can judge a not-enabled declaration BEFORE someone
      turns it on. A UI that rendered off and absent identically would throw
      that distinction away (#864).
    -->
    <div
      class="rounded-lg border px-3 py-2 text-xs {declaration.enable
        ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
        : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}"
    >
      {#if declaration.enable}
        {t('skill-export.state-on', 'Declared and switched on — this node will export.')}
      {:else}
        {t(
          'skill-export.state-off',
          'Declared but switched OFF — this node will not export until you switch it on. That is different from not being declared at all.',
        )}
      {/if}
    </div>

    <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
      <input
        type="checkbox"
        bind:checked={declaration.enable}
        class="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-900"
      />
      {t('skill-export.enable', 'Export this node as a Claude skill')}
    </label>

    <div>
      <label
        for="skill-export-name"
        class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400"
      >
        {t('skill-export.name', 'Skill name')}
      </label>
      <input
        id="skill-export-name"
        type="text"
        bind:value={declaration.name}
        spellcheck="false"
        class="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      />
      <p class="mt-1 text-xs text-zinc-500">
        {t(
          'skill-export.name-hint',
          'Stored exactly as typed — there is no prefix and nothing is derived from it.',
        )}
      </p>
    </div>

    <div>
      <label
        for="skill-export-description"
        class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400"
      >
        {t('skill-export.description', 'Description')}
      </label>
      <textarea
        id="skill-export-description"
        rows="4"
        bind:value={declaration.description}
        spellcheck="false"
        style="resize: vertical;"
        class="w-full rounded-lg border px-3 py-2 font-mono text-xs {over
          ? 'border-red-400 dark:border-red-700'
          : 'border-zinc-300 dark:border-zinc-700'} dark:bg-zinc-900 dark:text-white"
      ></textarea>
      <!--
        Counted against the LIVE value rather than validated on save: six of the
        twenty declarations in the corpus already exceed the cap, and a user has
        no way to find that out today until an export fails (#864).
      -->
      <p class="mt-1 text-xs {over ? 'text-red-600 dark:text-red-400' : 'text-zinc-500'}">
        {used} / {DESCRIPTION_MAX}
      </p>
    </div>

    {#if problems.length > 0}
      <ul class="space-y-1">
        {#each problems as problem (problem)}
          <li class="text-xs text-red-600 dark:text-red-400">{problem}</li>
        {/each}
      </ul>
    {/if}

    <button
      type="button"
      onclick={undeclare}
      class="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {t('skill-export.undeclare', 'Remove this declaration')}
    </button>
  {/if}

  <!--
    #864 explicitly: say what the portal will NOT do. Writing SKILL.md into a
    checkout is a local-filesystem act and a browser has no business there.
    Leaving a user to discover that is the reason it is in the scope.
  -->
  <p class="border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
    {t(
      'skill-export.no-export-here',
      'The portal cannot write the file. Mark it here, and the skill appears when someone runs `hadron skill export`.',
    )}
  </p>
</div>
