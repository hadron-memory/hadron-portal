import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

afterEach(() => vi.unstubAllGlobals());

describe('copyText', () => {
  it('writes the text and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('k1')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('k1');
  });

  it('reports failure, without throwing, where navigator.clipboard is undefined', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyText('k1')).resolves.toBe(false);
  });

  it('reports failure when writeText rejects', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    await expect(copyText('k1')).resolves.toBe(false);
  });

  it('reports failure when writeText throws synchronously', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => { throw new Error('boom'); } } });
    await expect(copyText('k1')).resolves.toBe(false);
  });

  it('reports failure with no navigator at all', async () => {
    vi.stubGlobal('navigator', undefined);
    await expect(copyText('k1')).resolves.toBe(false);
  });
});
