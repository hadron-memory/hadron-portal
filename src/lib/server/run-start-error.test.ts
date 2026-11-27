import { describe, expect, it } from 'vitest';
import { runStartError, runStartStatus } from './run-start-error';

/** #2569 (C3 second PR, door 21): the manual run launch shows the server's fixed out-of-credit sentence with 409. */
const wire = (code: string, message: string) => ({ response: { errors: [{ message, extensions: { code } }] } });
const CREDIT = wire('CREDITS_EXHAUSTED', 'The account has no AI credit left for work on the platform\'s own AI provider.');

describe('manual run launch refusals', () => {
  it('CREDITS_EXHAUSTED is 409 with the server text unchanged (on main: 500, generic)', () => {
    expect(runStartStatus(CREDIT)).toBe(409);
    expect(runStartError(CREDIT, 'Failed to start')).toBe('The account has no AI credit left for work on the platform\'s own AI provider.');
  });
  it('RUN_AGENT_REQUIRED stays 400 and an unknown code stays 500 with the generic text', () => {
    expect(runStartStatus(wire('RUN_AGENT_REQUIRED', 'x'))).toBe(400);
    expect(runStartStatus(wire('SOMETHING_NEW', 'secret'))).toBe(500);
    expect(runStartError(wire('SOMETHING_NEW', 'secret'), 'Failed to start')).toBe('Something went wrong on our side.');
  });
});
