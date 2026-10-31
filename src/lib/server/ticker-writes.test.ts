/**
 * portal#1151 (Tickers S7b) — what a refused ticker write tells the reader.
 * The server's own sentence for the refusals it words for people; portal-owned
 * sentences where the server's would name one reason alone (the consent
 * refusal) or is a raw "Forbidden" (hadron-portal#1106); the fixed uncertainty
 * line for everything else.
 */
import { describe, expect, it } from 'vitest';
import { classifyTickerWriteError } from './ticker-writes';

const gqlError = (code: string, message = `server says ${code}`) => ({ response: { errors: [{ message, extensions: { code } }] } });

describe('classifyTickerWriteError', () => {
  it.each([
    'BAD_USER_INPUT',
    'TICKER_NOT_FOUND',
    'TICKER_NAME_TAKEN',
    'TICKER_CADENCE_OUT_OF_RANGE',
    'TICKER_LIMIT_REACHED',
    'TICKER_QUIET_HOURS_INVALID',
    'APP_NOT_FOUND',
    'APP_UNINSTALLED',
  ])('%s shows the server sentence verbatim', (code) => {
    expect(classifyTickerWriteError(gqlError(code), 'create')).toEqual({ kind: 'refused', code, message: `server says ${code}` });
  });

  it('the consent refusal gets portal copy that names neither widening reason alone', () => {
    const r = classifyTickerWriteError(gqlError('TICKER_CADENCE_NEEDS_CONSENT', 'adding every-tick needs consent'), 'update');
    expect(r).toMatchObject({ kind: 'refused', code: 'TICKER_CADENCE_NEEDS_CONSENT' });
    const message = (r as { message: string }).message;
    expect(message).not.toContain('adding every-tick needs consent');
    expect(message).toMatch(/every tick/i);
    expect(message).toMatch(/live check/i);
  });

  it('FORBIDDEN is worded per action, never the raw server text', () => {
    const edit = classifyTickerWriteError(gqlError('FORBIDDEN', 'Forbidden'), 'update') as { message: string };
    const del = classifyTickerWriteError(gqlError('FORBIDDEN', 'Forbidden'), 'delete') as { message: string };
    expect(edit).toMatchObject({ kind: 'refused', code: 'FORBIDDEN' });
    expect(edit.message).not.toBe('Forbidden');
    expect(edit.message).toMatch(/change/i);
    expect(del.message).toMatch(/delete/i);
  });

  it('the impersonation sentence passes through', () => {
    expect(classifyTickerWriteError(gqlError('FORBIDDEN', 'Impersonation sessions are read-only.'), 'create')).toEqual({
      kind: 'refused',
      code: 'FORBIDDEN',
      message: 'Impersonation sessions are read-only.',
    });
  });

  it('another code, no code or a transport failure is uncertain, with no raw text', () => {
    expect(classifyTickerWriteError(gqlError('INTERNAL_SERVER_ERROR', 'prisma stack'), 'create')).toEqual({ kind: 'uncertain' });
    expect(classifyTickerWriteError(new Error('socket hang up'), 'delete')).toEqual({ kind: 'uncertain' });
    expect(classifyTickerWriteError({ response: { errors: [{ message: 'x' }] } }, 'update')).toEqual({ kind: 'uncertain' });
  });
});
