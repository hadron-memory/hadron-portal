<script lang="ts">
  // Usage Activity widget (#796/#797): read & write event counts bucketed by
  // day, from the USAGE_ACTIVITY provider payload { windowDays, buckets } built
  // server-side from this placement's config. The chart itself lives in the
  // shared UsageActivityChart (also used by the memory Usage tab); this wrapper
  // owns the widget chrome and the widget-only states (unsaved placement,
  // degraded config) and translates the placement config into chart props.
  import { t } from '$lib/i18n/t';
  import UsageActivityChart from '$lib/components/UsageActivityChart.svelte';
  import WidgetCard from '../WidgetCard.svelte';

  interface Bucket {
    date: string;
    reads: number;
    writes: number;
  }

  let {
    windowDays,
    buckets,
    invalidConfig = false,
    widgetConfig = null,
  }: {
    windowDays?: number;
    buckets?: Bucket[];
    invalidConfig?: boolean;
    widgetConfig?: Record<string, unknown> | null;
  } = $props();

  // No payload at all = an unsaved placement in the editor (data is fetched
  // per saved placement row).
  const unsaved = $derived(buckets === undefined);

  const tz = $derived(
    typeof widgetConfig?.timeZone === 'string' ? (widgetConfig.timeZone as string) : 'UTC',
  );
  const bucketSize = $derived(
    typeof widgetConfig?.bucket === 'string' ? (widgetConfig.bucket as string) : 'DAY',
  );
  const chartStyle = $derived(
    widgetConfig?.chartStyle === 'bars' || widgetConfig?.chartStyle === 'lines'
      ? (widgetConfig.chartStyle as 'bars' | 'lines')
      : 'auto',
  );
</script>

<WidgetCard title={t('dashboard.widget.usage-activity.title', 'Usage Activity')}>
  {#if unsaved}
    <p class="grid h-full place-items-center text-sm text-zinc-500 dark:text-zinc-400">
      {t('dashboard.widget.usage-activity.unsaved', 'Data loads after saving the layout.')}
    </p>
  {:else if invalidConfig}
    <p class="grid h-full place-items-center px-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
      {t(
        'dashboard.widget.usage-activity.invalid-config',
        "This widget's settings point at something unavailable — adjust them in Customize.",
      )}
    </p>
  {:else}
    <UsageActivityChart {windowDays} {buckets} timeZone={tz} {bucketSize} {chartStyle} />
  {/if}
</WidgetCard>
