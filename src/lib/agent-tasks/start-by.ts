/**
 * portal#1090 — a `datetime-local` value as the instant it means in the
 * browser's zone, using the offset of the DATE chosen (Diego's P2-3 on
 * #1135). Today's offset is wrong for a date across a DST change: New York's
 * Dec 1 09:00 is 14:00Z, not 13:00Z.
 *
 * `new Date('YYYY-MM-DDTHH:MM')` parses a date-time with no zone as local
 * time for that date, which is exactly this. Empty or malformed input is ''.
 */
export function localDateTimeToIso(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return '';
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Start by as an instant, from what a form posted. The browser sends `utc`,
 * computed with the CHOSEN date's own offset (Diego's P2-3 on #1135: today's
 * offset is an hour off across a DST change). Without JS there is none, and the
 * local value is read as UTC, which the form's label says. null: nothing usable.
 */
export function startByIso(local: string, utc: string): string | null {
  if (utc) {
    const d = new Date(utc);
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(utc) && !Number.isNaN(d.getTime())) return d.toISOString();
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])).toISOString();
}

/** An instant as the `datetime-local` value it shows in the browser's zone ('' when none or unreadable). */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
