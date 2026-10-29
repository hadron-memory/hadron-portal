/**
 * portal#1139 — the stop-signals reads and the set form's input: a banner that
 * never says "none" from a partial read, a hint that never reads a failure as
 * "no", a set that never sends HOST, and refusals that name only fixed
 * sentences.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STOP_BANNER_MAX_PAGES,
  TEAM_STOP_SIGNALS_QUERY,
  buildSetInput,
  classifyStopError,
  loadLiveStops,
  loadManagesHint,
} from './stop-signals';

const request = vi.fn();
const client = { request } as never;
const gqlError = (code: string, message = 'server words') => ({ response: { errors: [{ message, extensions: { code } }] } });
const sig = (id: string) => ({ id, live: true });
const page = (ids: string[], next: string | null) => ({
  teamStopSignals: { signals: ids.map(sig), pageInfo: { hasNextPage: next !== null, endCursor: next } },
});

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('loadLiveStops (the banner read)', () => {
  it('asks for live signals only, 200 at a time', async () => {
    request.mockResolvedValueOnce(page(['a'], null));
    await loadLiveStops(client, 'app-1');
    expect(request).toHaveBeenCalledWith(TEAM_STOP_SIGNALS_QUERY, { appRef: 'app-1', includeEnded: false, first: 200 });
  });

  it('follows pages to the end and is complete', async () => {
    request.mockResolvedValueOnce(page(['a'], 'c1')).mockResolvedValueOnce(page(['b'], null));
    const r = await loadLiveStops(client, 'app-1');
    expect(r).toEqual({ kind: 'ok', value: { signals: [sig('a'), sig('b')], complete: true } });
    expect(request.mock.calls[1][1]).toMatchObject({ after: 'c1' });
  });

  it('stops at the page bound and says the read is partial', async () => {
    request.mockImplementation(async () => page(['x'], 'more'));
    const r = await loadLiveStops(client, 'app-1');
    expect(request).toHaveBeenCalledTimes(STOP_BANNER_MAX_PAGES);
    expect(r).toMatchObject({ kind: 'ok', value: { complete: false } });
    expect(r.kind === 'ok' && r.value.signals).toHaveLength(STOP_BANNER_MAX_PAGES);
  });

  it('answers a non-participant as such and any other failure as failed, never as no stops', async () => {
    request.mockRejectedValueOnce(gqlError('APP_NOT_FOUND'));
    expect(await loadLiveStops(client, 'app-1')).toEqual({ kind: 'not-participant' });
    request.mockRejectedValueOnce(new Error('network'));
    expect(await loadLiveStops(client, 'app-1')).toEqual({ kind: 'failed' });
  });

  it('a page that fails after the first is failed, not a shorter list', async () => {
    request.mockResolvedValueOnce(page(['a'], 'c1')).mockRejectedValueOnce(new Error('boom'));
    expect(await loadLiveStops(client, 'app-1')).toEqual({ kind: 'failed' });
  });
});

describe('loadManagesHint (App.viewerManages is a display hint)', () => {
  it('maps true and false', async () => {
    request.mockResolvedValueOnce({ app: { id: 'a', viewerManages: true } });
    expect(await loadManagesHint(client, 'app-1')).toBe('yes');
    request.mockResolvedValueOnce({ app: { id: 'a', viewerManages: false } });
    expect(await loadManagesHint(client, 'app-1')).toBe('no');
  });

  it('reads a failed, null or odd answer as unknown, never as no', async () => {
    request.mockRejectedValueOnce(new Error('network'));
    expect(await loadManagesHint(client, 'app-1')).toBe('unknown');
    request.mockResolvedValueOnce({ app: null });
    expect(await loadManagesHint(client, 'app-1')).toBe('unknown');
    request.mockResolvedValueOnce({ app: { id: 'a' } });
    expect(await loadManagesHint(client, 'app-1')).toBe('unknown');
  });
});

describe('buildSetInput', () => {
  const form = (o: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(o)) fd.set(k, v);
    return fd;
  };
  const now = new Date('2026-10-30T00:00:00Z');

  it('builds a worker stop with no until', () => {
    expect(buildSetInput(form({ level: 'PAUSE', scope: 'WORKER', worker: 'w1' }), 'app-1', now)).toEqual({
      input: { appRef: 'app-1', level: 'PAUSE', scope: 'WORKER', worker: 'w1' },
    });
  });

  it('a team names its head as `worker`', () => {
    expect(buildSetInput(form({ level: 'HALT', scope: 'TEAM', worker: 'head' }), 'app-1', now)).toEqual({
      input: { appRef: 'app-1', level: 'HALT', scope: 'TEAM', worker: 'head' },
    });
  });

  it('never builds a HOST stop', () => {
    expect(buildSetInput(form({ level: 'PAUSE', scope: 'HOST', worker: 'w1' }), 'app-1', now)).toMatchObject({ invalid: { field: 'scope' } });
  });

  it('refuses an unknown level and a missing target', () => {
    expect(buildSetInput(form({ level: 'STOP', scope: 'WORKER', worker: 'w1' }), 'app-1', now)).toMatchObject({ invalid: { field: 'level' } });
    expect(buildSetInput(form({ level: 'PAUSE', scope: 'WORKER', worker: ' ' }), 'app-1', now)).toMatchObject({ invalid: { field: 'worker' } });
    expect(buildSetInput(form({ level: 'PAUSE', scope: 'TEAM', worker: '' }), 'app-1', now)).toMatchObject({
      invalid: { field: 'worker', message: expect.stringContaining('heads the team') },
    });
  });

  it('sends until as an ISO instant only when it is later than now', () => {
    const ok = buildSetInput(form({ level: 'PAUSE', scope: 'WORKER', worker: 'w1', until: '2026-10-31T12:00:00Z' }), 'app-1', now);
    expect(ok).toMatchObject({ input: { until: '2026-10-31T12:00:00.000Z' } });
    expect(buildSetInput(form({ level: 'PAUSE', scope: 'WORKER', worker: 'w1', until: '2026-10-29T12:00:00Z' }), 'app-1', now)).toMatchObject({ invalid: { field: 'until' } });
    expect(buildSetInput(form({ level: 'PAUSE', scope: 'WORKER', worker: 'w1', until: 'soon' }), 'app-1', now)).toMatchObject({ invalid: { field: 'until' } });
  });
});

describe('classifyStopError', () => {
  it.each([
    'APP_MANAGER_REQUIRED',
    'HOST_SCOPE_REQUIRED',
    'STOP_SIGNAL_SCOPE_FORBIDDEN',
    'STOP_SIGNAL_NOT_FOUND',
    'STOP_SIGNAL_UNAVAILABLE',
    'BAD_USER_INPUT',
    'APP_NOT_FOUND',
  ])('%s is a typed refusal with a fixed sentence, never the server text', (code) => {
    const r = classifyStopError(gqlError(code, 'raw upstream text'));
    expect(r).toMatchObject({ kind: 'refused', code });
    expect(JSON.stringify(r)).not.toContain('raw upstream text');
  });

  it('STOP_SIGNAL_UNAVAILABLE says nothing was set', () => {
    const r = classifyStopError(gqlError('STOP_SIGNAL_UNAVAILABLE'));
    expect(r.kind === 'refused' && r.message).toMatch(/^Nothing was set/);
  });

  it('an unknown code, a bare FORBIDDEN and a transport failure are uncertain', () => {
    expect(classifyStopError(gqlError('SOMETHING_ELSE'))).toEqual({ kind: 'uncertain' });
    expect(classifyStopError(gqlError('FORBIDDEN', 'Forbidden'))).toEqual({ kind: 'uncertain' });
    expect(classifyStopError(new Error('network'))).toEqual({ kind: 'uncertain' });
    expect(classifyStopError(null)).toEqual({ kind: 'uncertain' });
  });

  it('the impersonation sentence is shown', () => {
    expect(classifyStopError(gqlError('FORBIDDEN', 'Impersonation sessions are read-only.'))).toMatchObject({ kind: 'refused', code: 'FORBIDDEN' });
  });
});
