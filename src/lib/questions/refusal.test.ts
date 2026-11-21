import { describe, expect, it } from 'vitest';
import { questionRefusal, refusalNeedsReload } from './refusal';

describe('question refusals (portal#2234)', () => {
  it.each(['QUESTION_FORBIDDEN', 'QUESTION_LOG_NOT_FOUND', 'FORBIDDEN'])('%s has the portal\'s own text and is not a generic 500', (code) => {
    const r = questionRefusal(code);
    expect(r).not.toBeNull();
    expect(r!.status).toBeLessThan(500);
    expect(r!.text).not.toContain(code);
  });
  it('an unknown code is null', () => expect(questionRefusal('SOMETHING_ELSE')).toBeNull());
  it.each(['NODE_WRITE_CONFLICT', 'QUESTION_UNKNOWN_OPTION', 'QUESTION_WITHDRAWN', 'QUESTION_NOT_ANSWERED', 'QUESTION_NOT_FOUND'])('%s reloads the card', (c) => expect(refusalNeedsReload(c)).toBe(true));
  it('a forbidden refusal does not reload', () => expect(refusalNeedsReload('QUESTION_FORBIDDEN')).toBe(false));
});
