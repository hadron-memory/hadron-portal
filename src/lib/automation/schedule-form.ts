import { t } from '$lib/i18n/t';
import { instantFor, type Timing } from './schedule-timing';

/**
 * portal#1701 — the plain "when" controls, read on the server into a Timing. The form never carries a cron: the
 * server action writes it from the choice, so a posted body cannot smuggle one in.
 */
export type TimingParse = { ok: true; timing: Timing } | { ok: false; field: 'when' | 'hours' | 'time' | 'days' | 'date'; message: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseTimingForm(form: FormData, zone: string): TimingParse {
  const text = (k: string) => String(form.get(k) ?? '').trim();
  const bad = (field: 'when' | 'hours' | 'time' | 'days' | 'date', message: string): TimingParse => ({ ok: false, field, message });
  const time = text('time');
  const badTime = () => bad('time', t('app.automations.form.err.time', 'Pick a time of day.'));

  switch (text('when')) {
    case 'interval': {
      const hours = Number(text('hours'));
      return /^\d{1,2}$/.test(text('hours')) && hours >= 1 && hours <= 23
        ? { ok: true, timing: { kind: 'interval', hours } }
        : bad('hours', t('app.automations.form.err.hours', 'Pick a number of hours from 1 to 23.'));
    }
    case 'daily':
      return TIME.test(time) ? { ok: true, timing: { kind: 'daily', time } } : badTime();
    case 'weekdays': {
      if (!TIME.test(time)) return badTime();
      const picked = form.getAll('days').map((d) => String(d));
      const days = [...new Set(picked.map(Number))].sort((a, b) => a - b);
      return days.length > 0 && picked.every((d) => /^[0-6]$/.test(d))
        ? { ok: true, timing: { kind: 'weekdays', days, time } }
        : bad('days', t('app.automations.form.err.days', 'Pick at least one day.'));
    }
    case 'once': {
      const date = text('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad('date', t('app.automations.form.err.date', 'Pick a date.'));
      if (!TIME.test(time)) return badTime();
      const at = instantFor(date, time, zone);
      return at
        ? { ok: true, timing: { kind: 'once', at } }
        : bad('time', t('app.automations.form.err.once', 'That date and time does not exist in {zone}. Pick another.', { zone }));
    }
    default:
      return bad('when', t('app.automations.form.err.when', 'Pick when it should run.'));
  }
}
