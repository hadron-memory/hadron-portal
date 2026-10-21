import { expect, it } from 'vitest';
import { Kind, parse, visit } from 'graphql';
import { GRAPH_NODES_QUERY } from './queries';

it('GraphNodes forwards an optional nodeType to the independent server filter (#1202)', () => {
  const doc = parse(GRAPH_NODES_QUERY);
  let optional = false;
  let forwarded = false;
  visit(doc, {
    VariableDefinition(n) {
      if (n.variable.name.value === 'nodeType') optional = n.type.kind !== Kind.NON_NULL_TYPE;
    },
    ObjectField(n) {
      if (n.name.value === 'nodeType' && n.value.kind === Kind.VARIABLE && n.value.name.value === 'nodeType') forwarded = true;
    },
  });
  expect(optional).toBe(true);
  expect(forwarded).toBe(true);
});
