/**
 * #936 — the abstract's search hint follows the memory's effective vector
 * configuration, and never claims a search role the memory doesn't give it.
 */
import { describe, expect, it } from 'vitest';
import { abstractPlaceholder, abstractSearchHint } from './abstract-search-hint';

describe('abstractSearchHint (#936)', () => {
  it('a knowledge memory at its server default (index on, contentChunks) says abstracts are NOT embedded', () => {
    const hint = abstractSearchHint({ vectorIndexEnabled: true, embeddingSource: 'contentChunks' });
    expect(hint).toContain('not abstracts');
  });

  it('an abstract-sourced index says the abstract is what search matches on', () => {
    expect(abstractSearchHint({ vectorIndexEnabled: true, embeddingSource: 'abstract' })).toContain('embeds abstracts');
  });

  it('a null source reads as the column default, abstract', () => {
    expect(abstractSearchHint({ vectorIndexEnabled: true, embeddingSource: null })).toContain('embeds abstracts');
  });

  it('both sources says both', () => {
    expect(abstractSearchHint({ vectorIndexEnabled: true, embeddingSource: 'both' })).toContain('both abstracts and content');
  });

  it.each([
    ['index off', { vectorIndexEnabled: false, embeddingSource: 'abstract' as const }],
    ['index unknown', { embeddingSource: 'abstract' as const }],
    ['no memory config', null],
  ])('%s: no search claim at all', (_n, memory) => {
    expect(abstractSearchHint(memory)).toBeNull();
  });

  it('an unknown future source makes no claim', () => {
    expect(abstractSearchHint({ vectorIndexEnabled: true, embeddingSource: 'somethingNew' as never })).toBeNull();
  });
});

describe('abstractPlaceholder', () => {
  it('says what an abstract is, and nothing about search', () => {
    expect(abstractPlaceholder()).not.toMatch(/search|vector|embed/i);
  });
});

describe('no page claims the abstract is THE vector-search source (#936)', () => {
  // The unconditional claim that was wrong for contentChunks memories. A guard
  // over the sources, because the three sites that made it were hard-coded
  // strings no component test would have rendered in the wrong memory.
  // Also the settings page's "Abstract (default)" / "the abstract is the default
  // source": which source a memory starts with depends on how it was created.
  const CLAIM = /default source for vector search|Abstract \(default\)|abstract is the default source/i;

  it.each([
    'Paragraph-length summary — the default source for vector search.',
    '<option value="abstract">Abstract (default)</option>',
    'The abstract is the default source. Content chunks index the full body in token windows.',
  ])('the matcher recognises the old copy: %s', (old) => {
    expect(old).toMatch(CLAIM);
  });

  it('no .svelte file under src/ contains it', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.svelte') && CLAIM.test(readFileSync(path, 'utf8'))) hits.push(path);
      }
    };
    walk('src');
    expect(hits).toEqual([]);
  });
});
