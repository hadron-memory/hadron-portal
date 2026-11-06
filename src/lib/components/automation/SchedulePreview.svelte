<script lang="ts">
  import { t } from '$lib/i18n/t';
  import type { SchedulePreviewSummary } from '$lib/server/automation-schedule';

  /**
   * portal#1701 — what the schedule being made will do, before Create (hadron-server#3457). Creating is approving, so
   * this is what the person approves. A snapshot of the server's answer: nothing here is worked out in the portal, and
   * the server's timing line (it quotes the cron) is not part of it. The text is other people's content, shown as text.
   */
  export type PreviewView =
    | { state: 'incomplete' }
    | { state: 'loading' }
    | { state: 'ready'; summary: SchedulePreviewSummary }
    | { state: 'blocked' | 'refused'; message: string }
    | { state: 'failed' };

  let { view }: { view: PreviewView } = $props();

  const none = () => t('app.automations.none', 'None');
  const sections = $derived(
    view.state === 'ready'
      ? ([
          ['reads', t('app.automations.reads', 'What it can read'), view.summary.reads],
          ['writes', t('app.automations.writes', 'What it writes'), view.summary.writes],
          ['tools', t('app.automations.tools', 'Tools it can use'), view.summary.tools],
          ['limits', t('app.automations.limits', 'Limits'), view.summary.limits],
          ['cannot', t('app.automations.cannot', 'What it cannot do'), view.summary.cannotDo],
        ] as const)
      : [],
  );
</script>

<section class="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800" aria-labelledby="preview-h" aria-live="polite" data-testid="schedule-preview" data-state={view.state}>
  <h2 id="preview-h" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.automations.preview.head', 'What you approve by creating it')}</h2>
  {#if view.state === 'ready'}
    {#each sections as [key, heading, items] (key)}
      <div class="space-y-1">
        <h3 class="text-sm font-medium text-zinc-900 dark:text-white">{heading}</h3>
        <ul class="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
          {#each items.length ? items : [none()] as sentence, i (i)}<li>{sentence}</li>{/each}
        </ul>
      </div>
    {/each}
  {:else if view.state === 'loading'}
    <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('app.automations.preview.loading', 'Checking what this would do…')}</p>
  {:else if view.state === 'incomplete'}
    <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('app.automations.preview.incomplete', 'Choose what runs and when. What it would do shows here before you create it.')}</p>
  {:else if view.state === 'failed'}
    <p role="alert" class="text-sm text-red-700 dark:text-red-300">{t('app.automations.preview.failed', 'We could not check what this would do. Change something or reload the page to try again.')}</p>
  {:else}
    <p role="alert" class="text-sm text-red-700 dark:text-red-300">{view.message}</p>
  {/if}
</section>
