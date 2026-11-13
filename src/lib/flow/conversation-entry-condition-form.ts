import { z } from 'zod';

import { t } from '$lib/i18n/t';
import { parseConditionField } from './edge-form';
import { isConversationLoc } from './conversation-canvas';

/**
 * The fact scopes a conversation's start condition may read (Q15). Kept here,
 * once, so widening the set later is a one-line change that the builder's
 * variable list and the client-side guard both follow.
 */
export const ENTRY_CONDITION_SCOPES: readonly string[] = ['memory', 'agent'];

/** Shown for both the server's SCOPE_NOT_AVAILABLE_AT_START and the client-side guard. */
export const entryConditionScopeMessage = () =>
  t('conversation.infoPanel.start.scopeNotAvailable', 'A start condition can use only memory and agent facts. Choose one of those.');

/** The first `var` path whose scope is not allowed, or null. Walks any JSONLogic shape. */
export function entryConditionScopeViolation(condition: unknown): string | null {
  if (Array.isArray(condition)) {
    for (const item of condition) {
      const hit = entryConditionScopeViolation(item);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof condition !== 'object' || condition === null) return null;
  for (const [key, value] of Object.entries(condition as Record<string, unknown>)) {
    if (key === 'var') {
      const path = Array.isArray(value) ? value[0] : value;
      if (typeof path === 'string' && !ENTRY_CONDITION_SCOPES.includes(path.split('.')[0])) return path;
      continue;
    }
    // missing / missing_some carry literal field paths too (server S6 checks them).
    if (key === 'missing' || key === 'missing_some') {
      const fields = key === 'missing' ? value : Array.isArray(value) ? value[1] : null;
      if (Array.isArray(fields)) {
        for (const f of fields) {
          if (typeof f === 'string' && !ENTRY_CONDITION_SCOPES.includes(f.split('.')[0])) return f;
        }
      } else if (typeof fields === 'string' && !ENTRY_CONDITION_SCOPES.includes(fields.split('.')[0])) {
        return fields;
      }
      continue;
    }
    const hit = entryConditionScopeViolation(value);
    if (hit) return hit;
  }
  return null;
}

export const conversationEntryConditionSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('updateEntryCondition').default('updateEntryCondition'),
  systemMemoryId: z.string().trim().min(1, 'Missing system memory id').prefault(''),
  convLoc: z.string()
    .trim()
    .min(1, 'Missing conversation loc')
    .refine((loc) => isConversationLoc(loc), 'Invalid conversation loc')
    .prefault(''),
  // 'null' is the builder's "no condition".
  condition: z.string().default('null').superRefine((value, ctx) => {
    const parsed = parseConditionField(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.error });
      return;
    }
    if (entryConditionScopeViolation(parsed.value)) {
      ctx.addIssue({ code: 'custom', message: entryConditionScopeMessage() });
    }
  }),
  // Save and Clear are two buttons; the intent stays in the action, not in a visible mode control.
  intent: z.enum(['save', 'clear']).default('save'),
});

export type ConversationEntryConditionSchema = typeof conversationEntryConditionSchema;

export function conversationEntryConditionDefaults(
  conversation: { loc: string; entryCondition: unknown },
  systemMemoryId: string,
) {
  return {
    _kind: 'updateEntryCondition' as const,
    systemMemoryId,
    convLoc: conversation.loc,
    condition: JSON.stringify(conversation.entryCondition ?? null),
    intent: 'save' as const,
  };
}
