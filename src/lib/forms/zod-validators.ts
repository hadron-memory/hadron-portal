import { z } from 'zod';
import { validateHandleField, validateMemorySlugField, validateOrgSlugField } from '$lib/urn/form-validation';

export const optionalHttpUrl = z.string().trim().refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}, 'Enter a valid URL.');

export function urnSlugField(label: string, requiredMessage = 'URN slug is required.') {
  return z
    .string()
    .trim()
    .min(1, requiredMessage)
    .superRefine((slug, ctx) => {
      if (!slug) return;
      const error = validateMemorySlugField(slug);
      if (error) ctx.addIssue({ code: 'custom', message: error.replace('Memory URN slug', label) });
    });
}

export function memorySlugField(requiredMessage = 'URN slug is required.') {
  return urnSlugField('Memory URN slug', requiredMessage);
}

export function agentSlugField(requiredMessage = 'Agent URN slug is required.') {
  return urnSlugField('Agent URN slug', requiredMessage);
}

export function orgSlugField(requiredMessage = 'Organization URN is required.') {
  return z
    .string()
    .trim()
    .min(1, requiredMessage)
    .superRefine((slug, ctx) => {
      if (!slug) return;
      const error = validateOrgSlugField(slug);
      if (error) ctx.addIssue({ code: 'custom', message: error });
    });
}

// #588: soft size cap for JSON payload fields, mirroring the node-detail Data
// tab — keeps a pathological paste from hitting the adapter-node body limit's
// opaque error.
export const JSON_FIELD_MAX = 256 * 1024;

// #588: a form field holding a serialized JSON object ('' = none). Used for
// node `properties` payloads (create/edit). Parser failures become field
// errors per review:form-schema-parser-errors.
export function jsonObjectField(label = 'Value') {
  return z.string().default('').superRefine((value, ctx) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (value.length > JSON_FIELD_MAX) {
      ctx.addIssue({
        code: 'custom',
        message: `${label} is too large (${Math.round(value.length / 1024)} KB / ${JSON_FIELD_MAX / 1024} KB max).`,
      });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Not valid JSON.' });
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      ctx.addIssue({ code: 'custom', message: `${label} must be a JSON object.` });
    }
  });
}

export function handleField() {
  return z
    .string()
    .trim()
    .default('')
    .superRefine((handle, ctx) => {
      const error = validateHandleField(handle);
      if (error) ctx.addIssue({ code: 'custom', message: error });
    });
}
