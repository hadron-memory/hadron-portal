/**
 * portal#1523 — the minimum model tier a queued task can name
 * (hadron-server#2983, `requirements.minTier`). The portal does no tier logic:
 * the server matches and refuses. This is only the choices the picker offers,
 * lowest first. The names are still Proposed (hadron-server#2252), so the
 * labels live here, in one place.
 */
import { t } from '$lib/i18n/t';

export const MIN_TIERS = ['low', 'mid', 'high'] as const;

/** The picker's choices, plus a stored value it doesn't list, shown as it is and kept. */
export const minTierOptions = (stored: string | null | undefined): string[] =>
  stored && !(MIN_TIERS as readonly string[]).includes(stored) ? [...MIN_TIERS, stored] : [...MIN_TIERS];

/** A tier's name on a control; a stored value the picker doesn't list reads as it is. */
export const tierLabel = (tier: string): string =>
  tier === 'low' ? t('app.tasks.tier.low', 'Low') : tier === 'mid' ? t('app.tasks.tier.mid', 'Mid') : tier === 'high' ? t('app.tasks.tier.high', 'High') : tier;
