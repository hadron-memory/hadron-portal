<!--
  portal#1357 — the fields of Edit details (hadron-server#2645,
  `updateAgentTask`): the create form's controls for the six descriptive
  fields, pre-filled from the task, each posted beside its BASE so the action
  sends only what the reader changed (see $lib/agent-tasks/edit).

  - Seeded ONCE, when the panel opens. A later refresh of the task never
    reseeds what the reader has typed.
  - No source, owner, assignee, status, parent, priority or blocker control:
    those are not editable through this call.
  - A requirement value the pickers don't list (a retired role, a family or a
    worker no longer on the roster) stays as an option, selected, so saving
    never drops it silently.
  - Tags and requirements are REPLACED as shown, and changing requirements
    does not move an assigned or started task: it applies to its next
    assignment. Both are said in words.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  import { isoToLocalInput, localDateTimeToIso } from '$lib/agent-tasks/start-by';
  import { minTierOptions, tierLabel } from '$lib/agent-tasks/tier';
  import type { AgentTaskDetail } from '$lib/agent-tasks/types';
  import TaskReferencesEditor from './TaskReferencesEditor.svelte';

  let {
    task,
    workers,
    roles,
    families,
    invalid = null,
    appUrn = null,
    nodeMemories = [],
  }: {
    task: AgentTaskDetail;
    workers: Array<{ id: string; name: string }>;
    roles: string[];
    families: string[];
    /** A field the action refused locally (an emptied title, an unreadable start by). */
    invalid?: { field: string; message: string } | null;
    /** portal#1575: the App's server-supplied URN, which a picked TASK reference is built from. */
    appUrn?: string | null;
    /** portal#1576 step 2: the NODE reference picker's memory stage (streamed). */
    nodeMemories?: Promise<Array<{ id: string; name: string; urn: string; visibility?: string | null; orgName?: string }>> | Array<{ id: string; name: string; urn: string; visibility?: string | null; orgName?: string }>;
  } = $props();

  // Seeded once, on purpose: the panel is a draft, not a view of `task`.
  const seed = untrack(() => task);
  // portal#1575: the references the panel opened with, posted as the base the action compares against.
  const baseRefs = (seed.references ?? []).map((r) => ({ kind: r.kind, target: r.target, label: r.label ?? null }));
  const baseReq = {
    role: seed.requirements?.role ?? null,
    familyIn: seed.requirements?.familyIn ?? [],
    familyNotIn: seed.requirements?.familyNotIn ?? [],
    excludeWorkers: seed.requirements?.excludeWorkerIds ?? [],
    minTier: seed.requirements?.minTier ?? null,
  };

  let title = $state(seed.title);
  let description = $state(seed.description ?? '');
  let tags = $state(seed.tags.join(', '));
  let startByLocal = $state(isoToLocalInput(seed.startBy));
  let closeSession = $state(seed.closeSessionWhenDone);
  let role = $state(baseReq.role ?? '');
  let familyIn = $state<string[]>([...baseReq.familyIn]);
  let familyNotIn = $state<string[]>([...baseReq.familyNotIn]);
  let exclude = $state<string[]>([...baseReq.excludeWorkers]);
  let minTier = $state(baseReq.minTier ?? '');
  // The instant is recomputed from the control only once the reader changes it: read back from its local
  // string, an instant in the autumn DST overlap (the second 01:30) would land on the first, an hour
  // earlier, and an unrelated edit would move the deadline (Beckett's P2 on #1466).
  let startByTouched = $state(false);
  const startByUtc = $derived(startByTouched ? localDateTimeToIso(startByLocal) : (seed.startBy ?? ''));

  let zoneLabel = $state(t('app.tasks.new.zone-utc', 'UTC'));
  onMount(() => {
    try {
      zoneLabel = Intl.DateTimeFormat().resolvedOptions().timeZone || zoneLabel;
    } catch {
      /* keep UTC */
    }
  });

  // What the pickers list, plus whatever the task already holds.
  const union = (listed: string[], held: string[]) => [...new Set([...listed, ...held])];
  const roleOptions = $derived(union(roles, baseReq.role ? [baseReq.role] : []));
  const familyOptions = $derived(union(families, [...baseReq.familyIn, ...baseReq.familyNotIn]));
  const workerOptions = $derived([
    ...workers,
    ...baseReq.excludeWorkers.filter((id) => !workers.some((w) => w.id === id)).map((id) => ({ id, name: id })),
  ]);

  // "Run as one of" and "Never run as" are exclusive: choosing one clears the other.
  function pickIn(e: Event) {
    familyIn = [...(e.target as HTMLSelectElement).selectedOptions].map((o) => o.value);
    if (familyIn.length) familyNotIn = [];
  }
  function pickNotIn(e: Event) {
    familyNotIn = [...(e.target as HTMLSelectElement).selectedOptions].map((o) => o.value);
    if (familyNotIn.length) familyIn = [];
  }

  const assigned = $derived(!!seed.assignee || seed.status === 'STARTED');
  const inputClass =
    'w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
  const labelClass = 'block text-sm font-medium text-zinc-800 dark:text-zinc-200';
  const helpClass = 'text-xs text-zinc-500 dark:text-zinc-400';
  const fieldError = (f: string) => (invalid && invalid.field === f ? invalid.message : null);
