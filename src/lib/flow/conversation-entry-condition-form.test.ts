import { describe, expect, it } from 'vitest';
import {
  ENTRY_CONDITION_SCOPES,
  conversationEntryConditionSchema,
  entryConditionScopeViolation,
} from './conversation-entry-condition-form';

describe('entryConditionScopeViolation (Q15)', () => {
  it('allows memory.* and agent.* facts and the time builtins', () => {
    expect(entryConditionScopeViolation({ '==': [{ var: 'memory.business_type' }, 'retail'] })).toBeNull();
    expect(entryConditionScopeViolation({ and: [{ '>': [{ var: 'agent.config.x' }, 1] }, { '<': [{ now: [] }, '2030-01-01'] }] })).toBeNull();
    expect(entryConditionScopeViolation(null)).toBeNull();
  });

  it('names a chat.* or message.data.* variable, however deeply nested', () => {
    expect(entryConditionScopeViolation({ '>': [{ var: 'chat.message_count' }, 3] })).toBe('chat.message_count');
    expect(entryConditionScopeViolation({ or: [{ '==': [1, 1] }, { '==': [{ var: 'message.data.x' }, 1] }] })).toBe('message.data.x');
  });

  it('keeps the allowed scope list in one exported place', () => {
    expect(ENTRY_CONDITION_SCOPES).toEqual(['memory', 'agent']);
  });
});

describe('conversationEntryConditionSchema', () => {
  const base = { systemMemoryId: 'mem-1', convLoc: 'conversations:demo' };

  it('accepts a valid condition and defaults the intent to save', () => {
    const r = conversationEntryConditionSchema.safeParse({ ...base, condition: JSON.stringify({ '==': [{ var: 'memory.a' }, 1] }) });
    expect(r.success).toBe(true);
    expect(r.success && r.data.intent).toBe('save');
  });

  it('refuses an out-of-scope variable with the start-condition copy', () => {
    const r = conversationEntryConditionSchema.safeParse({ ...base, condition: JSON.stringify({ '>': [{ var: 'chat.message_count' }, 1] }) });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].message).toBe('A start condition can use only memory and agent facts.');
  });

  it('refuses a non-conversation loc', () => {
    expect(conversationEntryConditionSchema.safeParse({ ...base, convLoc: 'conversations:demo:start', condition: 'null' }).success).toBe(false);
  });
});
