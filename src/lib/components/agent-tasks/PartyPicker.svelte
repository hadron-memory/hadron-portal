<!--
  portal#1090 — an owner or assignee picker (design §3.1, §6): a native,
  grouped <select> (Workers, then People), plus "Someone else…", which
  reveals a text field for a handle or id. The server's participant test is
  wider than this list; its typed refusal says the rest. Values are
  `worker:<id>`, `user:<id>`, `other`, and the caller's leading options
  (e.g. `me`, `nobody`).
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import PartyLabel from './PartyLabel.svelte';

  type Option = { value: string; label: string };
  let {
    name,
    id,
    label,
    value = $bindable(''),
    other = '',
    leading = [],
    workers,
    people,
    peopleWithheld = false,
    exclude = null,
    required = false,
    describedby,
  }: {
    name: string;
    id: string;
    label: string;
    value?: string;
    other?: string;
    leading?: Option[];
    workers: { id: string; name: string; role: string | null; urn: string | null }[];
    people: { id: string; handle: string | null; name: string | null }[];
    /** portal#1148: the member roster is withheld from this viewer; say so rather than offer no People silently. */
    peopleWithheld?: boolean;
    /** A party to leave out, e.g. the current assignee when reassigning. */
    exclude?: string | null;
    required?: boolean;
    describedby?: string;
  } = $props();

  const shownWorkers = $derived(workers.filter((w) => `worker:${w.id}` !== exclude));
  const shownPeople = $derived(people.filter((p) => `user:${p.id}` !== exclude));
  const picked = $derived(workers.find((w) => `worker:${w.id}` === value) ?? null);
</script>

<div class="space-y-1">
  <label for={id} class="block text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</label>
  <select
    {id}
    {name}
    bind:value
    {required}
    aria-describedby={describedby}
    class="w-full max-w-md rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
  >
    {#if !leading.length}<option value="" disabled selected={value === ''}>{t('app.tasks.write.choose', 'Choose…')}</option>{/if}
    {#each leading as o (o.value)}
      <option value={o.value} selected={value === o.value}>{o.label}</option>
    {/each}
    {#if shownWorkers.length}
      <optgroup label={t('app.tasks.write.group.workers', 'Workers')}>
        {#each shownWorkers as w (w.id)}
          <option value="worker:{w.id}" selected={value === `worker:${w.id}`}>{w.name}{w.role ? ` (${w.role})` : ''}</option>
        {/each}
      </optgroup>
    {/if}
    {#if shownPeople.length}
      <optgroup label={t('app.tasks.write.group.people', 'People')}>
        {#each shownPeople as p (p.id)}
          <option value="user:{p.id}" selected={value === `user:${p.id}`}>{p.name ?? p.handle ?? p.id}{p.handle ? ` (@${p.handle})` : ''}</option>
        {/each}
      </optgroup>
    {/if}
    <option value="other" selected={value === 'other'}>{t('app.tasks.write.someone-else', 'Someone else…')}</option>
  </select>
  {#if peopleWithheld}
    <p class="text-xs text-zinc-500" role="status">{t('app.tasks.write.people-withheld', 'This App’s members aren’t visible to you, so they aren’t listed. Use “Someone else…” to name one.')}</p>
  {/if}
  {#if value === 'other'}
    <label for="{id}-other" class="block text-xs text-zinc-600 dark:text-zinc-400">{t('app.tasks.write.someone-else.label', 'Their @handle or id')}</label>
    <input
      id="{id}-other"
      name="{name}Other"
      type="text"
      value={other}
      placeholder="@handle"
      required
      aria-required="true"
      class="w-full max-w-md rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
    />
  {/if}
  {#if picked}
    <div class="pt-1 text-sm"><PartyLabel party={{ id: picked.id, kind: 'WORKER', name: picked.name, urn: picked.urn }} /></div>
  {/if}
</div>
