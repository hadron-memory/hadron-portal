<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import SelectNode from '$lib/components/SelectNode.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { dayName, timingSentence, type Timing } from '$lib/automation/schedule-timing';
  import { t } from '$lib/i18n/t';
  import type { NodeChoice, MemoriesRead } from '$lib/node-choices';

  /**
   * portal#1701 — one form for making and changing a schedule.
   *
   * The user wants to say what runs and when. So: pick what runs by its name, say when in plain terms, and press the
   * one button. Nothing here types a cron expression, a URN, a row id or a hash; the server action writes the cron
   * from the plain choice and the URN comes from the picker.
   *
   * On an edit, timing the plain controls cannot express (a cron made in the CLI) is shown as it is and stays
   * untouched unless the user asks to change it ("Change when it runs"); then the same controls appear.
   */
  type Initial = { name: string; entryNodeUrn: string; entryName: string | null; timing: Timing | null; timezone: string | null };
  type Failure = { field: string; message: string } | null;

  let {
    mode,
    initial,
    nodeMemories,
    failure = null,
    submitLabel,
    submitting = false,
    canSubmit = true,
    blockedReason = null,
    preview,
  }: {
    mode: 'create' | 'edit';
    initial: Initial;
    nodeMemories: Promise<MemoriesRead> | MemoriesRead;
    failure?: Failure;
    submitLabel: string;
    submitting?: boolean;
    /** Create stays off until the summary shows; a refused summary says why in `blockedReason`. */
    canSubmit?: boolean;
    blockedReason?: string | null;
    /** What the automation will read, write and not do. Create only. */
    preview?: Snippet;
  } = $props();

  const uid = $props.id();
  const id = (n: string) => `${uid}-${n}`;

  const seed = untrack(() => initial);
  let entry = $state<{ urn: string; name: string | null }>({ urn: seed.entryNodeUrn, name: seed.entryName });
  let picking = $state(false);
  let name = $state(seed.name);

  // Timing: the stored choice when the plain controls can express it, else nothing chosen yet.
  const plain = seed.timing && seed.timing.kind !== 'custom' ? seed.timing : null;
  // An edit of a schedule the controls cannot express keeps its timing until the user asks to change it.
  let keepTiming = $state(mode === 'edit' && (seed.timing === null || seed.timing.kind === 'custom'));
  let when = $state<string>(plain?.kind ?? (mode === 'create' ? 'daily' : ''));
  let hours = $state(plain?.kind === 'interval' ? String(plain.hours) : '4');
  let time = $state(plain && 'time' in plain ? plain.time : '09:00');
  let days = $state<string[]>(plain?.kind === 'weekdays' ? plain.days.map(String) : ['1', '2', '3', '4', '5']);
  let date = $state('');

  // A new schedule's zone is the browser's, sent explicitly (the server would otherwise default to UTC). An edit keeps the stored zone.
  let browserZone = $state('');
  onMount(() => {
    try { browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { browserZone = ''; }
  });
  const zone = $derived(mode === 'edit' ? (seed.timezone ?? '') : browserZone);

  const errorFor = (field: string) => (failure && failure.field === field ? failure.message : null);
  const input = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white';
  const label = 'block text-sm font-medium text-zinc-900 dark:text-white';
  const OPTIONS = [
    ['interval', () => t('app.automations.form.when.interval', 'Every few hours')],
    ['daily', () => t('app.automations.form.when.daily', 'Every day')],
    ['weekdays', () => t('app.automations.form.when.weekdays', 'On chosen days of the week')],
    ['once', () => t('app.automations.form.when.once', 'Once')],
  ] as const;
</script>

<div class="space-y-6">
  <!-- What runs -->
  <div class="space-y-2">
    <p id={id('what')} class={label}>{t('app.automations.form.what', 'What runs')}</p>
    {#if entry.urn}
      <div aria-labelledby={id('what')}>
        {#if entry.name}<p class="text-sm text-zinc-900 dark:text-white">{entry.name}</p>{/if}
        <div class={entry.name ? 'mt-1' : ''}><Urn value={entry.urn} type="node" /></div>
      </div>
    {:else}
      <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.automations.form.what.none', 'None chosen')}</p>
    {/if}
    <button type="button" onclick={() => (picking = true)} aria-describedby={id('what')}
      class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
      {entry.urn ? t('app.automations.form.what.change', 'Change…') : t('app.automations.form.what.choose', 'Choose…')}
    </button>
    {#if errorFor('entry')}<p role="alert" class="text-sm text-red-700 dark:text-red-300">{errorFor('entry')}</p>{/if}
    <input type="hidden" name="entryNodeUrn" value={entry.urn} />
    <input type="hidden" name="entryName" value={entry.name ?? ''} />
  </div>

  {#if mode === 'edit'}
    <div class="space-y-1">
      <label for={id('name')} class={label}>{t('app.automations.form.name', 'Name')}</label>
      <input id={id('name')} name="name" type="text" required maxlength="200" autocomplete="off" bind:value={name} class={input} />
      {#if errorFor('name')}<p role="alert" class="text-sm text-red-700 dark:text-red-300">{errorFor('name')}</p>{/if}
    </div>
  {/if}

  <!-- When -->
  {#if keepTiming}
    <div class="space-y-2">
      <p class={label}>{t('app.automations.form.when', 'When it runs')}</p>
      <p class="text-sm text-zinc-700 dark:text-zinc-300" data-testid="schedule-form-kept-timing">
        {seed.timing ? timingSentence(seed.timing, seed.timezone ?? '') : t('app.automations.form.when.unset', 'No time is set.')}
      </p>
      <input type="hidden" name="keepTiming" value="1" />
      <button type="button" onclick={() => (keepTiming = false)}
        class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
        {t('app.automations.form.when.change', 'Change when it runs')}
      </button>
    </div>
  {:else}
    <fieldset class="space-y-3">
      <legend class={label}>{t('app.automations.form.when', 'When it runs')}</legend>
      <div class="space-y-1.5">
        {#each OPTIONS as [value, text] (value)}
          <label class="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
            <input type="radio" name="when" {value} bind:group={when} class="accent-indigo-600" />
            {text()}
          </label>
        {/each}
      </div>

      {#if when === 'interval'}
        <div class="space-y-1">
          <label for={id('hours')} class={label}>{t('app.automations.form.hours', 'Every how many hours')}</label>
          <input id={id('hours')} name="hours" type="number" min="1" max="23" step="1" required bind:value={hours} class="{input} max-w-32" />
          {#if errorFor('hours')}<p role="alert" class="text-sm text-red-700 dark:text-red-300">{errorFor('hours')}</p>{/if}
        </div>
      {:else if when === 'weekdays'}
        <fieldset class="space-y-1">
          <legend class="text-sm text-zinc-700 dark:text-zinc-300">{t('app.automations.form.days', 'Days')}</legend>
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            {#each [1, 2, 3, 4, 5, 6, 0] as d (d)}
              <label class="flex items-center gap-1.5 text-sm text-zinc-800 dark:text-zinc-200">
                <input type="checkbox" name="days" value={String(d)} bind:group={days} class="accent-indigo-600" />
                {dayName(d)}
              </label>
            {/each}
          </div>
          {#if errorFor('days')}<p role="alert" class="text-sm text-red-700 dark:text-red-300">{errorFor('days')}</p>{/if}
        </fieldset>
      {/if}

      {#if when === 'once'}
        <div class="space-y-1">
          <label for={id('date')} class={label}>{t('app.automations.form.date', 'Date')}</label>
          <input id={id('date')} name="date" type="date" required bind:value={date} class="{input} max-w-48" />
          {#if errorFor('date')}<p role="alert" class="text-sm text-red-700 dark:text-red-300">{errorFor('date')}</p>{/if}
        </div>
      {/if}
      {#if when === 'daily' || when === 'weekdays' || when === 'once'}
        <div class="space-y-1">
          <label for={id('time')} class={label}>{t('app.automations.form.time', 'Time')}</label>
          <input id={id('time')} name="time" type="time" required bind:value={time} class="{input} max-w-40" />
          {#if errorFor('time')}<p role="alert" class="text-sm text-red-700 dark:text-red-300">{errorFor('time')}</p>{/if}
        </div>
      {/if}
      {#if errorFor('when')}<p role="alert" class="text-sm text-red-700 dark:text-red-300">{errorFor('when')}</p>{/if}

      {#if zone}
        <p class="text-xs text-zinc-500 dark:text-zinc-400" data-testid="schedule-form-zone">{t('app.automations.form.zone', 'Times are in {zone}.', { zone })}</p>
      {/if}
    </fieldset>
  {/if}
  {#if mode === 'create'}<input type="hidden" name="zone" value={zone} />{/if}

  {#if preview}{@render preview()}{/if}

  <div class="flex flex-wrap items-center gap-3">
    <button type="submit" disabled={!canSubmit || submitting} aria-disabled={!canSubmit || submitting}
      class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
      {submitLabel}
    </button>
    {#if blockedReason}<p class="text-sm text-zinc-600 dark:text-zinc-400" data-testid="schedule-form-blocked">{blockedReason}</p>{/if}
  </div>
</div>

{#await Promise.resolve(nodeMemories) then read}
  {#if read.kind === 'ok'}
    <SelectNode memories={read.value} bind:open={picking} onselect={(c: NodeChoice) => { entry = { urn: c.urn, name: c.name }; }} />
  {:else}
    <SelectNode memories={[]} memoriesFailed bind:open={picking} onselect={(c: NodeChoice) => { entry = { urn: c.urn, name: c.name }; }} />
  {/if}
{:catch}
  <SelectNode memories={[]} memoriesFailed bind:open={picking} onselect={(c: NodeChoice) => { entry = { urn: c.urn, name: c.name }; }} />
{/await}
