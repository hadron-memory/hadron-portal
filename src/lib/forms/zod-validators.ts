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

export function memorySlugField(requiredMessage = 'URN slug is required.') {
  return z
    .string()
    .trim()
    .min(1, requiredMessage)
    .superRefine((slug, ctx) => {
      if (!slug) return;
      const error = validateMemorySlugField(slug);
      if (error) ctx.addIssue({ code: 'custom', message: error });
    });
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
