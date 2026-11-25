import { t } from '$lib/i18n/t';
import { makeGlobalFilterFn } from '$lib/table/global-filter';
import type { DefaultSkip, RefState, Rule } from './types';

const fields = ['authorTask', 'validationTask', 'descriptionNode'] as const;
const labels = {
  authorTask: t('config.author', 'Author task'),
  validationTask: t('config.validator', 'Validation task'),
  descriptionNode: t('config.description-node', 'Description node'),
};

function referenceStateCopy(state: RefState, hasUrn: boolean): string {
  if (state === 'OK') return hasUrn ? '' : t('config.ref.no-address', 'OK — no address is available.');
  if (state === 'UNREADABLE') return t('config.ref.unreadable', 'UNREADABLE — you cannot read this reference.');
  if (state === 'BROKEN') return t('config.ref.broken', 'BROKEN — the referenced node is unavailable.');
  return t('config.ref.none', 'None');
}

function settingsText(rule: Rule): string {
  return [
    rule.enabled ? t('config.enabled', 'Enabled') : t('config.disabled', 'Disabled'),
    t('config.writers-label', 'Writers: {value}', { value: rule.writers }),
    rule.writers === 'OWNER' ? t('config.owner-note', 'not supported yet; refuses every write when enabled') : '',
    t('config.strict-label', 'Strict sub-roles: {value}', { value: rule.strictSubRoles ? t('config.yes', 'Yes') : t('config.no', 'No') }),
    t('config.validate-label', 'Validate by: {value}', { value: rule.validateBy ?? t('config.none', 'None') }),
  ].join(' ');
}

function referencesText(rule: Rule): string {
  return fields.map(field => [
    labels[field],
    referenceStateCopy(rule[`${field}State`], !!rule[field]),
    rule[`${field}State`] === 'OK' ? rule[field] ?? '' : '',
  ].join(' ')).join(' ');
}

function lockedText(rule: Rule): string {
  if (!rule.locked) return '';
  return `${t('config.locked', 'Locked by {name}', { name: rule.sourceTemplate?.name ?? t('config.template', 'template') })} ${rule.sourceTemplate?.deleted ? t('config.template-deleted', 'template deleted') : ''}`;
}

// Only role has a string accessor and is therefore reliably eligible for global
// filtering. Carry the other visible values on that column instead of changing
// the grid's columns or sorting behavior.
export const ruleGlobalFilterFn = makeGlobalFilterFn<Rule>({}, {
  role: rule => `${settingsText(rule)} ${referencesText(rule)} ${lockedText(rule)}`,
});

/** The reason a default was skipped, in the words a row shows; an unknown code is shown as sent. */
export const skipReasonCopy = (reason: string): string =>
  reason === 'REFERENCE_UNAVAILABLE' ? t('config.skip-unavailable', 'Its task or node wasn’t available to the organization.') : reason;

/** Everything a skipped-defaults row displays: role, field label, template, the reference as now seen, and the reason. */
function skipText(skip: DefaultSkip): string {
  return [
    skip.role,
    labels[skip.field] ?? skip.field,
    skip.sourceTemplate && !skip.sourceTemplate.deleted ? skip.sourceTemplate.name : t('config.template-deleted', 'template deleted'),
    referenceStateCopy(skip.refState, !!skip.ref),
    skip.refState === 'OK' ? skip.ref ?? '' : '',
    skipReasonCopy(skip.reason),
  ].join(' ');
}

// The skipped table has accessors for role and the raw field key only, so the
// other displayed values ride on the role column, as the rule table's do.
export const skipGlobalFilterFn = makeGlobalFilterFn<DefaultSkip>({}, { role: skipText });
