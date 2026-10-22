import { z } from 'zod';
import { JSON_FIELD_MAX, optionalHttpUrl } from '$lib/forms/zod-validators';
import { MemorySchemaError, parseMemorySchema } from '$lib/schema/memory-schema';
import { toBareMemorySlugInput, validateMemorySlugField } from '$lib/urn/form-validation';

const booleanString = z
  .union([
    z.boolean(),
    z.string().trim().pipe(z.enum(['true', 'false'])),
  ])
  .transform((value) => value === true || value === 'true');

export const memorySettingsSchema = z
  .object({
    // Defaulted _kind accepts omitted hidden inputs while still rejecting a
    // defined discriminator from the wrong action.
    _kind: z.literal('updateMemorySettings').default('updateMemorySettings'),
    displayName: z.string().trim().default(''),
    urnSlug: z.string().trim().default(''),
    urnSlugPresent: z.string().trim().default(''),
    originalUrnSlug: z.string().trim().default(''),
    currentUrn: z.string().trim().default(''),
    organizationId: z.string().trim().default(''),
    currentOrganizationId: z.string().trim().default(''),
    shortDescription: z.string().trim().default(''),
    description: z.string().trim().default(''),
    tags: z.string().trim().default(''),
    category0: z.string().trim().default(''),
    category1: z.string().trim().default(''),
    category2: z.string().trim().default(''),
    license: z.string().trim().default(''),
    homeUrl: optionalHttpUrl.default(''),
    iconUrl: optionalHttpUrl.default(''),
    heroUrl: optionalHttpUrl.default(''),
    visibility: z.enum(['ORGANIZATION', 'PUBLIC']).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.urnSlugPresent !== 'true') return;

    const bareSlug = toBareMemorySlugInput(data.urnSlug);
    if (!bareSlug) {
      ctx.addIssue({
        code: 'custom',
        path: ['urnSlug'],
        message: 'URN slug cannot be empty.',
      });
      return;
    }

    const error = validateMemorySlugField(bareSlug);
    if (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['urnSlug'],
        message: error,
      });
    }
  });

export const vectorIndexSettingsSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('updateVectorIndex').default('updateVectorIndex'),
  vectorIndexEnabled: booleanString.default(false),
  embeddingSource: z.enum(['abstract', 'contentChunks', 'both']).default('abstract'),
  chunkTokens: z.string().trim().default(''),
  chunkOverlap: z.string().trim().default(''),
  forceFixedSize: booleanString.default(false),
  acknowledgeVectorInversionRisk: booleanString.default(false),
});

// #695 (server #882): re-drive every node whose last embed attempt FAILED.
// The mutation takes only the memory ref, which the action reads from
// `params.id` — so this form carries nothing but its discriminator. It exists
// as a form rather than a bare button so the outcome can be reported through
// the same scoped-message path as its siblings, instead of a second mechanism
// on one page.
export const retryFailedEmbeddingsSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('retryFailedEmbeddings').default('retryFailedEmbeddings'),
});

// #841 / hrn:node:hadronmemory.com:specs:cor:acl:080:04 — list/unlist on the
// marketplace catalogue. The catalogue shows listed AND publicly accessible
// memories, but the spec keeps the two flags deliberately orthogonal: the
// server accepts a listing on a non-public memory. The pairing is guarded
// only at this control (disabled with an explanatory note until the memory
// is public) — do not remove that gate believing the server would refuse.
export const marketplaceListingSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('updateMarketplaceListing').default('updateMarketplaceListing'),
  listedOnMarketplace: booleanString.default(false),
});

// #588: the shared JSON-payload soft size cap (alias, not a copy — PR #613
// review flagged the drift risk of two independent 256KB constants).
export const SCHEMA_JSON_MAX = JSON_FIELD_MAX;

// #588 (server #725): the memory property schema, edited as raw JSON (v1).
// Empty = clear the schema (the action sends null). The client-side
// parseMemorySchema mirror gives field-level feedback; the server's
// BAD_USER_INPUT verdict is the source of truth and is surfaced verbatim.
export const memorySchemaSettingsSchema = z
  .object({
    // Defaulted _kind accepts omitted hidden inputs while still rejecting a
    // defined discriminator from the wrong action.
    _kind: z.literal('updateSchema').default('updateSchema'),
    schemaJson: z.string().default(''),
  })
  .superRefine((data, ctx) => {
    const trimmed = data.schemaJson.trim();
    if (!trimmed) return; // empty clears the schema
    if (data.schemaJson.length > SCHEMA_JSON_MAX) {
      ctx.addIssue({
        code: 'custom',
        path: ['schemaJson'],
        message: `Schema is too large (${Math.round(data.schemaJson.length / 1024)} KB / ${SCHEMA_JSON_MAX / 1024} KB max).`,
      });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['schemaJson'],
        message: 'Not valid JSON.',
      });
      return;
    }
    try {
      parseMemorySchema(parsed);
    } catch (e) {
      ctx.addIssue({
        code: 'custom',
        path: ['schemaJson'],
        message: e instanceof MemorySchemaError ? e.message : 'Not a valid memory schema.',
      });
    }
  });

export const deleteMemorySchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('deleteMemory').default('deleteMemory'),
  organizationId: z.string().trim().default(''),
});

// #969: the preview form and its apply form carry the same selection. The
// action discriminator prevents a sibling form's fields being accepted here.
const transferSelection = {
  destinationKind: z.enum(['org', 'user']),
  destinationRef: z.string().trim().min(1),
  targetClass: z.enum(['knowledge', 'group', 'personal', 'private']),
  resetGroupMembers: booleanString.default(false),
};
export const previewTransferSchema = z.object({
  _kind: z.literal('previewTransfer'),
  ...transferSelection,
});
export const applyTransferSchema = z.object({
  _kind: z.literal('applyTransfer'),
  ...transferSelection,
  expectedNewUrn: z.string().trim().min(1),
});

export type MemorySettingsSchema = typeof memorySettingsSchema;
export type VectorIndexSettingsSchema = typeof vectorIndexSettingsSchema;
export type MemorySchemaSettingsSchema = typeof memorySchemaSettingsSchema;
export type RetryFailedEmbeddingsSchema = typeof retryFailedEmbeddingsSchema;
export type DeleteMemorySchema = typeof deleteMemorySchema;
