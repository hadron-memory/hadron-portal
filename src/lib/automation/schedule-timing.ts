import { t } from '$lib/i18n/t';

/**
 * portal#1701 — a schedule's timing in plain terms, and back.
 *
 * The server stores a 5-field cron (or a one-shot instant) plus a timezone. A user thinks "every day at 9". This
 * module is the only place the two meet: it reads a stored schedule into one of four plain choices, writes a plain
 * choice as the cron the server stores, and says either in a sentence in the schedule's OWN zone.
 *
 * The rule that matters most (acceptance 5): a cron the plain choices cannot express (a CLI-made `*​/5 * * * *`, a
 * day of the month, a list of hours) is `custom` and keeps its text. It is never rewritten to the nearest plain
 * choice, and the edit form never re-sends it unless the user chose new timing.
 */

export type Timing =
  | { kind: 'interval'; hours: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; days: number[]; time: string }
  | { kind: 'once'; at: string }
  | { kind: 'custom'; cron: string };

/** The part of a stored schedule that says when. */
export interface StoredTiming {
  cron: string | null;
  runAt: string | null;
  timezone: string;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** `*​/N` hours at minute 0, N in 1..23. */
const INTERVAL = /^0 \*\/([1-9]\d?) \* \* \*$/;
const DAILY = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;
const WEEKDAYS = /^(\d{1,2}) (\d{1,2}) \* \* ([0-7](?:-[0-7])?(?:,[0-7](?:-[0-7])?)*)$/;

function clockOf(minute: string, hour: string): string | null {
  const m = Number(minute);
  const h = Number(hour);
  return m >= 0 && m <= 59 && h >= 0 && h <= 23 ? `${pad(h)}:${pad(m)}` : null;
}

/** "1,3,5" / "1-5" / "7" as sorted distinct days, Sunday = 0; null when any piece is out of range or backwards. */
function daysOf(list: string): number[] | null {
  const days = new Set<number>();
  for (const part of list.split(',')) {
    const [a, b] = part.split('-').map(Number);
    const to = b ?? a;
    if (to < a) return null;
    for (let d = a; d <= to; d++) days.add(d === 7 ? 0 : d);
  }
  return [...days].sort((x, y) => x - y);
}

export function timingFromSchedule(s: StoredTiming): Timing | null {
  if (s.runAt) return { kind: 'once', at: s.runAt };
  if (s.cron === null) return null;
  const cron = s.cron;

  const interval = INTERVAL.exec(cron);
  if (interval && Number(interval[1]) <= 23) return { kind: 'interval', hours: Number(interval[1]) };

  const daily = DAILY.exec(cron);
  if (daily) {
    const time = clockOf(daily[1], daily[2]);
    if (time) return { kind: 'daily', time };
  }

  const weekdays = WEEKDAYS.exec(cron);
  if (weekdays) {
    const time = clockOf(weekdays[1], weekdays[2]);
    const days = daysOf(weekdays[3]);
    if (time && days) return { kind: 'weekdays', days, time };
  }
  return { kind: 'custom', cron };
}

/** The cron the server stores for a plain recurring choice. Throws on anything it cannot write. */
export function cronFor(timing: Timing): string {
  switch (timing.kind) {
    case 'interval':
      if (!Number.isInteger(timing.hours) || timing.hours < 1 || timing.hours > 23) throw new RangeError('hours must be 1 to 23');
      return `0 */${timing.hours} * * *`;
    case 'daily': {
      const m = TIME.exec(timing.time);
      if (!m) throw new RangeError('time must be HH:MM');
      return `${Number(m[2])} ${Number(m[1])} * * *`;
    }
    case 'weekdays': {
      const m = TIME.exec(timing.time);
      if (!m) throw new RangeError('time must be HH:MM');
      const days = [...new Set(timing.days)].sort((a, b) => a - b);
      if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new RangeError('days must be 0 to 6');
      return `${Number(m[2])} ${Number(m[1])} * * ${days.join(',')}`;
    }
    default:
      throw new RangeError(`${timing.kind} has no cron of its own`);
  }
}

const DAY_NAMES = [
  () => t('app.automations.day.sun', 'Sunday'),
  () => t('app.automations.day.mon', 'Monday'),
  () => t('app.automations.day.tue', 'Tuesday'),
  () => t('app.automations.day.wed', 'Wednesday'),
  () => t('app.automations.day.thu', 'Thursday'),
  () => t('app.automations.day.fri', 'Friday'),
  () => t('app.automations.day.sat', 'Saturday'),
];
export const dayName = (d: number): string => DAY_NAMES[d]();

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${t('app.automations.timing.and', 'and')} ${names[names.length - 1]}`;
}

/** Wall-clock parts of an instant in a zone. */
function partsIn(instant: Date, zone: string): { date: string; time: string } | null {
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  } catch {
    return null;
  }
}

/** One sentence, in the schedule's own zone. */
export function timingSentence(timing: Timing, zone: string): string {
  switch (timing.kind) {
    case 'interval':
      return timing.hours === 1
        ? t('app.automations.timing.hourly', 'Every hour ({zone})', { zone })
        : t('app.automations.timing.interval', 'Every {hours} hours ({zone})', { hours: timing.hours, zone });
    case 'daily':
      return t('app.automations.timing.daily', 'Every day at {time} ({zone})', { time: timing.time, zone });
    case 'weekdays': {
      const days = [...timing.days].sort((a, b) => a - b);
      const isWorkWeek = days.length === 5 && days.every((d, i) => d === i + 1);
      const who = isWorkWeek ? t('app.automations.timing.weekday', 'weekday') : joinNames(days.map(dayName));
      return t('app.automations.timing.weekdays', 'Every {who} at {time} ({zone})', { who, time: timing.time, zone });
    }
    case 'once': {
      const p = partsIn(new Date(timing.at), zone);
      // An instant the zone cannot render is shown as the instant itself, not guessed.
      return p
        ? t('app.automations.timing.once', 'Once, on {date} at {time} ({zone})', { date: p.date, time: p.time, zone })
        : t('app.automations.timing.once-instant', 'Once, at {at} ({zone})', { at: timing.at, zone });
    }
    case 'custom':
      return t('app.automations.timing.custom', 'On a custom schedule: {cron} ({zone})', { cron: timing.cron, zone });
  }
}

/**
 * The instant a wall time in a named zone stands for, as ISO text; null when the zone is unknown, the date or time
 * is not real, or the wall time does not exist in that zone (the hour skipped by a spring-forward). Done by
 * searching the zone's offsets rather than doing offset arithmetic, so a DST edge is refused, not guessed.
 */
export function instantFor(date: string, time: string, zone: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const m = TIME.exec(time);
  if (!d || !m) return null;
  const [y, mo, day, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(m[1]), Number(m[2])];
  const asUtc = Date.UTC(y, mo - 1, day, h, mi);
  const check = new Date(asUtc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== day) return null;

  const wanted = `${date} ${time}`;
  // A zone's offset is within 14 hours of UTC, in quarter hours (Nepal is +05:45): try each and keep the one that reads back as the wall time asked for.
  for (let offsetMin = -14 * 60; offsetMin <= 14 * 60; offsetMin += 15) {
    const candidate = new Date(asUtc - offsetMin * 60_000);
    const p = partsIn(candidate, zone);
    if (!p) return null;
    if (`${p.date} ${p.time}` === wanted) return candidate.toISOString();
  }
  return null;
}
