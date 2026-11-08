/** portal#1684: the marks ride their own read, so a refusal costs the marks and never the App page. */
import { describe, expect, it, vi } from 'vitest';
import { APP_INSTALL_MARKS_QUERY } from './queries';
import { readAppInstallMarks } from './app-install-marks';

describe('readAppInstallMarks', () => {
  it('asks by the App and returns the marks', async () => {
    const request = vi.fn(async () => ({ app: { id: 'a1', appAgents: [{ agent: { id: 'b' }, installMethod: 'ROW', importer: null }] } }));
    await expect(readAppInstallMarks({ request } as never, 'a1')).resolves.toEqual({ b: { kind: 'installed' } });
    expect(request).toHaveBeenCalledWith(APP_INSTALL_MARKS_QUERY, { ref: 'a1' });
  });

  it('a failed read gives no marks and doesn’t throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const request = vi.fn(async () => { throw new Error('nope'); });
    await expect(readAppInstallMarks({ request } as never, 'a1')).resolves.toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a null App gives no marks', async () => {
    await expect(readAppInstallMarks({ request: vi.fn(async () => ({ app: null })) } as never, 'a1')).resolves.toEqual({});
  });
});
