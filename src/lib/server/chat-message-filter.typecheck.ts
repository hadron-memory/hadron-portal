import { chatMessageNodeTypes, loadChatMessages } from './team-chat';

type ProducedFilter = ReturnType<typeof chatMessageNodeTypes>;
type ReadOptions = NonNullable<Parameters<typeof loadChatMessages>[3]>;

// Compile-only boundary pins. Never execute a request from this fixture.
// Enforced by `pnpm check` (svelte-check includes src/**/*.ts), not by Vitest.
export function transcriptFilterTypePins() {
  const produced: ProducedFilter = ['chat-message', 'message'];
  const legacy: ProducedFilter = undefined;
  const accepted: ReadOptions = { messageNodeTypes: ['chat-message', 'message'] };
  const omitted: ReadOptions = {};
  // @ts-expect-error An explicitly requested empty domain is never legacy omission.
  const emptyProduced: ProducedFilter = [];
  // @ts-expect-error Only the existing pair is a transcript filter.
  const extraProduced: ProducedFilter = ['chat-message', 'message', 'record'];
  // @ts-expect-error The pair's order is part of this closed producer contract.
  const reversedProduced: ProducedFilter = ['message', 'chat-message'];
  // @ts-expect-error An unknown member cannot replace either literal.
  const unknownProduced: ProducedFilter = ['chat-message', 'other'];
  // @ts-expect-error The consumer must reject an empty list too.
  const emptyRead: ReadOptions = { messageNodeTypes: [] };
  // @ts-expect-error The consumer must reject extra members too.
  const extraRead: ReadOptions = { messageNodeTypes: ['chat-message', 'message', 'record'] };
  // @ts-expect-error The consumer must reject a reversed pair too.
  const reversedRead: ReadOptions = { messageNodeTypes: ['message', 'chat-message'] };
  // @ts-expect-error The consumer must reject an unknown member too.
  const unknownRead: ReadOptions = { messageNodeTypes: ['chat-message', 'other'] };
  return { produced, legacy, accepted, omitted, emptyProduced, extraProduced, reversedProduced,
    unknownProduced, emptyRead, extraRead, reversedRead, unknownRead };
}
