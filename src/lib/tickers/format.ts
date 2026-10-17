/**
 * portal#1099 — how a ticker's numbers read (design §3.1, §8): cadences,
 * quiet hours and relative times, built from parts through `t()`, never by
 * concatenating translated fragments.
 */
import { t } from '$lib/i18n/t';

/** "10 min", "2 h", "1 day", "90 s": the largest unit that divides the cadence. */
export function cadenceText(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return t('tickers.cadence.none', 'None');
  if (seconds % 86400 === 0) {
    const n = seconds / 86400;
    return n === 1 ? t('tickers.cadence.day', '1 day') : t('tickers.cadence.days', '{n} days', { n });
  }
  if (seconds % 3600 === 0) return t('tickers.cadence.hours', '{n} h', { n: seconds / 3600 });
  if (seconds % 60 === 0) return t('tickers.cadence.minutes', '{n} min', { n: seconds / 60 });
  return t('tickers.cadence.seconds', '{n} s', { n: seconds });
}

export interface QuietWindow {
  days: number[];
  from: string;
  to: string;
}
export interface QuietHours {
  timezone: string;
  windows: QuietWindow[];
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The server's quiet-hours JSON (`src/lib/tickers/quietHours.ts`: ISO days
 * 1 = Monday … 7 = Sunday, HH:MM, start inclusive, end exclusive), or null
 * when there is none. `invalid` when it doesn't have that shape, so a view
 * says so instead of guessing a schedule.
 */
export function parseQuietHours(raw: unknown): QuietHours | null | 'invalid' {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'invalid';
  const { timezone, windows } = raw as { timezone?: unknown; windows?: unknown };
  if (typeof timezone !== 'string' || !timezone || !Array.isArray(windows)) return 'invalid';
  const out: QuietWindow[] = [];
  for (const w of windows) {
    if (typeof w !== 'object' || w === null) return 'invalid';
    const { days, from, to } = w as { days?: unknown; from?: unknown; to?: unknown };
    if (!Array.isArray(days) || days.length === 0 || !days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) return 'invalid';
    if (typeof from !== 'string' || typeof to !== 'string' || !HHMM.test(from) || !HHMM.test(to)) return 'invalid';
    out.push({ days: [...(days as number[])].sort((a, b) => a - b), from, to });
  }
  if (out.length === 0) return null;
  return { timezone, windows: out };
}

function dayName(d: number): string {
  switch (d) {
    case 1: return t('tickers.day.mon', 'Mon');
    case 2: return t('tickers.day.tue', 'Tue');
    case 3: return t('tickers.day.wed', 'Wed');
    case 4: return t('tickers.day.thu', 'Thu');
    case 5: return t('tickers.day.fri', 'Fri');
    case 6: return t('tickers.day.sat', 'Sat');
    default: return t('tickers.day.sun', 'Sun');
  }
}

/** "Mon–Fri", "Mon, Wed", "Sat–Sun": runs of three or more consecutive days collapse. */
export function daysText(days: number[]): string {
  if (days.length === 7) return t('tickers.days.every', 'Every day');
  const runs: number[][] = [];
  for (const d of [...new Set(days)].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && d === last[last.length - 1] + 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((r) => (r.length >= 3 ? t('tickers.days.range', '{from}–{to}', { from: dayName(r[0]), to: dayName(r[r.length - 1]) }) : r.map(dayName).join(', ')))
    .join(', ');
}

/** One window: "22:00–07:00 Mon–Fri", flagged overnight when it ends the next day. */
export function windowText(w: QuietWindow): string {
  const base = t('tickers.quiet.window', '{from}–{to} {days}', { from: w.from, to: w.to, days: daysText(w.days) });
  return w.to < w.from ? t('tickers.quiet.overnight', '{window} (overnight, ends next day)', { window: base }) : base;
}

/** The list cell: the first window with its zone, plus "+N more"; "None" when there are no quiet hours. */
export function quietHoursSummary(raw: unknown): string {
  const q = parseQuietHours(raw);
  if (q === null) return t('tickers.quiet.none', 'None');
  if (q === 'invalid') return t('tickers.quiet.invalid', 'Schedule not shown (unrecognized format)');
  const first = t('tickers.quiet.first', '{window} ({zone})', { window: windowText(q.windows[0]), zone: q.timezone });
  return q.windows.length > 1 ? t('tickers.quiet.more', '{first} +{n} more', { first, n: q.windows.length - 1 }) : first;
}

/**
 * "in 5 min", "3 h ago": a relative time for a list cell. The absolute time
 * goes in the `<time>` element's title and datetime, so it stays on focus.
 */
export function relativeTime(iso: string | null | undefined, now: number): string {
  if (!iso) return '—';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '—';
  const diff = Math.round((at - now) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
  if (abs < 60) return rtf.format(diff, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

/**
 * Anne's P3 on #1136: a grid's search reaches the labels a reader sees in a
 * cell (Ticking/Disabled, Mentions only, via grant), and not ones it doesn't
 * show, so typing what's on screen finds the row.
 */
export function tickerStateLabel(enabled: boolean): string {
  return enabled ? t('app.tickers.state.ticking', 'Ticking') : t('app.tickers.state.disabled', 'Disabled');
}

export function tickerSearchText(tk: { name: string; urn: string | null; enabled: boolean; relevance: string }): string {
  return [
    tk.name,
    tk.urn ?? '',
    tickerStateLabel(tk.enabled),
    tk.relevance === 'MENTIONS' ? t('app.tickers.relevance.mentions', 'Mentions only') : '',
  ].filter(Boolean).join(' ');
}

export function subscriptionSearchText(by: { name: string | null | undefined; viaGrant: boolean }): string {
  return [by.name ?? '', by.viaGrant ? t('app.ticker.via-grant', 'via grant') : ''].filter(Boolean).join(' ');
}

/**
 * Anne's P2 on #1136: what an empty `Ticker.channels` can honestly say. The
 * server lists only the named channels THIS reader can read, so [] is both
 * "names no channel" (every channel each subscriber watches) and "every named
 * channel is hidden from you". Nothing in the payload tells them apart, so
 * neither is claimed.
 */
export function noVisibleChannelsText(): string {
  return t('app.tickers.channels.none-visible', 'Every watched channel, or channels hidden from you');
}
