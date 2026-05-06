// 010-create-node-on-portal — testable core of the create-node action.
// Extracted from +page.server.ts so the validation/derivation/error-mapping
// logic can be unit-tested without driving SvelteKit machinery. The route's
// action is a thin wrapper that supplies dependencies and translates the
// result into fail()/redirect().

import { ALLOWED_NODE_TYPES, isAllowedNodeType } from './nodeType-catalog';
import { deriveChildLoc } from './derive-loc';
import { LocCollisionExhausted, nextAvailableLoc } from './loc-collision';

export type CreateInput = {
  memoryId: string;
  /** Empty string for top-level (no parent). */
  parentLoc: string;
  title: string;
  type: string;
};

export type UpsertedNode = {
  id: string;
  loc: string;
};

export type UpsertNodeFn = (input: {
  memoryId: string;
  loc: string;
  name: string;
  nodeType: string;
}) => Promise<UpsertedNode>;

export type CreateDeps = {
  /** All locs already present in the target memory — used to derive the
   *  next-available loc when a slug collides with an existing sibling. */
  existingLocs: ReadonlySet<string>;
  upsertNode: UpsertNodeFn;
};

export type CreateErrorKind =
  | 'titleRequired'
  | 'titleEmptySlug'
  | 'typeRequired'
  | 'invalidType'
  | 'permissionDenied'
  | 'locCollisionExhausted'
  | 'network';

export type CreateResult =
  | { ok: true; createdLoc: string; createdNodeId: string }
  | { ok: false; error: CreateErrorKind };

export async function performCreate(
  input: CreateInput,
  deps: CreateDeps,
): Promise<CreateResult> {
  const title = input.title.trim();
  if (title.length === 0) return { ok: false, error: 'titleRequired' };
  if (input.type.length === 0) return { ok: false, error: 'typeRequired' };
  if (!isAllowedNodeType(input.type)) return { ok: false, error: 'invalidType' };

  let baseLoc: string;
  try {
    baseLoc = deriveChildLoc(input.parentLoc, title);
  } catch {
    // deriveChildLoc throws when the title slugs to an empty string.
    return { ok: false, error: 'titleEmptySlug' };
  }

  let resolvedLoc: string;
  try {
    resolvedLoc = nextAvailableLoc(deps.existingLocs, baseLoc);
  } catch (e) {
    if (e instanceof LocCollisionExhausted) {
      return { ok: false, error: 'locCollisionExhausted' };
    }
    throw e;
  }

  try {
    const created = await deps.upsertNode({
      memoryId: input.memoryId,
      loc: resolvedLoc,
      name: title,
      nodeType: input.type,
    });
    return { ok: true, createdLoc: created.loc, createdNodeId: created.id };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message.toLowerCase() : '';
    if (/write access|permission|forbidden|access denied/.test(msg)) {
      return { ok: false, error: 'permissionDenied' };
    }
    return { ok: false, error: 'network' };
  }
}

// Re-export the catalog for convenience at the call site.
export { ALLOWED_NODE_TYPES };
