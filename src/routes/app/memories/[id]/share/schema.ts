import { z } from 'zod';

// #668 — the principal's share controls. Three actions on one page, so each
// carries a `_kind` discriminator the way every other multi-form route here
// does; a defaulted literal accepts an omitted hidden input while still
// rejecting one from the wrong form.

/** reader | writer — the server's `MemoryShareRole`. */
export const MEMORY_SHARE_ROLES = ['reader', 'writer'] as const;
const roleField = z.enum(MEMORY_SHARE_ROLES);

// `granteeRef` is REQUIRED and non-empty on every one of these, and that is
// load-bearing rather than tidy validation.
//
// `deleteMemoryShare` is one server mutation serving two authorization paths,
// told apart ONLY by whether granteeRef is present: omit it and the server
// targets the CALLER's own grantee row instead. So a blank ref arriving from
// this page must be refused HERE, before it becomes a well-formed request to
// delete the wrong row. `an-empty-flag-is-not-an-absent-flag`, with a worse
// failure than usual because the empty case still succeeds.
const granteeRef = z.string().trim().min(1, 'Choose someone to share with.');

export const createShareSchema = z.object({
  _kind: z.literal('createShare').default('createShare'),
  granteeRef,
  role: roleField.default('reader'),
});

export const updateShareRoleSchema = z.object({
  _kind: z.literal('updateShareRole').default('updateShareRole'),
  granteeRef,
  role: roleField,
});

export const revokeShareSchema = z.object({
  _kind: z.literal('revokeShare').default('revokeShare'),
  granteeRef,
});

export type CreateShareSchema = typeof createShareSchema;
export type UpdateShareRoleSchema = typeof updateShareRoleSchema;
export type RevokeShareSchema = typeof revokeShareSchema;
