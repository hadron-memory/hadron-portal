import { t } from '$lib/i18n/t';
/** What one role's apply outcome reads as, shared by the single and bulk displays. */
export function outcomeCopy(value: string, dryRun: boolean): string {
  if (value === 'APPLIED') return dryRun ? t('config.will-add', 'Will be added') : t('config.added', 'Added');
  if (value === 'REPLACED') return dryRun ? t('config.will-replace', 'Will be replaced') : t('config.replaced', 'Replaced');
  if (value === 'SKIPPED_LOCKED') return t('config.skipped-locked', 'Skipped: locked');
  if (value === 'SKIPPED_CONFLICT') return t('config.skipped-conflict', 'Skipped: conflict with an existing rule');
  return t('config.skipped-unknown', 'Skipped: outcome unavailable');
}
