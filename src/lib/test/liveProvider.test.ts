/**
 * #1979 (live-provider slice), OFFLINE safety pins. No network, no real key,
 * no paid call: the real SDK over an intercepted fake fetch. These must pass
 * (and fail on their mutants) BEFORE any real key is introduced.
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIVE_ENV, MAX_REQUESTS, WINDOW_MS, fileLedger, memoryLedger, redactDiagnostic, resolveGate,
} from './liveProvider';
import { MATRIX, runLiveFromEnv, runMatrix } from './liveProviderMatrix';

const KEY = 'sk-ant-api03-SENTINELKEYabcdefghijklmnop1979zz';
const START = Date.parse('2026-11-12T08:00:00Z');
const NOW = START + 60_000;
const ENV = {
  [LIVE_ENV.flag]: '1', [LIVE_ENV.key]: KEY, [LIVE_ENV.model]: 'synthetic-model',
  [LIVE_ENV.windowStart]: '2026-11-12T08:00:00Z',
};

let captured: unknown[][];
let dir: string;
beforeEach(() => {
  captured = [];
  dir = mkdtempSync(join(tmpdir(), 'live1979-'));
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { captured.push(a); });
  }
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const ok = () => Response.json({
  id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 't', name: 'respond', input: { message: 'hi' } }],
  usage: { input_tokens: 1, output_tokens: 1 },
});
const okText = () => Response.json({
  id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'end_turn',
  content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1, output_tokens: 1 },
});
const reply = (init: RequestInit | undefined) => (JSON.parse(String(init?.body)).tools ? ok() : okText());

describe('the gate decides before any request', () => {
  it.each([
    ['nothing set', {}, 'flag-off'],
    ['flag only', { [LIVE_ENV.flag]: '1' }, 'no-key'],
    ['key only', { [LIVE_ENV.key]: KEY }, 'flag-off'],
    ['flag=true is not the opt-in', { ...ENV, [LIVE_ENV.flag]: 'true' }, 'flag-off'],
    ['CI forces it off even when fully enabled', { ...ENV, CI: 'true' }, 'ci'],
  ] as const)('%s: SKIPPED', (_n, env, reason) => {
    expect(resolveGate(env, NOW, 0)).toEqual({ status: 'skipped', reason });
  });

  it.each([
    ['no model', { ...ENV, [LIVE_ENV.model]: '' }, NOW, 0, 'no-model'],
    ['no window', { ...ENV, [LIVE_ENV.windowStart]: '' }, NOW, 0, 'no-window'],
    ['unparseable window', { ...ENV, [LIVE_ENV.windowStart]: 'yesterday' }, NOW, 0, 'bad-window'],
    ['window in the future', ENV, START - 1, 0, 'window-in-future'],
    ['window expired (at the end instant)', ENV, START + WINDOW_MS, 0, 'window-expired'],
    ['cap spent', ENV, NOW, MAX_REQUESTS, 'cap-exhausted'],
  ] as const)('%s: REFUSED', (_n, env, now, used, reason) => {
    expect(resolveGate(env, now, used)).toEqual({ status: 'refused', reason });
  });

  it('is READY inside the window with cap left, and the cap is 12 / one hour', () => {
    expect(MAX_REQUESTS).toBe(12);
    expect(WINDOW_MS).toBe(3_600_000);
    expect(resolveGate(ENV, NOW, MAX_REQUESTS - 1)).toMatchObject({ status: 'ready', windowEndMs: START + WINDOW_MS });
  });

  it.each([
    ['skipped: no flag', { ...ENV, [LIVE_ENV.flag]: '' }, NOW, 0],
    ['skipped: CI', { ...ENV, CI: '1' }, NOW, 0],
    ['refused: expired window', ENV, START + WINDOW_MS + 1, 0],
    ['refused: cap spent', ENV, NOW, 12],
  ] as const)('%s makes ZERO provider requests', async (_n, env, now, used) => {
    const f = vi.fn(async () => ok());
    const ledgerPath = join(dir, 'ledger.json');
    if (used) { const l = fileLedger(ledgerPath, START); for (let i = 0; i < used; i += 1) l.bump(); }
    const report = await runLiveFromEnv(env, { realFetch: f as unknown as typeof fetch, now: () => now, ledgerPath, outDir: dir });
    expect(report.ran).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(readdirSync(dir).filter((n) => n !== 'ledger.json')).toEqual([]);
  });
});

describe('the matrix drives the real call over a fake transport', () => {
  it('sends the four real request shapes, one request each, nothing else', async () => {
    const bodies: Array<Record<string, any>> = [];
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return reply(init); });
    const gate = resolveGate(ENV, NOW, 0);
    if (gate.status !== 'ready') throw new Error('gate');
    const r = await runMatrix(gate, { realFetch: f as unknown as typeof fetch, now: () => NOW, ledger: memoryLedger() });
    expect(r.cases.map((c) => c.outcome)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(r.requestsTotal).toBe(4);
    const [welcomeRespond, historyRespond, welcomePlain, historyPlain] = bodies;
    expect(welcomeRespond.tools).toHaveLength(1);
    expect(welcomeRespond.tool_choice).toMatchObject({ type: 'tool', name: 'respond' });
    expect(welcomeRespond.messages).toHaveLength(1); // the seeded synthetic user turn
    expect(historyRespond.tools).toHaveLength(1);
    expect(historyRespond.messages).toHaveLength(3);
    expect(welcomePlain.tools).toBeUndefined();
    expect(welcomePlain.messages).toHaveLength(1);
    expect(historyPlain.tools).toBeUndefined();
    expect(historyPlain.messages).toHaveLength(3);
    expect(MATRIX.map((c) => c.id)).toHaveLength(4);
  });

  it('restores the global fetch after the run', async () => {
    const before = globalThis.fetch;
    const gate = resolveGate(ENV, NOW, 0);
    if (gate.status !== 'ready') throw new Error('gate');
    await runMatrix(gate, { realFetch: (async (_u: unknown, i?: RequestInit) => reply(i)) as unknown as typeof fetch, now: () => NOW, ledger: memoryLedger() });
    expect(globalThis.fetch).toBe(before);
  });
});

describe('the cap bounds EVERY request, SDK retries included', () => {
  async function runAll503(max: number, initial = 0) {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { type: 'overloaded_error', message: 'busy' } }), { status: 503, headers: { 'content-type': 'application/json' } }));
    const gate = resolveGate(ENV, NOW, 0);
    if (gate.status !== 'ready') throw new Error('gate');
    const p = runMatrix(gate, { realFetch: f as unknown as typeof fetch, now: () => NOW, ledger: memoryLedger(initial), max });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    return { r: await p, f };
  }

  it('stops at the cap: the transport sees exactly `max` requests and the rest are not run', async () => {
    const { r, f } = await runAll503(5);
    expect(f).toHaveBeenCalledTimes(5);
    expect(r.requestsTotal).toBe(5);
    expect(r.stoppedBy).toBe('cap-exhausted');
    expect(r.cases.some((c) => c.outcome === 'gate-stopped')).toBe(true);
    expect(r.cases.at(-1)?.outcome).toBe('not-run');
  });

  it('counts requests already spent in the ledger (a re-run gets no second matrix)', async () => {
    const { f } = await runAll503(12, 11);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('stops when the window ends mid-run, before the next request', async () => {
    let now = NOW;
    const f = vi.fn(async (_u: unknown, i?: RequestInit) => { now = START + WINDOW_MS; return reply(i); });
    const gate = resolveGate(ENV, NOW, 0);
    if (gate.status !== 'ready') throw new Error('gate');
    const r = await runMatrix(gate, { realFetch: f as unknown as typeof fetch, now: () => now, ledger: memoryLedger() });
    expect(f).toHaveBeenCalledTimes(1);
    expect(r.stoppedBy).toBe('window-expired');
  });
});

describe('a provider 400 is reported with closed fields only', () => {
  const FRAGMENT = KEY.slice(0, 20);
  const message = `bad request: key ${KEY} / head ${FRAGMENT} / tail ${KEY.slice(-12)} / Bearer ${KEY} / x-api-key: ${KEY}`;
  const bad = () => new Response(JSON.stringify({
    type: 'error',
    error: { type: 'invalid_request_error', message, nested: { cause: { key: KEY } } },
  }), { status: 400, headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'request-id': 'req_SENTINELREQ' } });

  it('reproduced 400: public summary, results and every console arg carry no key, message or body', async () => {
    const f = vi.fn(async () => bad());
    const report = await runLiveFromEnv(ENV, { realFetch: f as unknown as typeof fetch, now: () => NOW, ledgerPath: join(dir, 'l.json'), outDir: dir });
    if (!report.ran) throw new Error('should run');
    expect(report.result.reproduced400).toBe(true);
    expect(report.result.cases[0]).toMatchObject({ outcome: 'provider-status', status: 400, type: 'invalid_request_error' });
    const everything = [report.summary, JSON.stringify(report.result.cases), ...captured.map((a) => a.map(String).join(' ')), readFileSync(join(dir, 'summary.txt'), 'utf8')].join('\n');
    for (const bit of [KEY, FRAGMENT, KEY.slice(-12), 'SENTINELKEY', 'bad request', 'req_SENTINELREQ']) expect(everything).not.toContain(bit);
    // The only logger output is the module's own closed line.
    for (const a of captured) expect(a.join(' ')).toMatch(/^\[agent-chat\] llm turn failed class=provider-status /);
    // The LOCAL diagnostic exists but is redacted: no key or key fragment of 6+ chars.
    const local = readFileSync(join(dir, 'diagnostic.local.json'), 'utf8');
    expect(local).toContain('bad request');
    for (let i = 0; i + 6 <= KEY.length; i += 1) expect(local).not.toContain(KEY.slice(i, i + 6));
  });

  it('writes the closed summary and the ledger under the output dir only', async () => {
    await runLiveFromEnv(ENV, { realFetch: (async () => bad()) as unknown as typeof fetch, now: () => NOW, ledgerPath: join(dir, 'l.json'), outDir: dir });
    expect(readdirSync(dir).sort()).toEqual(['diagnostic.local.json', 'l.json', 'summary.txt']);
  });
});

describe('redactDiagnostic', () => {
  it.each([
    ['exact key', `x ${KEY} y`],
    ['truncated prefix', `x ${KEY.slice(0, 14)}… y`],
    ['truncated tail', `x …${KEY.slice(-10)} y`],
    ['key split by a space', `x ${KEY.slice(0, 15)} ${KEY.slice(15)} y`],
    ['bearer header', 'Authorization: Bearer abcdefghijklmnop'],
    ['a credential-shaped token', 'token sk-live-ZZZZZZZZZZZZ here'],
  ])('%s', (_n, text) => {
    const out = redactDiagnostic(text, KEY);
    for (let i = 0; i + 6 <= KEY.length; i += 1) expect(out).not.toContain(KEY.slice(i, i + 6));
    expect(out).not.toMatch(/Bearer\s+abcdefghijklmnop/);
    expect(out).not.toContain('sk-live-');
  });
  it('keeps ordinary prose', () => {
    expect(redactDiagnostic('messages.0: text content blocks must be non-empty', KEY)).toBe('messages.0: text content blocks must be non-empty');
  });
});
