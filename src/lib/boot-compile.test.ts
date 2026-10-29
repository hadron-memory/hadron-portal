import { describe, expect, it } from 'vitest';
import { approvalRefusalStatus, approveRefusalText } from './node-approval';
import { compileRefusalStatus, compileRefusalText } from './boot-compile';

describe('compileRefusalText', () => {
  it.each([
    ['BOOT_PROMPT_COMPILE_NOT_PERMITTED', 'Only whoever manages this Agent'],
    ['BOOT_PROMPT_NO_SOURCE', 'There is no source to build from.'],
    ['BOOT_PROMPT_SOURCE_INVALID', 'isn’t a boot-prompt source'],
    ['BOOT_PROMPT_NODE_TYPE', 'isn’t a boot-prompt source'],
    ['CONFLICT', 'It took too long. Try again.'],
  ])('%s has fixed copy and says nothing changed', (code, copy) => {
    const text = compileRefusalText(code, undefined, 4);
    expect(text).toContain(copy);
    expect(text).toContain('Nothing changed; workers still get revision 4.');
  });
  it('an include refusal names its kind and position and nothing about the target', () => {
    const text = compileRefusalText('BOOT_PROMPT_INCLUDE_PIN_MISSING', 17, 4);
    expect(text).toContain('pin missing');
    expect(text).toContain('character 17');
  });
  it('BOOT_PROMPT_TARGET_RETIRED blames the Agent, not an include', () => {
    const text = compileRefusalText('BOOT_PROMPT_TARGET_RETIRED', undefined, 4);
    expect(text).toContain('This Agent has been retired');
    expect(text).not.toMatch(/include/i);
  });
  it('is honest when the served revision is none or unknown', () => {
    expect(compileRefusalText('CONFLICT', undefined, null)).toContain('no revision is approved yet');
    expect(compileRefusalText('CONFLICT', undefined, undefined)).toMatch(/Nothing changed\.$/);
    expect(compileRefusalText('CONFLICT', undefined, undefined)).not.toContain('revision');
  });
  it('maps statuses', () => {
    expect(compileRefusalStatus('BOOT_PROMPT_COMPILE_NOT_PERMITTED')).toBe(403);
    expect(compileRefusalStatus('BOOT_PROMPT_INCLUDE_X')).toBe(422);
    expect(compileRefusalStatus('CONFLICT')).toBe(409);
    expect(compileRefusalStatus('WHAT')).toBe(500);
  });
});

describe('boot prompt approval refusals (shared with the node page)', () => {
  it('BOOT_PROMPT_APPROVAL_FORBIDDEN and BOOT_PROMPT_WORKER_SESSION_REFUSED are 403 with their own copy, not the generic 500', () => {
    for (const code of ['BOOT_PROMPT_APPROVAL_FORBIDDEN', 'BOOT_PROMPT_WORKER_SESSION_REFUSED']) {
      expect(approvalRefusalStatus(code)).toBe(403);
      expect(approveRefusalText(code)).not.toContain('Try again');
    }
  });
});
