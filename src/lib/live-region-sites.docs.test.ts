import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as scan from './live-region-sites.scan';

/**
 * portal#2581: three leftovers from the #2579 delta reviews, pinned so they cannot drift back.
 *  - N1: the ratchet's header names `unreviewedSites` and what listing a site there means.
 *  - N2: the churn-recovery note names BOTH lists to re-key after an identity changes.
 *  - F8: the counting function says it counts.
 */
const read = (f: string) => readFileSync(join(process.cwd(), 'src/lib', f), 'utf8');

describe('portal#2581 leftovers', () => {
  it('N1: the ratchet header names unreviewedSites and what listing a site there means', () => {
    const header = read('live-region-sites.test.ts').split('const SRC')[0];
    expect(header).toContain('unreviewedSites');
    expect(header).toMatch(/unreviewedSites[^]*(not (yet )?(converted|reviewed)|nobody has reviewed)/i);
  });

  it('N2: the churn-recovery note names reviewedNotDefects and unreviewedSites', () => {
    const doc = read('live-region-sites.scan.ts');
    const note = doc.slice(doc.indexOf('Two limits, both disclosed'), doc.indexOf('export function conditionalStatusIdentities'));
    expect(note).toContain('reviewedNotDefects');
    expect(note).toContain('unreviewedSites');
  });

  it('F8: the count is named for what it returns', () => {
    expect(typeof (scan as Record<string, unknown>).countConditionalStatusRegions).toBe('function');
    expect((scan as Record<string, unknown>).conditionalStatusRegions).toBeUndefined();
  });
});
