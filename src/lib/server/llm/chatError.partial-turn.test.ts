/**
 * portal#916 partial-turn slice: the chat turn is not atomic on the server. When the authoring gate refuses the
 * extraction, hadron-server#3514 (PR #3518) reports `extensions.partialTurn`: the assistant message and counter
 * were saved, the extraction was refused, the stage did not advance. The marker, never the code alone, is the only
 * evidence of what was saved (hrn:node:hadronmemory.com:specs:cor:cht:020:01, step 2), so every mapping here is keyed on structured fields and a
 * missing or malformed marker keeps today's generic failure.
 *
 * The expected copy is restated here on purpose, independent of chatError.ts.
 */
import { describe, expect, it } from 'vitest';
import { partialTurnRefusal, publicChatError } from './chatError';

const MISSING_COPY =
  "Your message was sent and the reply was saved, but the chat couldn't save the information it collected: this memory accepts that data only from a task-assigned author, and a chat turn doesn't name one. Ask whoever manages the memory. You don't need to send it again.";
const BROKEN_COPY =
  "Your message was sent and the reply was saved, but the information it collected wasn't: the task this memory requires for that data is unavailable. It stays that way until whoever manages the memory repairs it. You don't need to send it again.";

const marker = (code: string) => ({
  persisted: ['ASSISTANT_MESSAGE', 'MESSAGE_COUNTER'],
  refused: [{ component: 'EXTRACTION', code }],
  notRun: ['STAGE_PROGRESSION'],
});
const err = (code: string, partialTurn?: unknown, message = 'resolver prose sentinel') => ({
  response: { errors: [{ message, extensions: { code, ...(partialTurn === undefined ? {} : { partialTurn }) } }] },
});

describe('partialTurnRefusal: a recognised marker selects the fixed saved-reply copy', () => {
  it.each([
    ['AUTHORING_ATTESTATION_MISSING', 'partialTurnAttestationMissing', MISSING_COPY],
    ['AUTHOR_TASK_BROKEN', 'partialTurnAuthorTaskBroken', BROKEN_COPY],
  ])('%s with its marker -> %s, 409, fixed message', (code, portalCode, message) => {
    expect(partialTurnRefusal(err(code, marker(code)))).toEqual({ code: portalCode, message, status: 409 });
  });

  it('tolerates a marker that lists more parts than the contract names', () => {
    const m = marker('AUTHORING_ATTESTATION_MISSING');
    const r = partialTurnRefusal(err('AUTHORING_ATTESTATION_MISSING', { ...m, persisted: [...m.persisted, 'SOMETHING_ELSE'], extra: 1 }));
    expect(r?.code).toBe('partialTurnAttestationMissing');
  });
});

describe('partialTurnRefusal: everything that is not a recognised marker stays generic', () => {
  const code = 'AUTHORING_ATTESTATION_MISSING';
  const good = marker(code);
  const cases: Array<[string, unknown]> = [
    ['no marker at all (code alone)', undefined],
    ['marker is null', null],
    ['marker is a string', 'partial'],
    ['missing ASSISTANT_MESSAGE', { ...good, persisted: ['MESSAGE_COUNTER'] }],
    ['persisted is not an array', { ...good, persisted: 'ASSISTANT_MESSAGE' }],
    ['missing STAGE_PROGRESSION', { ...good, notRun: [] }],
    ['notRun has the wrong type', { ...good, notRun: 'STAGE_PROGRESSION' }],
    ['refused code differs from the error code', { ...good, refused: [{ component: 'EXTRACTION', code: 'AUTHOR_TASK_BROKEN' }] }],
    ['refused component is not EXTRACTION', { ...good, refused: [{ component: 'STAGE', code }] }],
    ['refused is empty', { ...good, refused: [] }],
    ['refused entry has the wrong types', { ...good, refused: [{ component: 'EXTRACTION', code: 5 }] }],
  ];
  it.each(cases)('%s', (_name, partialTurn) => {
    expect(partialTurnRefusal(err(code, partialTurn))).toBeNull();
  });

  it.each(['AUTHORING_ATTESTATION_WRONG_TASK', 'AUTHORING_ATTESTATION_STALE', 'SOMETHING_NEW', 'INTERNAL_SERVER_ERROR'])(
    '%s is never a partial turn, even with a marker naming it',
    (c) => {
      expect(partialTurnRefusal(err(c, marker(c)))).toBeNull();
    },
  );

  it('a marker under a different top-level code does not select the copy', () => {
    expect(partialTurnRefusal(err('AUTHOR_TASK_BROKEN', marker('AUTHORING_ATTESTATION_MISSING')))).toBeNull();
  });

  it('matches structured fields, never message text', () => {
    expect(partialTurnRefusal(err('SOMETHING_NEW', undefined, 'AUTHORING_ATTESTATION_MISSING: reply saved'))).toBeNull();
    expect(partialTurnRefusal(new Error('AUTHORING_ATTESTATION_MISSING'))).toBeNull();
    expect(partialTurnRefusal(null)).toBeNull();
  });

  it('publicChatError is unchanged: the same marked error is still the generic failed 500', () => {
    expect(publicChatError(err(code, good))).toMatchObject({ code: 'failed', status: 500 });
  });
});
