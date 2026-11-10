import { describe, expect, it } from 'vitest';
import { workerOfPage } from './refresh-page';

describe('ticker-apply recovery route identity (#1475)', () => {
  it('S15b: accepts exactly the worker URL, not a prefix, suffix or nested path', () => {
    for (const path of ['/app/workers/w-A', '/app/workers/w-A/']) {
      expect(workerOfPage({ url: new URL(`https://example.test${path}`) })).toBe('w-A');
    }
    for (const path of ['/prefix/app/workers/w-A', '/app/workers/w-A/nested', '/app/workers', '/app/memories/w-A']) {
      expect(workerOfPage({ url: new URL(`https://example.test${path}`) }), path).toBeNull();
    }
  });

  it('S15c: params belong to a worker only on the worker route; a real root boundary falls back to its URL', () => {
    const url = new URL('https://example.test/app/memories/w-A');
    expect(workerOfPage({ route: { id: '/app/memories/[id]' }, params: { id: 'w-A' }, url })).toBeNull();
    expect(workerOfPage({ route: { id: '/app/workers/[id]' }, params: { id: 'w-A' }, url })).toBe('w-A');
    const urn = 'hrn:worker:example.test:team:worker-a';
    expect(workerOfPage({ route: { id: null }, params: {}, url: new URL(`https://example.test/app/workers/${encodeURIComponent(urn)}`) })).toBe(urn);
    expect(workerOfPage({ url: new URL('https://example.test/app/workers/%E0%A4%A') })).toBeNull();
  });
});
