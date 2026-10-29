/**
 * portal#1141 slice A — the delivery settings' wire (S9, hadron-server
 * #2059/#2025): which fields a save sends, and how each refusal is shown.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  APP_DELIVERY_SETTINGS_QUERY,
  SET_APP_DELIVERY_SETTINGS_MUTATION,
  buildDeliveryPatch,
  classifyDeliveryError,
  loadAppDeliverySettings,
} from './delivery-settings';

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.append(k, v);
  return fd;
};
const was = { batchWindowSecondsWas: '120', busyDelaySecondsWas: '600', stuckWindowSecondsWas: '900' };
const gqlError = (code: string, message = `server says ${code}`) => ({ response: { errors: [{ message, extensions: { code } }] } });

describe('documents', () => {
  it('reads the five S9 fields and writes through setAppDeliverySettings with a String appRef', () => {
    for (const f of ['batchWindowSeconds', 'busyDelaySeconds', 'stuckWindowSeconds', 'standbyEnabled', 'standbyEffective']) {
      expect(APP_DELIVERY_SETTINGS_QUERY).toContain(f);
      expect(SET_APP_DELIVERY_SETTINGS_MUTATION).toContain(f);
    }
    expect(APP_DELIVERY_SETTINGS_QUERY).toContain('$appRef: String!');
    expect(SET_APP_DELIVERY_SETTINGS_MUTATION).toContain('setAppDeliverySettings(appRef: $appRef, input: $input)');
  });
});

describe('buildDeliveryPatch', () => {
  it('sends only the fields the reader changed, as numbers', () => {
    expect(buildDeliveryPatch(form({ ...was, batchWindowSeconds: '120', busyDelaySeconds: '300', stuckWindowSeconds: '900' }))).toEqual({
      patch: { busyDelaySeconds: 300 },
    });
  });

  it('never sends standbyEnabled, even if a crafted form carries it', () => {
    const r = buildDeliveryPatch(form({ ...was, batchWindowSeconds: '120', busyDelaySeconds: '600', stuckWindowSeconds: '1000', standbyEnabled: 'on' }));
    expect(r).toEqual({ patch: { stuckWindowSeconds: 1000 } });
  });

  it('nothing changed sends nothing', () => {
    expect(buildDeliveryPatch(form({ ...was, batchWindowSeconds: '120', busyDelaySeconds: '600', stuckWindowSeconds: '900' }))).toMatchObject({
      invalid: { field: 'form' },
    });
  });

  it.each(['', 'abc', '1.5', '-3', '1e3', ' '])('%j is not a whole number of seconds, and calls nothing', (v) => {
    expect(buildDeliveryPatch(form({ ...was, batchWindowSeconds: '120', busyDelaySeconds: v, stuckWindowSeconds: '900' }))).toMatchObject({
      invalid: { field: 'busyDelaySeconds' },
    });
  });

  it('a number past a GraphQL Int is refused here instead of being sent', () => {
    expect(buildDeliveryPatch(form({ ...was, batchWindowSeconds: '120', busyDelaySeconds: '600', stuckWindowSeconds: '99999999999' }))).toMatchObject({
      invalid: { field: 'stuckWindowSeconds' },
    });
  });

  it('out-of-range whole numbers ARE sent: the server’s limits decide, with its own sentence', () => {
    expect(buildDeliveryPatch(form({ ...was, batchWindowSeconds: '120', busyDelaySeconds: '0', stuckWindowSeconds: '900' }))).toEqual({
      patch: { busyDelaySeconds: 0 },
    });
  });
});

describe('classifyDeliveryError', () => {
  it.each([
    'DELIVERY_SETTINGS_OUT_OF_RANGE',
    'DELIVERY_SETTINGS_CONFLICT',
    'TICKER_SETTINGS_OUT_OF_RANGE',
    'TICKER_SETTINGS_CONFLICT',
    'BAD_USER_INPUT',
    'APP_NOT_FOUND',
  ])('%s is shown as the server’s sentence, verbatim, with its code', (code) => {
    expect(classifyDeliveryError(gqlError(code))).toEqual({ kind: 'refused', code, message: `server says ${code}` });
  });

  it('the manager refusal is shown; a bare "Forbidden" is not', () => {
    const sentence = 'Only whoever manages this App can change its settings.';
    expect(classifyDeliveryError(gqlError('FORBIDDEN', sentence))).toEqual({ kind: 'refused', code: 'FORBIDDEN', message: sentence });
    expect(classifyDeliveryError(gqlError('FORBIDDEN', 'Forbidden'))).toEqual({ kind: 'uncertain' });
  });

  it('DELIVERY_STANDBY_UNAVAILABLE, unknown codes, no payload and transport failures are the uncertain line', () => {
    expect(classifyDeliveryError(gqlError('DELIVERY_STANDBY_UNAVAILABLE'))).toEqual({ kind: 'uncertain' });
    expect(classifyDeliveryError(gqlError('INTERNAL_SERVER_ERROR', 'prisma stack'))).toEqual({ kind: 'uncertain' });
    expect(classifyDeliveryError(new Error('ECONNRESET'))).toEqual({ kind: 'uncertain' });
  });
});

describe('loadAppDeliverySettings', () => {
  const settings = { batchWindowSeconds: 120, busyDelaySeconds: 600, stuckWindowSeconds: 900, standbyEnabled: false, standbyEffective: false };

  it('ok carries exactly what the server returned', async () => {
    const client = { request: vi.fn().mockResolvedValue({ appDeliverySettings: settings }) };
    expect(await loadAppDeliverySettings(client as never, 'app-1')).toEqual({ kind: 'ok', value: settings });
    expect(client.request).toHaveBeenCalledWith(APP_DELIVERY_SETTINGS_QUERY, { appRef: 'app-1' });
  });

  it('APP_NOT_FOUND is not-participant; anything else stays a failure, never defaults', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadAppDeliverySettings({ request: vi.fn().mockRejectedValue(gqlError('APP_NOT_FOUND')) } as never, 'a')).toEqual({ kind: 'not-participant' });
    expect(await loadAppDeliverySettings({ request: vi.fn().mockRejectedValue(gqlError('INTERNAL_SERVER_ERROR')) } as never, 'a')).toEqual({ kind: 'failed' });
  });
});
