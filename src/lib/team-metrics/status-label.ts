import { t } from '$lib/i18n/t';

/**
 * portal#2535 — the words a reader sees for a task status. Display only: the stored status word
 * stays the key everywhere else (sort, filter, drill), per cor:agt:050:02. An unknown status is
 * shown as the server sent it, never hidden or guessed.
 */
export function statusLabel(status: string): string {
  switch (status) {
    case 'PENDING': return t('team-metrics.status.pending', 'Pending');
    case 'STARTED': return t('team-metrics.status.started', 'Started');
    case 'FINISHED': return t('team-metrics.status.finished', 'Finished');
    case 'CANCELLED': return t('team-metrics.status.cancelled', 'Cancelled');
    default: return status;
  }
}
