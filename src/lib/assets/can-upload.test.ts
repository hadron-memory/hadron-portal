/**
 * canUploadToMemory — the one gate on offering an upload control.
 *
 * This used to be TWO gates: `acceptsUploads` AND an owning organization.
 * The second existed because hadron-server derived the object-storage key
 * from the org urn and rejected a user-owned (spec 047 personal/private)
 * memory outright — so on everything under "My memories" the Files tab
 * offered an Upload control and the node page an "Attach file" action that
 * could only fail, opaquely, since the server's AssetUploadError code never
 * reaches extensions.code.
 *
 * hadron-server#891 fixed the cause rather than the symptom: the key is
 * derived from the memory urn, which is byte-identical for org-owned
 * memories and works for user-owned ones. So the org gate is gone. The
 * user-owned case below is the one most at risk of being "restored" by
 * someone who finds the old server error message.
 */
import { describe, expect, it } from 'vitest';
import { canUploadToMemory } from './can-upload';

describe('canUploadToMemory', () => {
  it('allows an org-owned memory that accepts uploads', () => {
    expect(canUploadToMemory({ acceptsUploads: true })).toBe(true);
  });

  it('allows a USER-OWNED memory — no organization is no longer a blocker', () => {
    // The behaviour change from hadron-server#891. A personal memory is
    // exactly where an individual keeps a personal file.
    expect(canUploadToMemory({ acceptsUploads: true })).toBe(true);
  });

  it('blocks a memory that refuses uploads', () => {
    expect(canUploadToMemory({ acceptsUploads: false })).toBe(false);
  });

  it('allows a memory whose projection omitted acceptsUploads', () => {
    // Only an explicit false blocks, so a slim projection never silently
    // hides a control that would have worked.
    expect(canUploadToMemory({})).toBe(true);
  });

  it('blocks a null/undefined memory rather than throwing', () => {
    expect(canUploadToMemory(null)).toBe(false);
    expect(canUploadToMemory(undefined)).toBe(false);
  });
});
