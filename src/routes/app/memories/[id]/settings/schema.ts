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

/** Shortest passphrase accepted. Deliberately a floor, not a strength meter. */
export const PASSPHRASE_MIN = 12;

/**
 * Longest string we will attempt to decode as a data key.
 *
 * A 32-byte key is exactly 44 base64 characters. The cap is well above that so
 * a near-miss still gets the size message rather than this one, and far below
 * anything worth allocating.
 */
export const DATA_KEY_MAX = 128;

/**
 * Longest passphrase accepted. scrypt cost is fixed by the server's KDF
 * params rather than by input length, so this is not a DoS bound — it is a
 * sanity bound, and it also keeps a pasted FILE from being submitted as a
 * passphrase the user can never retype.
 */
export const PASSPHRASE_MAX = 1024;

/**
 * #873 — encrypt a plaintext PRIVATE memory (spec 041).
 *
 * Two key paths, because the server takes exactly one of them:
 *
 * - **passphrase** (the default, and the only one most users see) — the server
 *   derives the key with scrypt and stores salt + params, never the key.
 * - **dataKey** — base64, 32 bytes, for parity with
 *   `hadron memory encrypt --data-key`. Behind a disclosure: it is a raw secret
 *   and a browser form is the worst place to handle one.
 *
 * `mode` decides which field is required, so an unused field left populated by
 * a browser cannot smuggle a second key into the mutation — the server refuses
 * both-at-once with BAD_USER_INPUT, and the action sends only the one `mode`
 * names.
 *
 * **Neither secret may be echoed back.** superforms returns `form.data` to the
 * client on every path including `fail(400)`, so the action scrubs both fields
 * before returning. That is not belt-and-braces: without it a validation error
 * puts the user's passphrase into the page's form store and any error-reporting
 * path that serialises the form.
 */
export const encryptMemorySchema = z
  .object({
    // Defaulted _kind accepts omitted hidden inputs while still rejecting a
    // defined discriminator from the wrong action.
    _kind: z.literal('encryptMemory').default('encryptMemory'),
    mode: z.enum(['passphrase', 'dataKey']).default('passphrase'),
    passphrase: z.string().max(PASSPHRASE_MAX).default(''),
    passphraseConfirm: z.string().max(PASSPHRASE_MAX).default(''),
    dataKey: z.string().trim().max(DATA_KEY_MAX).default(''),
    // A one-way act with no recovery path deserves an explicit human moment.
    // Not a dark pattern to satisfy — it is the only thing standing between a
    // mistyped passphrase and permanently unreadable content.
    confirmIrreversible: booleanString.default(false),
  })
  .superRefine((data, ctx) => {
    if (!data.confirmIrreversible) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmIrreversible'],
        message:
          'Confirm you understand that encryption cannot be undone and the content cannot be recovered without the key.',
      });
    }

    if (data.mode === 'passphrase') {
      if (data.passphrase.length < PASSPHRASE_MIN) {
        ctx.addIssue({
          code: 'custom',
          path: ['passphrase'],
          message: `Use at least ${PASSPHRASE_MIN} characters.`,
        });
        return;
      }
      // Checked here rather than only in the browser: a mismatch is the most
      // likely way to lose a memory's content permanently, and it is the one
      // error the server cannot detect for us — both halves look like a valid
      // passphrase to it.
      if (data.passphrase !== data.passphraseConfirm) {
        ctx.addIssue({
          code: 'custom',
          path: ['passphraseConfirm'],
          message: 'The two passphrases do not match.',
        });
      }
      return;
    }

    // dataKey mode. The server validates the key too and its verdict is
    // authoritative; this exists so a typo is a field error rather than a
    // round trip that reports "failed to encrypt".
    const error = dataKeyProblem(data.dataKey);
    if (error) {
      ctx.addIssue({ code: 'custom', path: ['dataKey'], message: error });
    }
  });

/**
 * Why a base64 data key is unusable, or null if it is fine.
 *
 * The server requires 32 decoded bytes. Checked by DECODING rather than by
 * counting characters: `'a'.repeat(44)` is 44 characters and decodes to 33
 * bytes, so a length rule alone accepts keys the server rejects.
 */
export function dataKeyProblem(raw: string): string | null {
  const value = raw.trim();
  if (!value) return 'Paste a base64-encoded 32-byte key, or use a passphrase instead.';
  // Length FIRST, before decoding. A valid key is 44 base64 characters, so
  // anything past the cap cannot become one — and `atob` on an unbounded
  // authenticated POST is work the server does on the caller's say-so
  // (@copilot on #884). The cap is generous rather than exact so the message
  // stays about the key's size rather than about our parser.
  if (value.length > DATA_KEY_MAX) return 'Too long to be a 32-byte key.';
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return 'Not valid base64.';
  let decoded: Uint8Array;
  try {
    decoded = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  } catch {
    return 'Not valid base64.';
  }
  if (decoded.length !== 32) {
    return `A data key must decode to exactly 32 bytes; this one is ${decoded.length}.`;
  }
  return null;
}

export const deleteMemorySchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('deleteMemory').default('deleteMemory'),
  organizationId: z.string().trim().default(''),
});

export type EncryptMemorySchema = typeof encryptMemorySchema;
export type MemorySettingsSchema = typeof memorySettingsSchema;
export type VectorIndexSettingsSchema = typeof vectorIndexSettingsSchema;
export type MemorySchemaSettingsSchema = typeof memorySchemaSettingsSchema;
export type RetryFailedEmbeddingsSchema = typeof retryFailedEmbeddingsSchema;
export type DeleteMemorySchema = typeof deleteMemorySchema;
