/**
 * portal#1665 review folds: the host pages that sit above other content must render the served
 * records collapsed (Uma P2), and the worker page's session pick counts only while it is a row of
 * THIS worker's list (Rook P3-1, the gate's "no route-stale record under another worker").
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pickedSessionFor } from './served-prompts';

const src = (p: string) => readFileSync(p, 'utf8');

describe('collapsed hosts', () => {
  it('the worker Boot briefing host and the run page pass `collapsible`', () => {
    expect(src('src/routes/app/workers/[id]/+page.svelte')).toMatch(/<ServedPrompt[^>]*\bcollapsible\b[^>]*source="worker"|<ServedPrompt[^>]*source="worker"[^>]*\bcollapsible\b/);
    expect(src('src/routes/app/apps/[appId]/runs/[runId]/+page.svelte')).toMatch(/<ServedPrompt[^>]*\bcollapsible\b/);
  });
});

describe('pickedSessionFor', () => {
  const rows = [{ id: 'a' }, { id: 'b' }];
  it('keeps a pick that is a row of this worker', () => expect(pickedSessionFor(rows, 'b')).toBe('b'));
  it('drops a pick left over from another worker (A to B reuse)', () => expect(pickedSessionFor(rows, 'zzz')).toBeNull());
  it('null pick, missing or empty list => null', () => {
    expect(pickedSessionFor(rows, null)).toBeNull();
    expect(pickedSessionFor(undefined, 'a')).toBeNull();
    expect(pickedSessionFor([], 'a')).toBeNull();
  });
});
