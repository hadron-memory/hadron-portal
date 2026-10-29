/** Portal must work against the server contract AFTER legacy prompt removal. */
import { readFileSync } from 'node:fs';
import { buildASTSchema, parse, visit } from 'graphql';
import { expect, it } from 'vitest';
import { collectPortalDocuments, findInvalid } from './validate-graphql.mjs';

it('#1379 all portal operations validate after retired prompt fields and arguments are removed', () => {
  const retired = new Set(['systemPrompt', 'promptOverride']);
  const ast = visit(parse(readFileSync('schema/schema.graphql', 'utf8')), {
    FieldDefinition: node => retired.has(node.name.value) ? null : undefined,
    InputValueDefinition: node => retired.has(node.name.value) ? null : undefined,
  });
  const schema = buildASTSchema(ast);
  const documents = collectPortalDocuments();
  expect(findInvalid(schema, documents)).toEqual([]);
});
