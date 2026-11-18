import { z } from 'zod';
import { checkboxBoolean } from '$lib/forms/checkbox-boolean';
import {
  EXTRACTION_SHAPES,
  extractionRowsError,
  type ExtractionRow,
  type ExtractionShape,
} from '$lib/flow/extraction';
import { formatUrn, hasSchemePrefix, parseUrn, splitNodeUrn } from '$lib/urn/parse-urn';
import { cleanLocInput } from '$lib/urn/clean-loc-input';

type ParsedEdges = Array<{ targetId: string; name?: string | null }>;

function normalizedLoc(value: string, ctx: z.RefinementCtx): string {
  if (!value) return '';
  // #1876: a fully-qualified node URN names a destination memory as well as a
  // loc. Reducing it to its loc would silently drop the memory, so it passes
  // through verbatim for the action to move by (as the Move dialog does).
  if (isFullyQualifiedNodeUrnInput(value)) return value.trim();
  try {
    return cleanLocInput(value);
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'Invalid loc.',
    });
    return z.NEVER as never;
  }
}

const seqField = z.preprocess((value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}, z.number().int().nullable()).default(null);

export function isFullyQualifiedNodeUrnInput(value: string): boolean {
  const input = value.trim();
  try {
    const prefixed = hasSchemePrefix(input);
    // An unprefixed loc is ambiguous; only the legacy :: hierarchy can
    // qualify without a type prefix (portal#1529 compatibility ruling).
    if (!prefixed && !input.includes('::')) return false;
    splitNodeUrn(input);
    // Grammar validation alone needs a type. Add it only to the validation
    // copy of a legacy input; never replace the submitted ownership identity.
    return parseUrn(prefixed ? input : formatUrn('node', input)).type === 'node';
  } catch {
    return false;
  }
}

function normalizedFlowRows(value: string): { ok: true; rows: ExtractionRow[] } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { ok: false, message: 'Invalid extraction rows' };
  }
  if (!Array.isArray(parsed)) return { ok: false, message: 'Invalid extraction rows' };

  const rows: ExtractionRow[] = parsed.map((row) => {
    const record = row !== null && typeof row === 'object' && !Array.isArray(row)
      ? row as Record<string, unknown>
      : {};
    const shape = record.shape;
    return {
      field: typeof record.field === 'string' ? record.field : '',
      shape: EXTRACTION_SHAPES.includes(shape as ExtractionShape) ? shape as ExtractionShape : 'string',
      description: typeof record.description === 'string' ? record.description : '',
    };
  });
  const rowsError = extractionRowsError(rows);
  return rowsError ? { ok: false, message: rowsError.message } : { ok: true, rows };
}

function normalizedEdges(value: string): { ok: true; edges: ParsedEdges } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { ok: false, message: 'Invalid edges JSON' };
  }
  if (!Array.isArray(parsed)) return { ok: false, message: 'Edges must be an array' };

  const edges: ParsedEdges = [];
  for (const edge of parsed) {
    if (edge === null || typeof edge !== 'object' || Array.isArray(edge)) {
      return { ok: false, message: 'Edges must contain objects' };
    }
    const targetId = (edge as Record<string, unknown>).targetId;
    const name = (edge as Record<string, unknown>).name;
    if (typeof targetId !== 'string' || targetId.trim() === '') {
      return { ok: false, message: 'Each edge needs a target node' };
    }
    if (name !== undefined && name !== null && typeof name !== 'string') {
      return { ok: false, message: 'Edge names must be text' };
    }
    edges.push({ targetId, name: name ?? null });
  }
  return { ok: true, edges };
}

export function parseValidatedFlowRows(value: string): ExtractionRow[] {
  const parsed = normalizedFlowRows(value);
  if (!parsed.ok) {
    throw new Error(`Validated flow rows failed to parse: ${parsed.message}`);
  }
  return parsed.rows;
}

export function parseValidatedEdges(value: string): ParsedEdges {
  const parsed = normalizedEdges(value);
  if (!parsed.ok) {
    throw new Error(`Validated edges failed to parse: ${parsed.message}`);
  }
  return parsed.edges;
}

// Defaulted _kind accepts omitted hidden inputs while still rejecting a
// defined discriminator from the wrong action.
export const nodeMoveSchema = z.object({
  _kind: z.literal('moveNode').default('moveNode'),
  target: z.string().trim().min(1, 'Enter a destination node URN.').prefault(''),
});

// Defaulted _kind accepts omitted hidden inputs while still rejecting a
// defined discriminator from the wrong action.
export const nodeTestFlowSchema = z.object({
  _kind: z.literal('testFlow').default('testFlow'),
  appId: z.string().trim().min(1, 'Pick an App to run as.').prefault(''),
  orgId: z.string().trim().min(1, 'Missing organization.').prefault(''),
  // The Agent to run as, chosen only in an App with several installed (#1444).
  agentRef: z.string().trim().default(''),
  payload: z.string().trim().default('').superRefine((value, ctx) => {
    if (value === '') return;
    try {
      const parsed = JSON.parse(value);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        ctx.addIssue({ code: 'custom', message: 'The test payload must be a JSON object of named fields.' });
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: 'The test payload must be valid JSON.' });
    }
  }),
});

