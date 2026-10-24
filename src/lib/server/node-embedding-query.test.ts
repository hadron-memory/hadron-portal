import { expect, it } from 'vitest';
import { Kind, parse } from 'graphql';
import { NODE_BY_ID_QUERY, NODE_FIELDS } from './queries';
it('#257 selects embedding state on node detail only, leaving list/search payloads unchanged', () => {
  const doc = parse(NODE_BY_ID_QUERY);
  const op = doc.definitions.find(d => d.kind === Kind.OPERATION_DEFINITION);
  if (!op || op.kind !== Kind.OPERATION_DEFINITION) throw new Error('No operation');
  const node = op.selectionSet.selections.find(s => s.kind === Kind.FIELD && s.name.value === 'node');
  if (!node || node.kind !== Kind.FIELD) throw new Error('No node selection');
  const fields = node.selectionSet!.selections.flatMap(s => s.kind === Kind.FIELD ? [s.name.value] : []);
  for (const name of ['embeddingPendingAt', 'embeddingFailedAt', 'embeddingError']) {
    expect(fields).toContain(name);
    expect(NODE_FIELDS).not.toContain(name);
  }
});
