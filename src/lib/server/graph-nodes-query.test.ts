import { expect, it } from 'vitest';
import { Kind, parse, visit } from 'graphql';
import { FIXTURE_NODES_QUERY, GRAPH_NODES_QUERY } from './queries';

it('fixture reads explicitly request system nodes while mixed GraphNodes keeps its default (#1202)', () => {
  const typeFields = (document: string) => {
    const values: unknown[] = [];
    visit(parse(document), { ObjectField(n) {
      if (n.name.value === 'nodeType') values.push(n.value.kind === Kind.STRING ? n.value.value : n.value.kind);
    } });
    return values;
  };
  expect(typeFields(FIXTURE_NODES_QUERY)).toEqual(['system']);
  expect(typeFields(GRAPH_NODES_QUERY)).toEqual([]);
});
