import { t } from '$lib/i18n/t';
import { extractGqlError, extractGqlErrorCode, extractGqlErrorExtensions } from '$lib/gql-error';

/** Shared by node editors (and future create/config slices). Only these four
 * existing authorization refusals gain guidance; validation, attestation and
 * unknown/internal faults retain their existing safe envelope. No extra reads. */
export function nodeRoleRefusalText(error: unknown): string | null {
  const ext = extractGqlErrorExtensions(error);
  if (!ext) return null;
  const value = (key: string) => typeof ext[key] === 'string' ? ext[key] as string : null;
  switch (extractGqlErrorCode(error)) {
    case 'ROLE_NOT_DECLARED': {
      const role = value('role'), parent = value('strictParent');
      if (!role || !parent) return t('node.role-refusal.undeclared-fallback', 'Choose a declared sub-role or ask a manager of the memory.');
      return t('node.role-refusal.undeclared', 'Role “{role}” is not declared under the strict parent “{parent}”. Choose a declared sub-role or ask a manager of the memory.', { role, parent });
    }
    case 'ROLE_WRITER_LEVEL_REQUIRED': {
      const rule = value('ruleRole');
      const level = value('level');
      const reason = level === 'ADMIN'
        ? t('node.role-refusal.admin', 'The rule “{rule}” requires the owning organization’s admins or owners, or the owning user; memory write access alone is not enough.', { rule: rule ?? t('node.role-refusal.unknown-rule', 'for this node') })
        : t('node.role-refusal.level', 'The rule “{rule}” requires writer level “{level}”. Memory write access alone is not enough. Ask whoever manages the memory’s configuration about the required level.', { rule: rule ?? t('node.role-refusal.unknown-rule', 'for this node'), level: level ?? t('node.role-refusal.unknown-level', 'required by the rule') });
      return ext.side === 'before'
        ? `${reason} ${t('node.role-refusal.before', 'Changing or clearing the role needs the same writer level.')}`
        : reason;
    }
    case 'ROLE_WRITERS_UNSUPPORTED':
      return t('node.role-refusal.unsupported', 'The rule “{rule}” uses writer level “{level}”, which is not supported yet, so no one can write this role. Whoever manages the memory’s configuration must change the rule.', {
        rule: value('ruleRole') ?? t('node.role-refusal.unknown-rule', 'for this node'),
        level: value('level') ?? t('node.role-refusal.unknown-level', 'required by the rule'),
      });
    case 'ROLE_GOVERNED': {
      const original = extractGqlError(error, '', ['ROLE_GOVERNED']);
      if (ext.op === 'delete' || ext.op === 'restore') {
        return `${original} ${t('node.role-refusal.no-route', 'There is no route from the portal for this operation.')}`;
      }
      // Never turn an arbitrary resolver name into a guessed route. Delete and
      // restore above intentionally ignore door, even when the server supplies it.
      const actions: Record<string, string> = {
        createTaskNode: t('node.role-refusal.create-task', 'create a runnable node'),
        updateTaskNode: t('node.role-refusal.update-task', 'update a runnable node'),
        createReviewNode: t('node.role-refusal.create-review', 'create a review node'),
        updateReviewNode: t('node.role-refusal.update-review', 'update a review node'),
        createSpecNode: t('node.role-refusal.create-spec', 'create a specification node'),
        updateSpecNode: t('node.role-refusal.update-spec', 'update a specification node'),
      };
      const door = value('door');
      const action = door && Object.hasOwn(actions, door) ? actions[door] : null;
      return (ext.op === 'create' || ext.op === 'update') && action
        ? `${original} ${t('node.role-refusal.door-action', 'This write needs the dedicated action to {action}; ordinary Save cannot perform it.', { action })}`
        : `${original} ${t('node.role-refusal.no-route', 'There is no route from the portal for this operation.')}`;
    }
    default: return null;
  }
}

export function nodeWriteErrorText(error: unknown, fallback: string, knownRefusals: readonly string[] = []): string {
  return nodeRoleRefusalText(error) ?? extractGqlError(error, fallback, knownRefusals);
}
