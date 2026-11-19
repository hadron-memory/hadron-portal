/** #2043: model-policy evidence lives with the server owner; portal pins its served contract. */
import { readFileSync } from 'node:fs';
import { buildSchema, isEnumType } from 'graphql';
import { expect, it } from 'vitest';
const schema = buildSchema(readFileSync(new URL('../../../../schema/schema.graphql', import.meta.url), 'utf8'));
it('pins the merged server decision enum and nullable per-chat root', () => {
  const choice = schema.getType('ChatToolChoice');
  expect(choice && isEnumType(choice) ? choice.getValues().map(x => x.name) : []).toEqual(['AUTO', 'FORCED']);
  const field = schema.getQueryType()!.getFields().chatEffectiveToolChoice;
  expect(String(field.type)).toBe('ChatToolChoice');
  expect(field.args.map(x => [x.name, String(x.type)])).toEqual([['chatId', 'String!']]);
});
it('pins the pure unsaved-pair surface', () => {
  const field = schema.getQueryType()!.getFields().chatToolChoiceFor;
  expect(String(field.type)).toBe('ChatToolChoice!');
  expect(field.args.map(x => [x.name, String(x.type)]).sort()).toEqual([['model', 'String!'], ['provider', 'String!']]);
});
it('has no portal runtime model-list predicate to drift from the server', () => {
  const runtime = readFileSync(new URL('./agentChatLlm.ts', import.meta.url), 'utf8');
  expect(runtime).not.toMatch(/AUTO_TOOL_CHOICE_|usesAutoToolChoice|claude-sonnet-5-5|claude-opus-5-5|claude-fable-5-2/);
});
