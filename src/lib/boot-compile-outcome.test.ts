import { describe, expect, it } from 'vitest';
import { compileRefusalText } from './boot-compile';

describe('portal#1666 shared Agent compile outcome', () => {
  it.each([undefined, null, 'INTERNAL_SERVER_ERROR', 'UNRECOGNIZED_CODE'])('never claims a non-commit for unknown %s', (code) => {
    const text = compileRefusalText(code, undefined, 7);
    expect(text).toContain('Couldn’t confirm whether the prompt was built');
    expect(text).not.toContain('Nothing changed');
    expect(text).not.toContain('revision 7');
  });
  it('separates retryable operational conflict from a typed refusal', () => {
    const text = compileRefusalText('CONFLICT', undefined, 7);
    expect(text).toContain('couldn’t be built right now');
    expect(text).not.toContain('Nothing changed');
  });
});
