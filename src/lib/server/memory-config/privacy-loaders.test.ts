import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { rulesPageData, templatesPageData } from '$lib/server/memory-config/page-data';
import { load as accountLoad } from '../../../routes/app/account/node-role-templates/+page.server';
import { load as orgLoad } from '../../../routes/app/orgs/[id]/node-role-templates/+page.server';
import { load as appLoad } from '../../../routes/app/apps/[appId]/node-role-templates/+page.server';
import { load as memoryLoad } from '../../../routes/app/memories/[id]/settings/node-roles/+page.server';

vi.mock('$lib/server/memory-config/page-data', () => ({
  templatesPageData: vi.fn(),
  rulesPageData: vi.fn(),
}));

const templatesMock = vi.mocked(templatesPageData);
const rulesMock = vi.mocked(rulesPageData);

const cases = [
  { name: 'account', load: accountLoad, params: {}, mock: templatesMock, args: ['USER', 'user-1'] },
  { name: 'organization', load: orgLoad, params: { id: 'org-1' }, mock: templatesMock, args: ['ORGANIZATION', 'org-1'] },
  { name: 'App', load: appLoad, params: { appId: 'app-1' }, mock: templatesMock, args: ['APP', 'app-1'] },
  { name: 'memory', load: memoryLoad, params: { id: 'mem-1' }, mock: rulesMock, args: ['mem-1'] },
] as const;

function forbidden() {
  try { error(403, 'Forbidden'); } catch (e) { return e; }
}

function event(setHeaders: ReturnType<typeof vi.fn>) {
  return {
    locals: { user: { id: 'user-1' }, token: 'token', impersonation: { sessionId: 'session-1' } },
    setHeaders,
  };
}

beforeEach(() => {
  templatesMock.mockReset();
  rulesMock.mockReset();
});

describe('memory-config sensitive loader cache boundary (#1749 B1)', () => {
  it.each(cases)('$name loader sets private no-store on success and passes its actual principal/resource', async ({ load, params, mock, args }) => {
    mock.mockResolvedValue({ config: null, templates: [] } as never);
    const setHeaders = vi.fn();
    const result = await load({ ...event(setHeaders), params } as never);
    expect(result).toBeDefined();
    expect(mock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      user: expect.objectContaining({ id: 'user-1' }),
      token: 'token',
      impersonation: { sessionId: 'session-1' },
    }), ...args);
    expect(setHeaders).toHaveBeenCalledExactlyOnceWith({ 'cache-control': 'private, no-store' });
  });

  it.each(cases)('$name loader keeps private no-store on its authorized refusal path', async ({ load, params, mock }) => {
    mock.mockRejectedValue(forbidden());
    const setHeaders = vi.fn();
    await expect(load({ ...event(setHeaders), params } as never)).rejects.toMatchObject({ status: 403 });
    expect(setHeaders).toHaveBeenCalledExactlyOnceWith({ 'cache-control': 'private, no-store' });
  });
});
