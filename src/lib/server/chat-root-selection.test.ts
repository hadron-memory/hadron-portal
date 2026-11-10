import { describe, expect, it } from 'vitest';
import { Kind, parse, type FragmentDefinitionNode, type SelectionSetNode } from 'graphql';
import { NODE_BY_ID_QUERY } from './queries';

// #1569: the three node routes qualify a transcript read from the authenticated
// root's own `nodeType` (and read it from `memoryId`'s memory). Their route
// tests stub `NODE_BY_ID_QUERY` with a node that already carries both, so a
// query that stopped selecting them would leave the suite green while every
// route silently under-qualified. This pins the SELECTION, resolving the
// NodeFields fragment spread the same way the server would.
function selectedFields(doc: string, root: string): string[] {
  const parsed = parse(doc);
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const d of parsed.definitions) if (d.kind === Kind.FRAGMENT_DEFINITION) fragments.set(d.name.value, d);
  const op = parsed.definitions.find(d => d.kind === Kind.OPERATION_DEFINITION);
  if (!op || op.kind !== Kind.OPERATION_DEFINITION) throw new Error('No operation');
  const field = op.selectionSet.selections.find(s => s.kind === Kind.FIELD && s.name.value === root);
  if (!field || field.kind !== Kind.FIELD || !field.selectionSet) throw new Error(`No ${root} selection`);
  const out: string[] = [];
  const walk = (set: SelectionSetNode, seen: Set<string>) => {
    for (const s of set.selections) {
      if (s.kind === Kind.FIELD) out.push(s.name.value);
      else if (s.kind === Kind.FRAGMENT_SPREAD) {
        const frag = fragments.get(s.name.value);
        if (!frag) throw new Error(`Unresolved fragment ${s.name.value}`);
        if (!seen.has(frag.name.value)) walk(frag.selectionSet, new Set(seen).add(frag.name.value));
      } else if (s.kind === Kind.INLINE_FRAGMENT) walk(s.selectionSet, seen);
    }
  };
  walk(field.selectionSet, new Set());
  return out;
}

describe('#1569 chat-root read selection', () => {
  it('NODE_BY_ID_QUERY selects nodeType and memoryId (directly or via NodeFields)', () => {
    const fields = selectedFields(NODE_BY_ID_QUERY, 'node');
    expect(fields).toContain('nodeType');
    expect(fields).toContain('memoryId');
  });

  it('the helper resolves fragment spreads, so removing the field from the fragment is seen', () => {
    const doc = `fragment F on Node { id } query Q { node(ref: "x") { ...F memoryId } }`;
    expect(selectedFields(doc, 'node')).toEqual(['id', 'memoryId']);
    expect(selectedFields(doc, 'node')).not.toContain('nodeType');
  });
});