// Defaulted _kind accepts omitted hidden inputs while still rejecting a
// defined discriminator from the wrong action.
// `recursive` (#621): only sent after the server refused with
// NODE_HAS_DESCENDANTS and the dialog offered the subtree checkbox, so a
// subtree is never deleted without an explicit choice.
export const nodeDeleteSchema = z.object({
  _kind: z.literal('deleteNode').default('deleteNode'),
  hard: checkboxBoolean.default(false),
  recursive: checkboxBoolean.default(false),
});

// Defaulted _kind accepts omitted hidden inputs while still rejecting a
// defined discriminator from the wrong action.
export const nodeCreateParentSchema = z.object({
  _kind: z.literal('createParent').default('createParent'),
  loc: z.string().trim().min(1, 'Missing parent loc.').prefault(''),
  name: z.string().trim().min(1, 'Missing parent name.').prefault(''),
});

// Defaulted _kind accepts omitted hidden inputs while still rejecting a
// defined discriminator from the wrong action.
export const nodeUpdateMetaSchema = z.object({
  _kind: z.literal('updateMeta').default('updateMeta'),
  name: z.string().trim().min(1, 'Name is required.').prefault(''),
  nodeType: z.string().trim().default(''),
  description: z.string().trim().default(''),
  alias: z.string().trim().default(''),
  seq: seqField,
  tags: z.string().trim().default(''),
  isRunnable: checkboxBoolean.default(false),
  loc: z.string().trim().default('').transform(normalizedLoc),
  // #921: Node.role, an open string. NOT trimmed here: `roleUpdate` compares
  // the raw value with the seed first, so an untouched field is omitted even
  // when the stored role carries whitespace the form must not "fix".
  role: z.string().default(''),
  // The role the form opened with; see $lib/node-role `roleUpdate`.
  roleSeed: z.string().default(''),
});

// Defaulted _kind accepts omitted hidden inputs while still rejecting a
// defined discriminator from the wrong action.
export const nodeDuplicateSchema = z.object({
  _kind: z.literal('duplicateNode').default('duplicateNode'),
});

// Defaulted _kind accepts omitted hidden inputs while still rejecting a
// defined discriminator from the wrong action.
export const nodeConvertToTaskSchema = z.object({
  _kind: z.literal('convertToTask').default('convertToTask'),
});

// #992: `revision` is the revision the reader saw. The server refuses the
// approval (REVISION_MISMATCH) if the node has moved on since.
export const nodeApproveSchema = z.object({
  _kind: z.literal('approveNode').default('approveNode'),
  revision: z.coerce.number().int().positive(),
});

// Defaulted _kind accepts omitted hidden inputs while still rejecting a
// defined discriminator from the wrong action.
export const nodeVerifySchema = z.object({
  _kind: z.literal('verifyNode').default('verifyNode'),
});

// Defaulted _kind accepts omitted hidden inputs while still rejecting a
// defined discriminator from the wrong action.
export const nodeUpdateFlowSchema = z.object({
  _kind: z.literal('updateFlow').default('updateFlow'),
  extractionRows: z.string().default('[]').superRefine((value, ctx) => {
    const parsed = normalizedFlowRows(value);
    if (!parsed.ok) ctx.addIssue({ code: 'custom', message: parsed.message });
  }),
  outputWriteTo: z.string().trim().default('').superRefine((value, ctx) => {
    if (value !== '' && !isFullyQualifiedNodeUrnInput(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Output target must be a fully-qualified node URN.',
      });
    }
  }),
  outputMode: z.enum(['replace', 'append']).default('replace'),
});

// Defaulted _kind accepts omitted hidden inputs while still rejecting a
// defined discriminator from the wrong action.
export const nodeUpdateEdgesSchema = z.object({
  _kind: z.literal('updateEdges').default('updateEdges'),
  edges: z.string().default('[]').superRefine((value, ctx) => {
    const parsed = normalizedEdges(value);
    if (!parsed.ok) ctx.addIssue({ code: 'custom', message: parsed.message });
  }),
});

export type NodeMoveSchema = typeof nodeMoveSchema;
export type NodeTestFlowSchema = typeof nodeTestFlowSchema;
export type NodeDeleteSchema = typeof nodeDeleteSchema;
export type NodeCreateParentSchema = typeof nodeCreateParentSchema;
export type NodeUpdateMetaSchema = typeof nodeUpdateMetaSchema;
export type NodeDuplicateSchema = typeof nodeDuplicateSchema;
export type NodeConvertToTaskSchema = typeof nodeConvertToTaskSchema;
export type NodeApproveSchema = typeof nodeApproveSchema;
export type NodeVerifySchema = typeof nodeVerifySchema;
export type NodeUpdateFlowSchema = typeof nodeUpdateFlowSchema;
export type NodeUpdateEdgesSchema = typeof nodeUpdateEdgesSchema;
