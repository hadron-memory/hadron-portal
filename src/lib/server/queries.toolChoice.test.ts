import { expect, it } from 'vitest';
import { Kind, parse } from 'graphql';
import { TEST_AI_SERVICE_CONFIG_MUTATION } from './queries';
it('#2043 saved Test opts into the chat leg and selects only its closed status', () => {
  const doc = parse(TEST_AI_SERVICE_CONFIG_MUTATION);
  const op = doc.definitions.find(x => x.kind === Kind.OPERATION_DEFINITION)!;
  if(op.kind !== Kind.OPERATION_DEFINITION) throw Error('No operation');
  const field = op.selectionSet.selections[0];
  if(field.kind !== Kind.FIELD) throw Error('No field');
  expect(field.arguments?.find(a => a.name.value === 'chatProbe')?.value).toMatchObject({ kind: Kind.BOOLEAN, value: true });
  const chat = field.selectionSet?.selections.find(x => x.kind === Kind.FIELD && x.name.value === 'chat');
  expect(chat).toBeDefined();
  if(chat?.kind !== Kind.FIELD) throw Error('No chat selection');
  expect(chat.selectionSet?.selections.map(x=>x.kind===Kind.FIELD?x.name.value:null)).toEqual(['status']);
});
