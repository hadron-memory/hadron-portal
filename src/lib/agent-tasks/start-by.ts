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
