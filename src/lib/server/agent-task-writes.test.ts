/**
 * portal#1090 — what a refused task write tells the reader (design §5).
 * Allowlisted typed refusals show the server's sentence verbatim; anything
 * else (another code, no payload, a transport failure) gets the fixed
 * uncertainty line, never raw internals and never "failed".
 */
import { describe, expect, it } from 'vitest';
import { classifyWriteError, parsePartyChoice, WRITE_UNCERTAIN_TEXT } from './agent-task-writes';

const gql = (code: string | undefined, message: string) => ({
  response: { errors: [{ message, ...(code ? { extensions: { code } } : {}) }] },
});

describe('classifyWriteError', () => {
  it.each([
    'TASK_NOT_FOUND', 'TASK_NOT_OWNER', 'TASK_ENDED', 'TASK_INVALID_TRANSITION', 'TASK_ASSIGNEE_INVALID',
    'TASK_OWNER_INVALID', 'SESSION_NOT_BOUND', 'APP_UNINSTALLED', 'APP_NOT_FOUND', 'BAD_USER_INPUT',
  ])('%s shows the server’s sentence verbatim, with its code', (code) => {
    expect(classifyWriteError(gql(code, 'Only the owner cancels it.'))).toEqual({ kind: 'refused', code, message: 'Only the owner cancels it.' });
  });

  it('FORBIDDEN is shown only when it is the impersonation sentence', () => {
    expect(classifyWriteError(gql('FORBIDDEN', 'Impersonation sessions are read-only.'))).toEqual({
      kind: 'refused', code: 'FORBIDDEN', message: 'Impersonation sessions are read-only.',
    });
    expect(classifyWriteError(gql('FORBIDDEN', 'Forbidden'))).toEqual({ kind: 'uncertain' });
  });

  it('an unknown code, a missing code, no payload or a transport error is uncertain, never raw', () => {
    expect(classifyWriteError(gql('INTERNAL_SERVER_ERROR', 'at prisma.agentTask.update (secret stack)'))).toEqual({ kind: 'uncertain' });
    expect(classifyWriteError(gql(undefined, 'something'))).toEqual({ kind: 'uncertain' });
    expect(classifyWriteError({ response: { status: 502 } })).toEqual({ kind: 'uncertain' });
    expect(classifyWriteError(new Error('ECONNREFUSED'))).toEqual({ kind: 'uncertain' });
  });

  it('the uncertainty line never claims a failure', () => {
    expect(WRITE_UNCERTAIN_TEXT()).toBe('The change may or may not have gone through. Reload to check.');
    expect(WRITE_UNCERTAIN_TEXT()).not.toMatch(/fail/i);
  });
});

describe('parsePartyChoice', () => {
  it('reads a picked worker or person by id', () => {
    expect(parsePartyChoice('worker:w1', '')).toEqual({ worker: 'w1' });
    expect(parsePartyChoice('user:u1', '')).toEqual({ user: 'u1' });
  });

  it('"Someone else…" takes a handle or id as a person', () => {
    expect(parsePartyChoice('other', '@rae')).toEqual({ user: 'rae' });
    expect(parsePartyChoice('other', '  ')).toBeNull();
  });

  it('nobody, empty or a malformed choice names no party', () => {
    expect(parsePartyChoice('', '')).toBeNull();
    expect(parsePartyChoice('nobody', '')).toBeNull();
    expect(parsePartyChoice('robot:x', '')).toBeNull();
  });
});
