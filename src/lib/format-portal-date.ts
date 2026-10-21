/** Shared date-only presentation for memory and node metadata. */
export function formatPortalDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}
