/**
 * Extracted from two loaders that each had their own copy (PR #704 review,
 * Copilot). These pin the three behaviours that were easy to let drift.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_UPLOADER_LOOKUPS, resolveUploaderNames } from './assetUploaders';
import { USER_PROFILE_QUERY } from './queries';

const mockRequest = vi.fn();
const client = { request: mockRequest } as never;

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function users(map: Record<string, string | null>) {
  mockRequest.mockImplementation(async (doc: string, vars: { ref: string }) => {
    expect(doc).toBe(USER_PROFILE_QUERY);
    const handle = map[vars.ref];
    return { user: handle === undefined ? null : handle && { id: vars.ref, handle } };
  });
}

const refs = () => mockRequest.mock.calls.map(([, v]) => (v as { ref: string }).ref);

describe('resolveUploaderNames', () => {
  it('maps ids to @handle', async () => {
    users({ 'u1': 'ada', 'u2': 'grace' });
    const out = await resolveUploaderNames(client, [{ uploadedBy: 'u1' }, { uploadedBy: 'u2' }]);
    expect(out).toEqual({ u1: '@ada', u2: '@grace' });
  });

  it('never looks up a NULL uploader', async () => {
    // A server-authored asset (hadron_store_file, no on-behalf-of user) has no
    // user to resolve — a normal case, not missing data.
    users({});
    const out = await resolveUploaderNames(client, [{ uploadedBy: null }, { uploadedBy: null }]);
    expect(out).toEqual({});
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('omits an id the caller may not resolve, without failing', async () => {
    // `user(ref:)` returns null for a user the caller can't see; denied and
    // missing are indistinguishable by design.
    users({ 'u1': null });
    expect(await resolveUploaderNames(client, [{ uploadedBy: 'u1' }])).toEqual({});
  });

  it('isolates a throwing lookup so one bad id cannot blank the page', async () => {
    mockRequest.mockImplementation(async (_doc: string, vars: { ref: string }) => {
      if (vars.ref === 'bad') throw new Error('boom');
      return { user: { id: vars.ref, handle: 'ada' } };
    });
    const out = await resolveUploaderNames(client, [{ uploadedBy: 'bad' }, { uploadedBy: 'u1' }]);
    expect(out).toEqual({ u1: '@ada' });
  });

  it('dedupes repeated uploaders', async () => {
    users({ 'u1': 'ada' });
    await resolveUploaderNames(client, [
      { uploadedBy: 'u1' },
      { uploadedBy: 'u1' },
      { uploadedBy: 'u1' },
    ]);
    expect(refs()).toEqual(['u1']);
  });

  it('caps the fan-out at MAX_UPLOADER_LOOKUPS', async () => {
    users({});
    const many = Array.from({ length: MAX_UPLOADER_LOOKUPS + 15 }, (_, i) => ({
      uploadedBy: `u${i}`,
    }));
    await resolveUploaderNames(client, many);
    expect(refs()).toHaveLength(MAX_UPLOADER_LOOKUPS);
    expect(new Set(refs()).size).toBe(MAX_UPLOADER_LOOKUPS);
  });

  it('handles an empty list without a request', async () => {
    expect(await resolveUploaderNames(client, [])).toEqual({});
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
