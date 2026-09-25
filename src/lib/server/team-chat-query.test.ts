/**
 * #855 — the team chat read selects each message's own URN.
 *
 * Parsed, not matched as text: the query's comments mention `urn` too, so a
 * substring check would pass on a document that no longer selects it.
 */
import { describe, expect, it } from 'vitest';
import { Kind, parse, type SelectionSetNode } from 'graphql';
import { TEAM_CHAT_MESSAGES_QUERY } from './queries';

function fieldNames(set: SelectionSetNode | undefined): string[] {
  return (set?.selections ?? []).flatMap((s) => (s.kind === Kind.FIELD ? [s.name.value] : []));
}

function itemsSelection(doc: string): string[] {
  const op = parse(doc).definitions[0];
  if (op.kind !== Kind.OPERATION_DEFINITION) throw new Error('expected an operation');
  const page = op.selectionSet.selections.find((s) => s.kind === Kind.FIELD && s.name.value === 'teamChatMessages');
  if (!page || page.kind !== Kind.FIELD) throw new Error('teamChatMessages not selected');
  const items = page.selectionSet?.selections.find((s) => s.kind === Kind.FIELD && s.name.value === 'items');
  if (!items || items.kind !== Kind.FIELD) throw new Error('items not selected');
  return fieldNames(items.selectionSet);
}

describe('TEAM_CHAT_MESSAGES_QUERY (#855)', () => {
  it('selects each message\'s urn, so the thread can show its chip', () => {
    expect(itemsSelection(TEAM_CHAT_MESSAGES_QUERY)).toContain('urn');
  });

  it('the check fails on a document that only MENTIONS urn in a comment', () => {
    const commentOnly = TEAM_CHAT_MESSAGES_QUERY.replace(/^\s+urn\s*$/m, '');
    expect(commentOnly).toContain('urn'); // still in the comment…
    expect(itemsSelection(commentOnly)).not.toContain('urn'); // …but not selected
  });
});
