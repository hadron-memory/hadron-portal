/**
 * Found by driving the real upload path locally after #697 merged: on a PERSONAL
 * memory — everything under "My memories" — the Files tab offered an Upload
 * control and the node page an "Attach file" action, both of which could only
 * fail, with an opaque "the server had a problem".
 *
 * hadron-server's beginAssetUpload rejects any memory with no organization (the
 * storage key is org-scoped), and throws it as an AssetUploadError whose code
 * never reaches extensions.code — so the portal sees a bare
 * INTERNAL_SERVER_ERROR and cannot say anything useful. `acceptsUploads` does not
 * cover this: it defaults TRUE on a personal memory.
 */
import { describe, expect, it } from 'vitest';
import { canUploadToMemory, uploadBlockedReason } from './can-upload';

describe('canUploadToMemory', () => {
  it('allows an org-owned memory that accepts uploads', () => {
    expect(canUploadToMemory({ organizationId: 'org-1', acceptsUploads: true })).toBe(true);
  });

  it('blocks a user-owned memory even though acceptsUploads is true', () => {
    // The exact shape that shipped broken: personal memories carry
    // acceptsUploads: true and organizationId: null.
    expect(canUploadToMemory({ organizationId: null, acceptsUploads: true })).toBe(false);
  });

  it('blocks a memory that refuses uploads', () => {
    expect(canUploadToMemory({ organizationId: 'org-1', acceptsUploads: false })).toBe(false);
  });

  it('allows an org-owned memory whose projection omitted acceptsUploads', () => {
    // Only an explicit `false` blocks — otherwise a slim projection would
    // silently hide the control everywhere it's used.
    expect(canUploadToMemory({ organizationId: 'org-1' })).toBe(true);
  });

  it('blocks when organizationId is absent from the projection', () => {
    // Opposite default from acceptsUploads, deliberately: a missing org IS the
    // blocking condition, and every memory projection selects the field.
    expect(canUploadToMemory({ acceptsUploads: true })).toBe(false);
  });

  it('blocks a null/undefined memory rather than throwing', () => {
    expect(canUploadToMemory(null)).toBe(false);
    expect(canUploadToMemory(undefined)).toBe(false);
  });
});

describe('uploadBlockedReason', () => {
  it('reports nothing when upload is available', () => {
    expect(uploadBlockedReason({ organizationId: 'org-1', acceptsUploads: true })).toBeNull();
  });

  it('distinguishes a user-owned memory from one that refuses uploads', () => {
    // The two need different copy: one is a platform limitation, the other a
    // setting — telling a user "this memory does not accept uploads" about a
    // personal memory would send them hunting through Settings for a switch that
    // isn't there.
    expect(uploadBlockedReason({ organizationId: null, acceptsUploads: true })).toBe('user-owned');
    expect(uploadBlockedReason({ organizationId: 'org-1', acceptsUploads: false })).toBe(
      'refuses-uploads',
    );
  });

  it('prefers the explicit refusal when both conditions hold', () => {
    expect(uploadBlockedReason({ organizationId: null, acceptsUploads: false })).toBe(
      'refuses-uploads',
    );
  });

  it('agrees with canUploadToMemory on every combination', () => {
    for (const organizationId of [null, 'org-1']) {
      for (const acceptsUploads of [true, false, undefined]) {
        const m = { organizationId, acceptsUploads };
        expect(uploadBlockedReason(m) === null).toBe(canUploadToMemory(m));
      }
    }
  });
});
