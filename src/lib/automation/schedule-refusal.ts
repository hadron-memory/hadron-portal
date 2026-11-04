import { t } from '$lib/i18n/t';

/**
 * portal#1701 — the plain words for a refused schedule write. The portal adds no gate of its own: the server decides
 * (create needs an org admin; edit and resume need an org admin who is also the schedule's creator; any org admin
 * may pause). These say who to ask, and nothing of how the server decided.
 */
export type ScheduleOp = 'create' | 'edit' | 'pause' | 'resume';
export type ScheduleRefusal = 'forbidden' | 'not-found' | 'invalid';

export function refusalText(op: ScheduleOp, reason: ScheduleRefusal): string {
  if (reason === 'not-found') return t('app.automations.refusal.not-found', 'That schedule is not there any more. It may have been removed.');
  if (reason === 'invalid') return t('app.automations.refusal.invalid', 'That could not be saved. Check what runs and when, then try again.');
  switch (op) {
    case 'create':
      return t('app.automations.refusal.create', 'Only an organization admin can create a schedule. Ask one of your organization\'s admins.');
    case 'edit':
      return t('app.automations.refusal.edit', 'Only the organization admin who created this schedule can change it. Ask them, or pause it: any organization admin can.');
    case 'resume':
      return t('app.automations.refusal.resume', 'Only the organization admin who created this schedule can start it again. Ask them.');
    case 'pause':
      return t('app.automations.refusal.pause', 'Only an organization admin can pause a schedule. Ask one of your organization\'s admins.');
  }
}
