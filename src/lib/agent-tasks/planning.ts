import { t } from '$lib/i18n/t';

/** Empty create input deliberately omits the server default: naming it changes authority. */
export function readTaskPriority(value: FormDataEntryValue | null): number | undefined | { field: string; message: string } {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return undefined;
  if (!/^[1-5]$/.test(text)) return { field: 'priority', message: t('app.tasks.priority.invalid', 'Choose a priority from 1 (highest) to 5.') };
  return Number(text);
}