</script>

<input type="hidden" name="titleBase" value={seed.title} />
<input type="hidden" name="descriptionBase" value={seed.description ?? ''} />
<input type="hidden" name="tagsBase" value={seed.tags.join(', ')} />
<input type="hidden" name="startByBase" value={seed.startBy ?? ''} />
<input type="hidden" name="closeSessionWhenDoneBase" value={String(seed.closeSessionWhenDone)} />
<input type="hidden" name="requirementsBase" value={JSON.stringify(baseReq)} />
<input type="hidden" name="referencesBase" value={JSON.stringify(baseRefs)} />
<input type="hidden" name="startByUtc" value={startByUtc} />

<div class="space-y-1">
  <label for="edit-title" class={labelClass}>{t('app.tasks.new.title', 'Title')}</label>
  <input id="edit-title" name="title" type="text" required aria-required="true" bind:value={title} class={inputClass}
    aria-invalid={fieldError('title') ? 'true' : undefined} aria-describedby={fieldError('title') ? 'edit-title-error' : undefined} />
  {#if fieldError('title')}<p id="edit-title-error" class="text-xs text-red-700 dark:text-red-300">{fieldError('title')}</p>{/if}
</div>

<div class="space-y-1">
  <label for="edit-description" class={labelClass}>{t('app.tasks.new.description', 'Description')}</label>
  <textarea id="edit-description" name="description" rows="4" bind:value={description} class={inputClass}></textarea>
  <p class={helpClass}>{t('app.tasks.edit.clear-help', 'Empty it to remove it.')}</p>
</div>

<div class="space-y-1">
  <label for="edit-tags" class={labelClass}>{t('app.tasks.new.tags', 'Tags')}</label>
  <input id="edit-tags" name="tags" type="text" bind:value={tags} placeholder="a, b" aria-describedby="edit-tags-help" class={inputClass} />
  <p id="edit-tags-help" class={helpClass}>{t('app.tasks.edit.tags-help', 'Tags are replaced as shown: what you type here is the whole list.')}</p>
</div>

<TaskReferencesEditor app={{ id: seed.appId, urn: appUrn }} {nodeMemories} initial={baseRefs} idPrefix="edit" replaces invalid={fieldError('references')} />

<div class="space-y-1">
  <label for="edit-start-by" class={labelClass}>{t('app.tasks.new.start-by', 'Start by')} <span class="font-normal text-zinc-500">({zoneLabel})</span></label>
  <input id="edit-start-by" name="startBy" type="datetime-local" bind:value={startByLocal} oninput={() => (startByTouched = true)} class="{inputClass} max-w-xs"
    aria-invalid={fieldError('startBy') ? 'true' : undefined} aria-describedby={fieldError('startBy') ? 'edit-start-by-error' : 'edit-start-by-help'} />
  {#if fieldError('startBy')}<p id="edit-start-by-error" class="text-xs text-red-700 dark:text-red-300">{fieldError('startBy')}</p>{/if}
  <p id="edit-start-by-help" class={helpClass}>{t('app.tasks.edit.start-by-help', 'If it’s still pending then, an alarm is raised. Empty it to remove the deadline.')}</p>
</div>

<fieldset class="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
  <legend class="px-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('app.tasks.new.who-may', 'Who may pick it up')}</legend>
  <div class="space-y-1">
    <label for="edit-role" class={labelClass}>{t('app.tasks.new.role', 'Role')}</label>
    <select id="edit-role" name="role" bind:value={role} class={inputClass}>
      <option value="">{t('app.tasks.new.role.any', 'Any role')}</option>
      {#each roleOptions as r (r)}<option value={r}>{r}</option>{/each}
    </select>
  </div>
  <div class="space-y-1">
    <label for="edit-family-in" class={labelClass}>{t('app.tasks.new.family-in', 'Run as one of')}</label>
    <select id="edit-family-in" name="familyIn" multiple bind:value={familyIn} onchange={pickIn} class={inputClass}>
      {#each familyOptions as f (f)}<option value={f}>{f}</option>{/each}
    </select>
  </div>
  <div class="space-y-1">
    <label for="edit-family-not-in" class={labelClass}>{t('app.tasks.new.family-not-in', 'Never run as')}</label>
    <select id="edit-family-not-in" name="familyNotIn" multiple bind:value={familyNotIn} onchange={pickNotIn} class={inputClass}>
      {#each familyOptions as f (f)}<option value={f}>{f}</option>{/each}
    </select>
    <p class={helpClass}>{t('app.tasks.new.family-help', 'Choose one list or the other.')}</p>
  </div>
  <div class="space-y-1">
    <label for="edit-exclude" class={labelClass}>{t('app.tasks.new.exclude', 'Exclude workers')}</label>
    <select id="edit-exclude" name="excludeWorkers" multiple bind:value={exclude} class={inputClass}>
      {#each workerOptions as w (w.id)}<option value={w.id}>{w.name}</option>{/each}
    </select>
  </div>
  <div class="space-y-1">
    <label for="edit-min-tier" class={labelClass}>{t('app.tasks.new.min-tier', 'Minimum model tier')}</label>
    <select id="edit-min-tier" name="minTier" bind:value={minTier} aria-describedby="edit-min-tier-help" class={inputClass}>
      <option value="">{t('app.tasks.new.min-tier.any', 'Any')}</option>
      {#each minTierOptions(baseReq.minTier) as tier (tier)}<option value={tier}>{tierLabel(tier)}</option>{/each}
    </select>
    <p id="edit-min-tier-help" class={helpClass}>{t('app.tasks.new.min-tier.help', 'The task goes to the cheapest free worker at or above this tier. When a minimum is selected, a worker whose tier is unknown won’t be picked.')}</p>
  </div>
  <p class={helpClass}>
    {t('app.tasks.edit.requirements-help', 'Requirements are replaced as shown. Emptying all of them removes them.')}
    {#if assigned}
      {t('app.tasks.edit.requirements-assigned', 'Changing them doesn’t move the task: it applies to the next assignment.')}
    {/if}
  </p>
</fieldset>

<div>
  <label class="flex items-start gap-2 text-sm text-zinc-800 dark:text-zinc-200">
    <input type="checkbox" id="edit-close-session" name="closeSessionWhenDone" bind:checked={closeSession} aria-describedby="edit-close-help" class="mt-0.5" />
    {t('app.tasks.write.close-session', 'End the assignee’s session when the task finishes')}
  </label>
  <p id="edit-close-help" class="ml-6 {helpClass}">
    {t('app.tasks.write.close-session.help', 'On: the assignee is asked to end its session when the task finishes or is cancelled. Off: its session stays open.')}
  </p>
</div>
