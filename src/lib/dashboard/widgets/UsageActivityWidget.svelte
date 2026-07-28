<script lang="ts">
  // Usage Activity widget (#796/#797): read & write event counts bucketed by
  // day, from the USAGE_ACTIVITY provider payload { windowDays, buckets } built
  // server-side from this placement's config. The server returns non-empty
  // buckets only; the DAY window is zero-filled here, in the config's timeZone
  // (bucket boundaries are the server's — the zone must match or days shift).
  //
  // Form follows the dataviz method: two series whose identity is the point →
  // categorical grouped bars; past 31 buckets a bar pair is sub-3px in a card,
  // so longer windows render as a two-line chart instead. Palette: categorical
  // slots 1–2 (blue/orange), validated for both modes against the card
  // surfaces (all six checks pass; see PR).
  import { t } from '$lib/i18n/t';
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

  /** The full window's day list (YYYY-MM-DD, in the server's bucketing zone),
   *  zero-filled from the sparse server buckets. Non-DAY buckets render as-is. */
  const series = $derived.by((): Bucket[] => {
    const got = new Map((buckets ?? []).map((b) => [b.date, b]));
    if (bucketSize !== 'DAY') return buckets ?? [];
    const days = windowDays ?? 7;
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    // Walk backwards in 12h steps collecting exactly `days` DISTINCT local
    // dates. Fixed 24h steps mis-enumerate across DST (spring-forward can skip
    // a local date entirely; fall-back duplicates one and a dedupe then
    // shortens the window) — a local day is always ≥ 23h, so a 12h step can
    // never jump over one (Codex/Copilot on #666).
    const dates: string[] = [];
    let t = Date.now();
    while (dates.length < days) {
      const date = fmt.format(new Date(t));
      if (dates[dates.length - 1] !== date) dates.push(date);
      t -= 43_200_000;
    }
    return dates.reverse().map((date) => got.get(date) ?? { date, reads: 0, writes: 0 });
  });

  const total = $derived(series.reduce((s, b) => s + b.reads + b.writes, 0));
  // Chart form: an explicit config choice wins (it's the user's chart); 'auto'
  // keeps the density heuristic — bars read well up to a month of pairs, past
  // that, lines.
  const chartStyle = $derived(
    widgetConfig?.chartStyle === 'bars' || widgetConfig?.chartStyle === 'lines'
      ? (widgetConfig.chartStyle as 'bars' | 'lines')
      : 'auto',
  );
  const asLines = $derived(chartStyle === 'lines' || (chartStyle === 'auto' && series.length > 31));

  // ── Scales ────────────────────────────────────────────────────────────────
  // Width tracks the card (bind:clientWidth); SSR falls back to the viewBox.
  let plotWidth = $state(560);
  const H = 150; // plot height (px)
  const PAD_T = 8; // headroom so the top tick label isn't clipped
  const PAD_L = 30; // y tick labels
  const PAD_R = 6;
  const innerW = $derived(Math.max(60, plotWidth - PAD_L - PAD_R));

  /** Round a max up to a clean 1/2/5×10ⁿ tick ceiling. */
  function niceCeil(v: number): number {
    if (v <= 4) return 4;
    const pow = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 5, 10]) if (m * pow >= v) return m * pow;
    return 10 * pow;
  }
  const yMax = $derived(niceCeil(Math.max(1, ...series.map((b) => Math.max(b.reads, b.writes)))));
  const yOf = (v: number): number => PAD_T + H - (v / yMax) * H;

  // Bar geometry: each day gets a band; a pair of bars ≤24px each with a 2px
  // surface gap between them, centered in the band (leftover band is air).
  const bandW = $derived(innerW / Math.max(1, series.length));
  const barW = $derived(Math.min(24, Math.max(2, (bandW - 6) / 2 - 1)));
  const xOfBand = (i: number): number => PAD_L + i * bandW;

  /** Bar path: 4px-rounded data end, square at the baseline (r clamps to fit). */
  function barPath(x: number, v: number, w: number): string {
    const base = PAD_T + H; // the baseline
    const y = yOf(v);
    const h = base - y;
    if (h <= 0) return '';
    const r = Math.min(4, w / 2, h);
    return `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${base} Z`;
  }

  const linePath = (key: 'reads' | 'writes'): string =>
    series
      .map((b, i) => `${i === 0 ? 'M' : 'L'}${(xOfBand(i) + bandW / 2).toFixed(1)},${yOf(b[key]).toFixed(1)}`)
      .join(' ');

  // Sparse x labels: every k-th band so ~7 labels fit; always the last.
  const labelEvery = $derived(Math.max(1, Math.ceil(series.length / 7)));
  const showLabel = (i: number): boolean =>
    i % labelEvery === 0 && (i === series.length - 1 || series.length - 1 - i >= labelEvery / 2);
  const shortDate = (d: string): string => d.slice(5).replace('-', '/');

  // ── Hover tooltip (per-day band; the hit target is the full column) ───────
  let hover = $state<number | null>(null);
  /** Tooltip left edge: centered on the band, kept inside the plot. Clamped in
   *  JS because a CSS min(max(0px,…),…) inverts when the card is narrower than
   *  the tooltip — the negative upper bound wins (Copilot on #666). */
  const tooltipLeft = (i: number): number =>
    Math.max(0, Math.min(xOfBand(i) + bandW / 2 - 60, plotWidth - 130));
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
    <div class="flex h-full flex-col">
      <div class="mb-2 flex items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          {t('dashboard.widget.usage-activity.window', 'Last {n} days').replace(
            '{n}',
            String(windowDays ?? 7),
          )}
        </span>
        <!-- Legend: always present for two series; ink stays a text token,
             identity rides the colored chip. -->
        <span class="flex items-center gap-3">
          <span class="flex items-center gap-1.5">
            <span class="viz-chip" style="background: var(--series-reads)"></span>
            {t('dashboard.widget.usage-activity.reads', 'Reads')}
          </span>
          <span class="flex items-center gap-1.5">
            <span class="viz-chip" style="background: var(--series-writes)"></span>
            {t('dashboard.widget.usage-activity.writes', 'Writes')}
          </span>
        </span>
      </div>

      {#if total === 0}
        <p class="grid flex-1 place-items-center text-sm text-zinc-500 dark:text-zinc-400">
          {t('dashboard.widget.usage-activity.empty', 'No activity in this window.')}
        </p>
      {:else}
        <div class="viz relative min-h-0 flex-1" bind:clientWidth={plotWidth}>
          <svg
            width="100%"
            height={PAD_T + H + 18}
            viewBox="0 0 {plotWidth} {PAD_T + H + 18}"
            preserveAspectRatio="none"
            role="img"
            aria-label={asLines
              ? t(
                  'dashboard.widget.usage-activity.aria-lines',
                  'Line chart of read and write events per day; details in the table below.',
                )
              : t(
                  'dashboard.widget.usage-activity.aria-bars',
                  'Bar chart of read and write events per day; details in the table below.',
                )}
          >
            <!-- Hairline gridlines at the clean ticks; recessive. -->
            {#each [0, yMax / 2, yMax] as tick (tick)}
              <line
                x1={PAD_L}
                x2={plotWidth - PAD_R}
                y1={yOf(tick)}
                y2={yOf(tick)}
                class="viz-grid"
              />
              <text x={PAD_L - 5} y={yOf(tick) + 3} text-anchor="end" class="viz-tick">
                {tick}
              </text>
            {/each}

            {#if asLines}
              <path d={linePath('reads')} class="viz-line" style="stroke: var(--series-reads)" />
              <path d={linePath('writes')} class="viz-line" style="stroke: var(--series-writes)" />
              <!-- End markers: ≥8px, 2px surface ring so they read over lines. -->
              {#each ['reads', 'writes'] as key (key)}
                <circle
                  cx={xOfBand(series.length - 1) + bandW / 2}
                  cy={yOf(series[series.length - 1][key as 'reads' | 'writes'])}
                  r="4"
                  class="viz-dot"
                  style="fill: var(--series-{key})"
                />
              {/each}
            {:else}
              {#each series as b, i (b.date)}
                {@const x = xOfBand(i) + (bandW - (barW * 2 + 2)) / 2}
                <path d={barPath(x, b.reads, barW)} style="fill: var(--series-reads)" />
                <path d={barPath(x + barW + 2, b.writes, barW)} style="fill: var(--series-writes)" />
              {/each}
            {/if}

            <!-- X labels: sparse, muted. -->
            {#each series as b, i (b.date)}
              {#if showLabel(i)}
                <text x={xOfBand(i) + bandW / 2} y={PAD_T + H + 13} text-anchor="middle" class="viz-tick">
                  {shortDate(b.date)}
                </text>
              {/if}
            {/each}

            <!-- Hover hit bands: full column height, larger than the marks.
                 Pointer-only sugar (the sr-only table is the AT path), so
                 presentational by design. -->
            {#each series as b, i (b.date)}
              <rect
                x={xOfBand(i)}
                y="0"
                width={bandW}
                height={PAD_T + H}
                fill="transparent"
                role="presentation"
                aria-hidden="true"
                onmouseenter={() => (hover = i)}
                onmouseleave={() => (hover = null)}
              />
            {/each}
            {#if hover != null}
              <line
                x1={xOfBand(hover) + bandW / 2}
                x2={xOfBand(hover) + bandW / 2}
                y1={PAD_T}
                y2={PAD_T + H}
                class="viz-crosshair"
              />
            {/if}
          </svg>

          {#if hover != null}
            {@const b = series[hover]}
            <div
              class="pointer-events-none absolute top-1 z-10 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
              style="left: {tooltipLeft(hover)}px"
            >
              <div class="font-medium text-zinc-900 dark:text-white">{b.date}</div>
              <div class="mt-0.5 flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
                <span class="viz-chip" style="background: var(--series-reads)"></span>
                {t('dashboard.widget.usage-activity.reads', 'Reads')}: {b.reads}
              </div>
              <div class="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
                <span class="viz-chip" style="background: var(--series-writes)"></span>
                {t('dashboard.widget.usage-activity.writes', 'Writes')}: {b.writes}
              </div>
            </div>
          {/if}
        </div>

        <!-- The table view (screen-reader path for the chart's values). -->
        <table class="sr-only">
          <caption>
            {t('dashboard.widget.usage-activity.table-caption', 'Read and write events per day')}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t('dashboard.widget.usage-activity.date', 'Date')}</th>
              <th scope="col">{t('dashboard.widget.usage-activity.reads', 'Reads')}</th>
              <th scope="col">{t('dashboard.widget.usage-activity.writes', 'Writes')}</th>
            </tr>
          </thead>
          <tbody>
            {#each series as b (b.date)}
              <tr><th scope="row">{b.date}</th><td>{b.reads}</td><td>{b.writes}</td></tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
</WidgetCard>

<style>
  /* Categorical slots 1–2 (blue/orange) stepped per mode; validated against
     the card surfaces (#fff / zinc-900) with scripts/validate_palette.js —
     all six checks pass in both modes. Dark values under the portal's
     class-based dark mode. */
  .viz,
  .viz-chip {
    --series-reads: #2a78d6;
    --series-writes: #eb6834;
  }
  :global(.dark) .viz,
  :global(.dark) .viz-chip {
    --series-reads: #3987e5;
    --series-writes: #d95926;
  }
  .viz-chip {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 9999px;
  }
  .viz-grid {
    stroke: #e4e4e7; /* zinc-200 */
    stroke-width: 1;
  }
  :global(.dark) .viz-grid {
    stroke: #27272a; /* zinc-800 */
  }
  .viz-tick {
    font-size: 10px;
    fill: #71717a; /* zinc-500 — muted axis ink */
  }
  .viz-line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .viz-dot {
    stroke: #ffffff; /* 2px surface ring */
    stroke-width: 2;
  }
  :global(.dark) .viz-dot {
    stroke: #18181b; /* zinc-900 card surface */
  }
  .viz-crosshair {
    stroke: #a1a1aa; /* zinc-400 */
    stroke-width: 1;
  }
</style>
