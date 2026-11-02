/**
 * #817 — the i18n boundary's interpolation.
 *
 * The defect this replaces is not hypothetical and not an injection: it
 * silently corrupted DISPLAYED values, including accessible names, where the
 * reader has no visible copy to compare against. The two cases below are the
 * runnable proof from the issue, and they are the reason a replacer function
 * lives at the boundary rather than at 35 call sites.
 */
import { describe, expect, it } from 'vitest';
import { fill, splitAt, t } from './t';

describe('fill', () => {
  it('substitutes a placeholder', () => {
    expect(fill('Download {file}', { file: 'notes.txt' })).toBe('Download notes.txt');
  });

  // THE regression. `$&` is the matched text, so with a naive
  // `.replace('{sig}', value)` the placeholder reappears INSIDE the value.
  it('does not expand $& — the placeholder must not come back', () => {
    expect(fill('Signature: {sig}', { sig: 'Eicar$&Test' })).toBe('Signature: Eicar$&Test');
    // Stated as the contrast, so the test says what it is protecting against.
    expect('Signature: {sig}'.replace('{sig}', 'Eicar$&Test')).toBe('Signature: Eicar{sig}Test');
  });

  it('does not expand $` — which splices in everything before the match', () => {
    expect(fill('Download {file}', { file: 'a$`b.txt' })).toBe('Download a$`b.txt');
    expect('Download {file}'.replace('{file}', 'a$`b.txt')).toBe('Download aDownload b.txt');
  });

  it.each([
    ["$'", "a$'b"],
    ['$1', 'a$1b'],
    ['$$', 'a$$b'],
  ])('does not expand %s', (_what, value) => {
    expect(fill('x {v} y', { v: value })).toBe(`x ${value} y`);
  });

  it('fills every occurrence of a placeholder, and several different ones', () => {
    expect(fill('{shown} of {total} ({shown} shown)', { shown: 3, total: 9 })).toBe('3 of 9 (3 shown)');
  });

  it('accepts numbers without the caller stringifying them', () => {
    expect(fill('{n} days', { n: 7 })).toBe('7 days');
  });

  // An unknown or absent value leaves the placeholder standing. `{name}` on
  // screen is a legible bug report; an empty gap is a sentence that reads as
  // finished and is missing a word.
  it.each([
    ['an unknown key', {}],
    ['a null value', { name: null }],
    ['an undefined value', { name: undefined }],
  ])('leaves the placeholder standing for %s', (_what, vars) => {
    expect(fill('Welcome, {name}', vars)).toBe('Welcome, {name}');
  });

  it('leaves a template with no placeholders alone', () => {
    expect(fill('Nothing to fill', { a: 'b' })).toBe('Nothing to fill');
  });

  // A value that itself looks like a placeholder must not be re-scanned — the
  // replacer runs once per match over the ORIGINAL string, so this holds by
  // construction, and pinning it stops a "clever" rewrite using a loop.
  it('does not re-scan a substituted value', () => {
    expect(fill('{a}', { a: '{b}', b: 'no' })).toBe('{b}');
  });
});

describe('t', () => {
  it('returns the default text unchanged when no vars are given', () => {
    expect(t('x.y', 'Plain text')).toBe('Plain text');
    // Braces in a var-less string are left alone: `t` is used for literal copy
    // far more often than for templates.
    expect(t('x.y', 'Use {curly} braces')).toBe('Use {curly} braces');
  });

  it('interpolates safely when vars are given', () => {
    expect(t('assets.download.aria', 'Download {file}', { file: 'a$&b' })).toBe('Download a$&b');
  });
});

// portal#1415 A: a sentence with an inline link is ONE message; the placeholder's
// position is the translator's to choose.
describe('splitAt', () => {
  it('splits a message around a placeholder', () => {
    expect(splitAt('Listed on the {link}, not here.', 'link')).toEqual(['Listed on the ', ', not here.']);
  });
  it('lets a translation put the link first or last', () => {
    expect(splitAt('{link} zeigt sie', 'link')).toEqual(['', ' zeigt sie']);
    expect(splitAt('Siehe {link}', 'link')).toEqual(['Siehe ', '']);
  });
  it('a message missing the placeholder keeps its text before and drops nothing', () => {
    expect(splitAt('no link here', 'link')).toEqual(['no link here', '']);
  });
});
