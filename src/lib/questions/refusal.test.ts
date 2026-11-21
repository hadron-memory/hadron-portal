import { readFileSync } from 'node:fs';
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

  // Read from the snapshot, not copied by hand, so a code the server adds to a question mutation fails here.
  const schema = readFileSync('schema/schema.graphql', 'utf8');
  const documentedCodes = (field: string): string[] => {
    const m = schema.match(new RegExp(`\"\"\"([^\"]*?)\"\"\"\\s*\\n\\s*${field}\\(`));
    return m ? [...new Set(m[1].match(/\b(?:QUESTION_[A-Z_]+|NODE_WRITE_CONFLICT)\b/g) ?? [])] : [];
  };
  it.each(['answerQuestion', 'retractQuestionAnswer', 'withdrawQuestion'])('every code %s documents in the schema has the portal\'s own text', (field) => {
    const codes = documentedCodes(field);
    if (field !== 'withdrawQuestion') expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) expect(questionRefusal(code), code).not.toBeNull();
  });
});
