import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configCall } from './client';

const fetcher = vi.fn();

beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('memory-config transport cache boundary (#1749 B1)', () => {
  it('sends a successful request with cache no-store', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ value: { id: 'config', rules: [] } }), { status: 200 }));
    await expect(configCall({ kind: 'rules', op: 'read', memoryRef: 'mem-1' })).resolves.toEqual({ value: { id: 'config', rules: [] } });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/memory-config', expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
    }));
  });

  it('keeps cache no-store on an error-envelope control', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ error: 'Forbidden', code: 'FORBIDDEN' }), { status: 403 }));
    await expect(configCall({ kind: 'rules', op: 'read', memoryRef: 'mem-1' })).rejects.toMatchObject({ error: 'Forbidden', code: 'FORBIDDEN' });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/memory-config', expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
    }));
  });
});
