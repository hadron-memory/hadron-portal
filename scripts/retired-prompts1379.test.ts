/** Transition contract for #1379: once the SDL is regenerated after server#2712,
 * the named removals are intentionally a no-op; validation still guards callers. */
import { readFileSync } from 'node:fs';
import { buildASTSchema, parse, visit } from 'graphql';
import { expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper has no declaration file.
import { collectPortalDocuments, findInvalid } from './validate-graphql.mjs';

it('#1379 all portal operations validate after retired prompt fields and arguments are removed', () => {
  const retired = new Set(['systemPrompt', 'promptOverride']);
  const mutationDoors = new Set(['createAgent', 'updateAgent', 'createApp', 'updateApp', 'castWorker', 'updateWorker']);
  const ast = visit(parse(readFileSync(new URL('../schema/schema.graphql', import.meta.url), 'utf8')), {
    ObjectTypeDefinition(node) {
      if (['Agent', 'App', 'Worker'].includes(node.name.value)) {
        return { ...node, fields: node.fields?.filter(field => !retired.has(field.name.value)) };
      }
      if (node.name.value === 'Mutation' || node.name.value === 'Query') {
        return { ...node, fields: node.fields?.map(field =>
          (node.name.value === 'Mutation' && mutationDoors.has(field.name.value)) ||
          (node.name.value === 'Query' && field.name.value === 'castWorkerPreview')
            ? { ...field, arguments: field.arguments?.filter(arg => !retired.has(arg.name.value)) }
            : field) };
      }
    },
  });
  const schema = buildASTSchema(ast);
  const documents = collectPortalDocuments();
  expect(findInvalid(schema, documents)).toEqual([]);
});
